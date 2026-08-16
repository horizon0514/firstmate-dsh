import type { FirstmateTask, TaskHistoryEntry, TaskStatus } from '../shared/types.ts'

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  queued: new Set(['running', 'decision_required', 'blocked', 'cancelled']),
  running: new Set(['queued', 'decision_required', 'review_ready', 'blocked', 'cancelled']),
  decision_required: new Set(['queued', 'running', 'blocked', 'cancelled']),
  review_ready: new Set(['running', 'completed', 'cancelled']),
  blocked: new Set(['queued', 'running', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
}

export class InvalidTaskTransitionError extends Error {
  constructor(readonly from: TaskStatus, readonly to: TaskStatus) {
    super(`invalid Firstmate task transition: ${from} -> ${to}`)
    this.name = 'InvalidTaskTransitionError'
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].has(to)
}

export function transitionTask(
  task: FirstmateTask,
  to: TaskStatus,
  reason: string,
  at: string,
): FirstmateTask {
  if (!canTransition(task.status, to)) throw new InvalidTaskTransitionError(task.status, to)
  if (task.status === to) return { ...task, updatedAt: at }
  const history: TaskHistoryEntry = { at, from: task.status, to, reason }
  return {
    ...task,
    status: to,
    updatedAt: at,
    ...to === 'running' && task.startedAt === undefined ? { startedAt: at } : {},
    ...to === 'completed' || to === 'cancelled' ? { finishedAt: at } : {},
    history: [...task.history, history],
  }
}

export const WORKSPACE_LOCKING_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'running',
  'decision_required',
  'review_ready',
  'blocked',
])

export function holdsWorkspaceLock(task: FirstmateTask): boolean {
  return task.writeIntent === 'write' && WORKSPACE_LOCKING_STATUSES.has(task.status)
}
