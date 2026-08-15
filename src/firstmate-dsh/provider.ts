import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type { FirstmateTask, WorkerEvent } from '../shared/types.ts'
import type { WorkerProvider, WorkerStart } from '../firstmate-core/worker-provider.ts'
import { FIRSTMATE_WORKER_PERSONA, initialWorkerPrompt } from '../firstmate-manager/prompt.ts'
import { fallbackReviewResult, parseWorkerEnvelope } from '../firstmate-manager/result.ts'
import { collectGitArtifacts, mergeGitArtifacts } from './git-artifacts.ts'

export interface DshWorkerProviderConfig {
  readonly subagentProvider: string
  readonly agentProvider?: string
  readonly model?: string
  readonly maxDepth: number
}

type Listener = (event: WorkerEvent) => void

export class DshWorkerProvider implements WorkerProvider {
  private readonly listeners = new Set<Listener>()
  private readonly taskByWorker = new Map<string, string>()
  private readonly taskById = new Map<string, FirstmateTask>()
  private readonly earlyEnds = new Map<string, SubagentRunEndInfo>()
  private readonly lastHeartbeat = new Map<string, number>()
  private readonly interruptWaiters = new Map<string, Set<() => void>>()
  private readonly parentHandles = new Map<string, AgentHandle>()
  private disposing = false

  constructor(
    private readonly ctx: Context,
    private readonly config: DshWorkerProviderConfig,
  ) {
    ctx.on('subagent/start', info => this.onStart(info))
    ctx.on('subagent/end', info => { void this.onEnd(info) })
    ctx.on('session/event', (session) => this.onSessionActivity(session.id))
  }

  async start(task: FirstmateTask, signal: AbortSignal): Promise<WorkerStart> {
    this.assertActive()
    const parent = await this.parentFor(task.workspace, signal)
    const provider = this.ctx.subagents.getProvider(this.config.subagentProvider)
    if (provider === undefined) {
      throw new Error(
        `DSH subagent provider "${this.config.subagentProvider}" is unavailable; available providers: ${this.ctx.subagents.list().join(', ') || 'none'}`,
      )
    }
    if (provider.prepareContinuable === undefined) {
      throw new Error(`DSH subagent provider "${this.config.subagentProvider}" does not support continuable workers`)
    }
    const start = await this.ctx.subagents.startContinuable({
      provider: this.config.subagentProvider,
      label: `firstmate:${task.id}`,
      request: {
        prompt: [{ type: 'text', text: initialWorkerPrompt(task) }],
        parent,
        persona: FIRSTMATE_WORKER_PERSONA,
        maxDepth: this.config.maxDepth,
        agentOptions: {
          ...(this.config.agentProvider === undefined ? {} : { provider: this.config.agentProvider }),
          ...(this.config.model === undefined ? {} : { model: this.config.model }),
        },
      },
      signal,
    })
    this.track(task, start.childId)
    this.flushEarlyEnd(start.childId)
    return { workerId: start.childId, provider: this.config.subagentProvider }
  }

  async restore(task: FirstmateTask, signal: AbortSignal): Promise<void> {
    this.assertActive()
    if (task.worker === undefined) throw new Error(`Task ${task.id} has no worker to restore`)
    this.track(task, task.worker.id)
    const parent = await this.parentFor(task.workspace, signal)
    await this.ctx.subagents.followup(parent, SessionId(task.worker.id), [{
      type: 'text',
      text: 'DSH restarted while this task was active. Inspect the durable session and current workspace, recover safely, then continue to a structured Firstmate result.',
    }], {
      source: { kind: 'plugin', plugin: 'firstmate-dsh' },
      signal,
    })
  }

  async send(task: FirstmateTask, message: string, signal: AbortSignal): Promise<void> {
    this.assertActive()
    if (task.worker === undefined) throw new Error(`Task ${task.id} has no continuable worker`)
    this.track(task, task.worker.id)
    const parent = await this.parentFor(task.workspace, signal)
    await this.ctx.subagents.followup(parent, SessionId(task.worker.id), [{ type: 'text', text: message }], {
      source: { kind: 'plugin', plugin: 'firstmate-dsh' },
      signal,
    })
  }

