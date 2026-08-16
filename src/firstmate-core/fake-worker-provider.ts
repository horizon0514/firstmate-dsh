import type { FirstmateTask, ReviewResult, WorkerEvent } from '../shared/types.ts'
import type { WorkerProvider, WorkerStart } from './worker-provider.ts'

export interface FakeWorkerMessage {
  readonly taskId: string
  readonly message: string
}

export class FakeWorkerProvider implements WorkerProvider {
  readonly startedTaskIds: string[] = []
  readonly restoredTaskIds: string[] = []
  readonly interruptedTaskIds: string[] = []
  readonly releasedTaskIds: string[] = []
  readonly messages: FakeWorkerMessage[] = []

  private readonly listeners = new Set<(event: WorkerEvent) => void>()
  private readonly workers = new Map<string, string>()
  private readonly startFailures = new Map<string, Error>()
  private readonly sendFailures = new Map<string, Error>()
  private readonly interruptFailures = new Map<string, Error>()
  private sequence = 0

  async start(task: FirstmateTask, signal: AbortSignal): Promise<WorkerStart> {
    signal.throwIfAborted()
    const failure = this.startFailures.get(task.id)
    if (failure !== undefined) {
      this.startFailures.delete(task.id)
      throw failure
    }
    const workerId = `fake-worker-${++this.sequence}`
    this.startedTaskIds.push(task.id)
    this.workers.set(task.id, workerId)
    return { workerId, provider: 'fake' }
  }

  async restore(task: FirstmateTask, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (task.worker === undefined) throw new Error(`Task ${task.id} has no worker to restore`)
    this.restoredTaskIds.push(task.id)
    this.workers.set(task.id, task.worker.id)
  }

  async send(task: FirstmateTask, message: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const failure = this.sendFailures.get(task.id)
    if (failure !== undefined) {
      this.sendFailures.delete(task.id)
      throw failure
    }
    this.messages.push({ taskId: task.id, message })
  }

  async interrupt(task: FirstmateTask, reason: string): Promise<void> {
    const failure = this.interruptFailures.get(task.id)
    if (failure !== undefined) {
      this.interruptFailures.delete(task.id)
      throw failure
    }
    this.interruptedTaskIds.push(task.id)
    this.interrupted(task.id, reason)
  }

  release(taskId: string): void {
    this.releasedTaskIds.push(taskId)
  }

  subscribe(listener: (event: WorkerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  failNextStart(taskId: string, error: Error = new Error('fake start failure')): void {
    this.startFailures.set(taskId, error)
  }

  failNextSend(taskId: string, error: Error = new Error('fake send failure')): void {
    this.sendFailures.set(taskId, error)
  }

  failNextInterrupt(taskId: string, error: Error = new Error('fake interrupt failure')): void {
    this.interruptFailures.set(taskId, error)
  }

  decision(taskId: string, question: string, at = new Date().toISOString()): void {
    this.emitFor(taskId, workerId => ({ type: 'decision_required', taskId, workerId, at, question }))
  }

  review(taskId: string, result: ReviewResult, at = new Date().toISOString()): void {
    this.emitFor(taskId, workerId => ({ type: 'review_ready', taskId, workerId, at, result }))
  }

  block(taskId: string, reason: string, at = new Date().toISOString()): void {
    this.emitFor(taskId, workerId => ({ type: 'blocked', taskId, workerId, at, reason }))
  }

  fail(taskId: string, reason: string, at = new Date().toISOString()): void {
    const workerId = this.workers.get(taskId)
    this.publish({ type: 'failed', taskId, ...(workerId === undefined ? {} : { workerId }), at, reason })
  }

  interrupted(taskId: string, reason: string, at = new Date().toISOString()): void {
    this.emitFor(taskId, workerId => ({ type: 'interrupted', taskId, workerId, at, reason }))
  }

  heartbeat(taskId: string, at = new Date().toISOString()): void {
    this.emitFor(taskId, workerId => ({ type: 'heartbeat', taskId, workerId, at }))
  }

  publish(event: WorkerEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private emitFor(taskId: string, event: (workerId: string) => WorkerEvent): void {
    const workerId = this.workers.get(taskId)
    if (workerId === undefined) throw new Error(`Task ${taskId} has no fake worker`)
    this.publish(event(workerId))
  }
}
