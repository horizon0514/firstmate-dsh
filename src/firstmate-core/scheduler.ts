import type { FirstmateTask, ReviewResult, WorkerEvent } from '../shared/types.ts'
import { holdsWorkspaceLock, transitionTask } from './state-machine.ts'
import type { TaskLedger } from './ledger.ts'
import type { WorkerProvider } from './worker-provider.ts'

export interface SchedulerOptions {
  readonly maxRetries: number
  readonly staleAfterMs: number
  readonly heartbeatIntervalMs?: number
  readonly now?: () => Date
  readonly onError?: (error: unknown) => void
}

export class FirstmateScheduler {
  private readonly now: () => Date
  private readonly onError: (error: unknown) => void
  private pumpTail: Promise<void> = Promise.resolve()
  private unsubscribeWorker: (() => void) | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private readonly cancelling = new Set<string>()
  private stopped = false

  constructor(
    private readonly ledger: TaskLedger,
    private readonly workers: WorkerProvider,
    private readonly options: SchedulerOptions,
  ) {
    this.now = options.now ?? (() => new Date())
    this.onError = options.onError ?? (() => undefined)
  }

  async start(): Promise<void> {
    this.unsubscribeWorker = this.workers.subscribe(event => {
      void this.onWorkerEvent(event).catch(this.onError)
    })
    await this.recover()
    await this.pump()
    const interval = this.options.heartbeatIntervalMs ?? Math.max(1_000, Math.floor(this.options.staleAfterMs / 3))
    this.heartbeatTimer = setInterval(() => {
      void this.recoverStale(this.now()).catch(this.onError)
    }, interval)
    this.heartbeatTimer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.unsubscribeWorker?.()
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer)
    await this.pumpTail
  }

  async pump(): Promise<void> {
    const run = this.pumpTail.then(() => this.pumpOnce())
    this.pumpTail = run.catch(() => undefined)
    return run
  }

  async answerDecision(taskId: string, answer: string): Promise<void> {
    const clean = answer.trim()
    if (clean === '') throw new Error('A decision answer is required')
    const at = this.timestamp()
    const task = await this.ledger.update(taskId, current => {
      if (current.status !== 'decision_required' || current.decision === undefined) {
        throw new Error(`Task ${taskId} is not waiting for a decision`)
      }
      const next = current.worker === undefined ? 'queued' : 'running'
      return {
        ...transitionTask(current, next, 'user supplied the required decision', at),
        acceptanceCriteria: current.worker === undefined
          ? [...current.acceptanceCriteria, clean]
          : current.acceptanceCriteria,
        decision: { ...current.decision, answer: clean, answeredAt: at },
        blocked: undefined,
      }
    })
    if (task.worker === undefined) {
      await this.pump()
    } else {
      await this.sendOrRecover(
        task,
        `User decision: ${clean}\nContinue the task and return the structured Firstmate result.`,
        'decision delivery failed',
      )
    }
  }

  async accept(taskId: string): Promise<void> {
    const at = this.timestamp()
    await this.ledger.update(taskId, current => {
      if (current.status !== 'review_ready') throw new Error(`Task ${taskId} is not ready for review`)
      return transitionTask(current, 'completed', 'user accepted the result', at)
    })
    await this.pump()
  }

  async revise(taskId: string, feedback: string): Promise<void> {
    const clean = feedback.trim()
    if (clean === '') throw new Error('Revision feedback is required')
    const at = this.timestamp()
    const task = await this.ledger.update(taskId, current => {
      if (current.status !== 'review_ready') throw new Error(`Task ${taskId} is not ready for review`)
      return {
        ...transitionTask(current, 'running', 'user requested revisions', at),
        revisionCount: current.revisionCount + 1,
        result: undefined,
      }
    })
    await this.sendOrRecover(
      task,
      `Review feedback: ${clean}\nApply the requested changes and return a new structured Firstmate result.`,
      'revision delivery failed',
    )
  }

  async retry(taskId: string): Promise<void> {
    const at = this.timestamp()
    const task = await this.ledger.update(taskId, current => {
      if (current.status !== 'blocked') throw new Error(`Task ${taskId} is not blocked`)
      return {
        ...transitionTask(current, current.worker === undefined ? 'queued' : 'running', 'user requested a retry', at),
        blocked: undefined,
      }
    })
    if (task.status === 'running') {
      await this.sendOrRecover(
        task,
        'Retry the task from the current workspace state. Resolve the blocker and return a structured Firstmate result.',
        'retry delivery failed',
      )
    } else {
      await this.pump()
    }
  }

  async cancel(taskId: string): Promise<void> {
    const task = this.requireTask(taskId)
    if (task.status === 'completed' || task.status === 'cancelled') return
    this.cancelling.add(taskId)
    try {
      if (task.worker !== undefined) await this.workers.interrupt(task, 'user cancelled the task')
      await this.ledger.update(taskId, current => transitionTask(current, 'cancelled', 'user cancelled the task', this.timestamp()))
      await this.pump()
    } finally {
      this.cancelling.delete(taskId)
    }
  }

  async recoverStale(now: Date): Promise<void> {
    const stale = this.ledger.list().filter(task => task.status === 'running'
      && task.worker !== undefined
      && now.getTime() - Date.parse(task.worker.lastHeartbeatAt) > this.options.staleAfterMs)
    await Promise.all(stale.map(async task => {
      let reason = 'worker stopped responding'
      try {
        await this.workers.interrupt(task, 'worker heartbeat timed out')
      } catch (error: unknown) {
        reason += `; interrupt failed: ${messageOf(error)}`
      }
      await this.handleFailure(task.id, reason)
    }))
  }

  private async recover(): Promise<void> {
    const running = this.ledger.list().filter(task => task.status === 'running')
    await Promise.all(running.map(async task => {
      if (task.worker === undefined) {
        await this.ledger.update(task.id, current => transitionTask(current, 'queued', 'requeued after DSH restart', this.timestamp()))
        return
      }
      try {
        await this.workers.restore(task, new AbortController().signal)
      } catch (error: unknown) {
        await this.handleFailure(task.id, `restart recovery failed: ${messageOf(error)}`)
      }
    }))
  }

  private async pumpOnce(): Promise<void> {
    if (this.stopped) return
    const tasks = this.ledger.list()
    const locked = new Set(tasks.filter(holdsWorkspaceLock).map(task => task.workspace))
    const completed = new Set(tasks.filter(task => task.status === 'completed').map(task => task.id))
    const selected: FirstmateTask[] = []
    for (const task of tasks) {
      if (task.status !== 'queued' || locked.has(task.workspace)) continue
      const missing = task.dependsOn.filter(id => !completed.has(id))
      if (missing.length > 0) continue
      selected.push(task)
      locked.add(task.workspace)
    }
    await Promise.all(selected.map(task => this.launch(task.id)))
  }

  private async launch(taskId: string): Promise<void> {
    const at = this.timestamp()
    const task = await this.ledger.update(taskId, current => ({
      ...transitionTask(current, 'running', 'scheduler admitted the workspace', at),
      retryCount: current.retryCount,
      blocked: undefined,
    }))
    try {
      const start = await this.workers.start(task, new AbortController().signal)
      await this.ledger.update(taskId, current => {
        if (current.status !== 'running') return current
        return {
          ...current,
          updatedAt: this.timestamp(),
          worker: {
            id: start.workerId,
            provider: start.provider,
            attempt: current.retryCount + 1,
            lastHeartbeatAt: this.timestamp(),
          },
        }
      })
    } catch (error: unknown) {
      await this.handleFailure(taskId, `worker start failed: ${messageOf(error)}`)
    }
  }

  private async onWorkerEvent(event: WorkerEvent): Promise<void> {
    const task = this.ledger.get(event.taskId)
    if (task === undefined || task.status === 'completed' || task.status === 'cancelled'
      || this.cancelling.has(task.id)) return
    if ('workerId' in event && task.worker !== undefined && task.worker.id !== event.workerId) return
    switch (event.type) {
      case 'started':
      case 'heartbeat':
        await this.ledger.update(task.id, current => current.worker?.id === event.workerId
          ? { ...current, updatedAt: event.at, worker: { ...current.worker, lastHeartbeatAt: event.at } }
          : current)
        return
      case 'decision_required':
        await this.ledger.update(task.id, current => ({
          ...transitionTask(current, 'decision_required', 'worker needs a user decision', event.at),
          decision: { question: event.question, requestedAt: event.at },
        }))
        return
      case 'review_ready':
        await this.setReviewReady(task.id, event.result, event.at)
        return
      case 'blocked':
        await this.setBlocked(task.id, event.reason, event.at)
        return
      case 'failed':
      case 'interrupted':
        await this.handleFailure(task.id, event.reason)
    }
  }

  private async setReviewReady(taskId: string, result: ReviewResult, at: string): Promise<void> {
    await this.ledger.update(taskId, current => ({
      ...transitionTask(current, 'review_ready', 'worker returned an acceptance package', at),
      result,
      blocked: undefined,
    }))
  }

  private async setBlocked(taskId: string, reason: string, at: string): Promise<void> {
    await this.ledger.update(taskId, current => ({
      ...transitionTask(current, 'blocked', 'safe retries exhausted or worker declared a blocker', at),
      blocked: { reason, since: at, retryCount: current.retryCount },
    }))
  }

  private async handleFailure(taskId: string, reason: string): Promise<void> {
    const at = this.timestamp()
    const task = await this.ledger.update(taskId, current => {
      if (current.status !== 'running') return current
      const retryCount = current.retryCount + 1
      if (retryCount > this.options.maxRetries) {
        return {
          ...transitionTask(current, 'blocked', 'safe retry budget exhausted', at),
          retryCount,
          blocked: { reason, since: at, retryCount },
        }
      }
      return {
        ...current,
        retryCount,
        updatedAt: at,
        history: [...current.history, { at, from: 'running', to: 'running', reason: `automatic retry ${retryCount}: ${reason}` }],
      }
    })
    if (task.status === 'blocked') return
    if (task.worker === undefined) {
      await this.ledger.update(taskId, current => transitionTask(current, 'queued', 'retry worker creation', this.timestamp()))
      void this.pump().catch(this.onError)
      return
    }
    try {
      await this.workers.send(task, `Recover after this failure: ${reason}\nInspect the current workspace, continue safely, and return a structured Firstmate result.`, new AbortController().signal)
    } catch (error: unknown) {
      await this.setBlocked(taskId, `retry delivery failed: ${messageOf(error)}`, this.timestamp())
    }
  }

  private async sendOrRecover(task: FirstmateTask, message: string, failure: string): Promise<void> {
    try {
      await this.workers.send(task, message, new AbortController().signal)
    } catch (error: unknown) {
      await this.handleFailure(task.id, `${failure}: ${messageOf(error)}`)
    }
  }

  private requireTask(id: string): FirstmateTask {
    const task = this.ledger.get(id)
    if (task === undefined) throw new Error(`Firstmate task not found: ${id}`)
    return task
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