  async interrupt(task: FirstmateTask, _reason: string): Promise<void> {
    if (task.worker === undefined) return
    const workerId = task.worker.id
    const parent = await this.parentFor(task.workspace, new AbortController().signal)
    if (this.ctx.agents.get(SessionId(workerId)) === undefined) return
    let abandonWait = (): void => {}
    const settled = new Promise<void>((resolve, reject) => {
      const waiters = this.interruptWaiters.get(workerId) ?? new Set<() => void>()
      const timer = setTimeout(() => {
        waiters.delete(onSettled)
        if (waiters.size === 0) this.interruptWaiters.delete(workerId)
        reject(new Error(`DSH worker ${workerId} did not stop within 30 seconds`))
      }, 30_000)
      const onSettled = (): void => {
        clearTimeout(timer)
        resolve()
      }
      waiters.add(onSettled)
      this.interruptWaiters.set(workerId, waiters)
      abandonWait = () => {
        clearTimeout(timer)
        waiters.delete(onSettled)
        if (waiters.size === 0) this.interruptWaiters.delete(workerId)
      }
    })
    try {
      this.ctx.subagents.interrupt(SessionId(workerId), { kind: 'ancestor', agent: parent })
    } catch (error: unknown) {
      abandonWait()
      throw error
    }
    await settled
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    this.disposing = true
    this.listeners.clear()
    for (const waiters of this.interruptWaiters.values()) {
      for (const resolve of waiters) resolve()
    }
    this.interruptWaiters.clear()
    const handles = [...this.parentHandles.values()]
    this.parentHandles.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose()))
  }

  private onStart(info: SubagentRunInfo): void {
    const taskId = this.taskByWorker.get(info.id)
    if (taskId === undefined) return
    this.emit({ type: 'started', taskId, workerId: info.id, at: new Date().toISOString() })
  }

  private async onEnd(info: SubagentRunEndInfo): Promise<void> {
    this.resolveInterrupts(info.id)
    const taskId = this.taskByWorker.get(info.id)
    if (taskId === undefined) {
      this.earlyEnds.set(info.id, info)
      return
    }
    const task = this.taskById.get(taskId)
    if (task === undefined) return
    const at = new Date().toISOString()
    if (info.stopReason !== 'completed') {
      this.emit({
        type: info.stopReason === 'aborted' ? 'interrupted' : 'failed',
        taskId,
        workerId: info.id,
        at,
        reason: `DSH worker ended with ${info.stopReason}`,
      })
      return
    }
    const text = textOf(info.lastAssistantMessage ?? [])
    let envelope
    try {
      envelope = parseWorkerEnvelope(text)
    } catch (error: unknown) {
      const fallback = fallbackReviewResult(text, error instanceof Error ? error.message : String(error))
      const result = mergeGitArtifacts(fallback, await collectGitArtifacts(task.workspace))
      this.emit({ type: 'review_ready', taskId, workerId: info.id, at, result })
      return
    }
    if (envelope.kind === 'decision_required') {
      this.emit({ type: 'decision_required', taskId, workerId: info.id, at, question: envelope.question })
      return
    }
    if (envelope.kind === 'blocked') {
      this.emit({ type: 'blocked', taskId, workerId: info.id, at, reason: envelope.reason })
      return
    }
    const result = mergeGitArtifacts(envelope.result, await collectGitArtifacts(task.workspace))
    this.emit({ type: 'review_ready', taskId, workerId: info.id, at, result })
  }

  private track(task: FirstmateTask, workerId: string): void {
    this.taskByWorker.set(workerId, task.id)
    this.taskById.set(task.id, task)
  }

  private flushEarlyEnd(workerId: string): void {
    const event = this.earlyEnds.get(workerId)
    if (event === undefined) return
    this.earlyEnds.delete(workerId)
    setTimeout(() => { void this.onEnd(event) }, 0)
  }

  private onSessionActivity(workerId: string): void {
    const taskId = this.taskByWorker.get(workerId)
    if (taskId === undefined) return
    const now = Date.now()
    const previous = this.lastHeartbeat.get(workerId) ?? 0
    if (now - previous < 30_000) return
    this.lastHeartbeat.set(workerId, now)
    this.emit({ type: 'heartbeat', taskId, workerId, at: new Date(now).toISOString() })
  }

  private resolveInterrupts(workerId: string): void {
    const waiters = this.interruptWaiters.get(workerId)
    if (waiters === undefined) return
    this.interruptWaiters.delete(workerId)
    for (const resolve of waiters) resolve()
  }

  private emit(event: WorkerEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private async parentFor(workspace: string, signal: AbortSignal): Promise<Agent> {
    const existing = this.parentHandles.get(workspace)
    if (existing !== undefined) return existing.agent
    const sessionId = parentSessionId(workspace)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const snapshots = await this.ctx.sessionPersistence.listSnapshots(signal)
    const persisted = snapshots.find(snapshot => snapshot.header.id === sessionId)
    if (persisted !== undefined && persisted.header.cwd !== workspace) {
      throw new Error(`Firstmate parent session ${sessionId} belongs to a different workspace`)
    }
    const handle = persisted === undefined
      ? await this.ctx.agents.create({
          sessionId,
          meta: { cwd: workspace },
          signal,
          agentOptions: {
            ...(this.config.agentProvider === undefined ? {} : { provider: this.config.agentProvider }),
            ...(this.config.model === undefined ? {} : { model: this.config.model }),
          },
        })
      : await this.ctx.agents.resume({
          resumeSessionId: sessionId,
          signal,
          agentOptions: {
            ...(this.config.agentProvider === undefined ? {} : { provider: this.config.agentProvider }),
            ...(this.config.model === undefined ? {} : { model: this.config.model }),
          },
        })
    const raced = this.parentHandles.get(workspace)
    if (raced !== undefined) {
      await handle.dispose()
      return raced.agent
    }
    this.parentHandles.set(workspace, handle)
    return handle.agent
  }

  private assertActive(): void {
    if (this.disposing) throw new Error('Firstmate DSH worker provider is disposing')
  }
}

function parentSessionId(workspace: string): ReturnType<typeof SessionId> {
  const digest = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
  return SessionId(`firstmate-manager-${digest}`)
}

function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}
