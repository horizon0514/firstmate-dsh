export const TASK_STATUSES = [
  'queued',
  'running',
  'decision_required',
  'review_ready',
  'blocked',
  'completed',
  'cancelled',
] as const

export type TaskStatus = typeof TASK_STATUSES[number]
export type AttentionStatus = Extract<TaskStatus, 'decision_required' | 'review_ready' | 'blocked'>

export interface TaskSource {
  readonly kind: 'manual' | 'github_issue'
  readonly reference?: string
}

export interface TaskHistoryEntry {
  readonly at: string
  readonly from?: TaskStatus
  readonly to: TaskStatus
  readonly reason: string
}

export interface WorkerRef {
  readonly id: string
  readonly provider: string
  readonly attempt: number
  readonly lastHeartbeatAt: string
}

export interface DecisionRequest {
  readonly question: string
  readonly requestedAt: string
  readonly answer?: string
  readonly answeredAt?: string
}

export interface TestEvidence {
  readonly command: string
  readonly outcome: 'passed' | 'failed' | 'not_run'
  readonly summary: string
}

export interface ReviewResult {
  readonly summary: string
  readonly files: readonly string[]
  readonly diff?: string
  readonly commit?: string
  readonly tests: readonly TestEvidence[]
  readonly risks: readonly string[]
  readonly incomplete: readonly string[]
}

export interface BlockedDetail {
  readonly reason: string
  readonly since: string
  readonly retryCount: number
}

export interface FirstmateTask {
  readonly id: string
  readonly title: string
  readonly goal: string
  readonly context: string
  readonly acceptanceCriteria: readonly string[]
  readonly workspace: string
  readonly source: TaskSource
  readonly dependsOn: readonly string[]
  readonly writeIntent: 'write'
  readonly status: TaskStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly queuedAt: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly worker?: WorkerRef
  readonly decision?: DecisionRequest
  readonly result?: ReviewResult
  readonly blocked?: BlockedDetail
  readonly revisionCount: number
  readonly retryCount: number
  readonly history: readonly TaskHistoryEntry[]
}

export interface TaskInput {
  readonly title: string
  readonly goal: string
  readonly context?: string
  readonly acceptanceCriteria: readonly string[]
  readonly workspace: string
  readonly dependsOn?: readonly string[]
  readonly source?: TaskSource
}

export interface SubmitTasksRequest {
  readonly tasks: readonly TaskInput[]
}

export interface SubmitTasksResult {
  readonly taskIds: readonly string[]
}

export interface DecisionResponseRequest {
  readonly taskId: string
  readonly answer: string
}

export interface ReviewActionRequest {
  readonly taskId: string
  readonly action: 'accept' | 'revise' | 'cancel'
  readonly feedback?: string
}

export interface TaskActionRequest {
  readonly taskId: string
}

export interface DashboardCounts {
  readonly decision_required: number
  readonly review_ready: number
  readonly blocked: number
  readonly running: number
  readonly queued: number
  readonly completed: number
}

export interface DashboardSnapshot {
  readonly tasks: readonly FirstmateTask[]
  readonly counts: DashboardCounts
  readonly generatedAt: string
}

export type WorkerEvent =
  | { readonly type: 'started'; readonly taskId: string; readonly workerId: string; readonly at: string }
  | { readonly type: 'heartbeat'; readonly taskId: string; readonly workerId: string; readonly at: string }
  | { readonly type: 'decision_required'; readonly taskId: string; readonly workerId: string; readonly at: string; readonly question: string }
  | { readonly type: 'review_ready'; readonly taskId: string; readonly workerId: string; readonly at: string; readonly result: ReviewResult }
  | { readonly type: 'blocked'; readonly taskId: string; readonly workerId: string; readonly at: string; readonly reason: string }
  | { readonly type: 'failed'; readonly taskId: string; readonly workerId?: string; readonly at: string; readonly reason: string }
  | { readonly type: 'interrupted'; readonly taskId: string; readonly workerId: string; readonly at: string; readonly reason: string }
