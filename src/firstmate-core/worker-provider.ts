import type { FirstmateTask, WorkerEvent } from '../shared/types.ts'

export interface WorkerStart {
  readonly workerId: string
  readonly provider: string
}

export interface WorkerProvider {
  start(task: FirstmateTask, signal: AbortSignal): Promise<WorkerStart>
  restore(task: FirstmateTask, signal: AbortSignal): Promise<void>
  send(task: FirstmateTask, message: string, signal: AbortSignal): Promise<void>
  interrupt(task: FirstmateTask, reason: string): Promise<void>
  /** Drops the per-task bookkeeping once a task reaches a terminal state. */
  release(taskId: string): void
  subscribe(listener: (event: WorkerEvent) => void): () => void
}
