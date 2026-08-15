import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type {
  DashboardCounts,
  DashboardSnapshot,
  FirstmateTask,
  ReviewActionRequest,
  SubmitTasksRequest,
  SubmitTasksResult,
  TaskInput,
} from '../shared/types.ts'
import type { TaskLedger } from '../firstmate-core/ledger.ts'
import type { FirstmateScheduler } from '../firstmate-core/scheduler.ts'

const STATUS_PRIORITY: Readonly<Record<FirstmateTask['status'], number>> = {
  decision_required: 0,
  review_ready: 1,
  blocked: 2,
  running: 3,
  queued: 4,
  completed: 5,
  cancelled: 6,
}

export class FirstmateManager {
  constructor(
    private readonly ledger: TaskLedger,
    private readonly scheduler: FirstmateScheduler,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(request: SubmitTasksRequest): Promise<SubmitTasksResult> {
    if (!Array.isArray(request.tasks) || request.tasks.length === 0) {
      throw new Error('Submit at least one task')
    }
    if (request.tasks.length > 20) throw new Error('A single submission is limited to 20 tasks')
    const tasks = await Promise.all(request.tasks.map(input => this.createTask(input)))
    const known = new Set([...this.ledger.list().map(task => task.id), ...tasks.map(task => task.id)])
    for (const task of tasks) {
      const unknown = task.dependsOn.find(id => !known.has(id) || id === task.id)
      if (unknown !== undefined) throw new Error(`Task ${task.id} has an unknown or self dependency: ${unknown}`)
    }
    await this.ledger.createMany(tasks)
    await this.scheduler.pump()
    return { taskIds: tasks.map(task => task.id) }
  }

  snapshot(): DashboardSnapshot {
    const tasks = [...this.ledger.list()].sort((left, right) =>
      STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]
      || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    const counts: { -readonly [Status in keyof DashboardCounts]: number } = {
      decision_required: 0,
      review_ready: 0,
      blocked: 0,
      running: 0,
      queued: 0,
      completed: 0,
    }
    for (const task of tasks) {
      if (task.status !== 'cancelled') counts[task.status] += 1
    }
    return { tasks, counts, generatedAt: this.timestamp() }
  }

  async answerDecision(taskId: string, answer: string): Promise<void> {
    await this.scheduler.answerDecision(taskId, answer)
  }

  async review(request: ReviewActionRequest): Promise<void> {
    if (request.action === 'accept') return this.scheduler.accept(request.taskId)
    if (request.action === 'cancel') return this.scheduler.cancel(request.taskId)
    return this.scheduler.revise(request.taskId, request.feedback ?? '')
  }

  async retry(taskId: string): Promise<void> {
    await this.scheduler.retry(taskId)
  }

  async cancel(taskId: string): Promise<void> {
    await this.scheduler.cancel(taskId)
  }

  private async createTask(input: TaskInput): Promise<FirstmateTask> {
    const title = required(input.title, 'Task title')
    const goal = required(input.goal, 'Task goal')
    const workspace = await canonicalWorkspace(input.workspace)
    const acceptanceCriteria = input.acceptanceCriteria
      .map(criterion => criterion.trim())
      .filter(Boolean)
    const at = this.timestamp()
    const needsClarification = acceptanceCriteria.length === 0
    const status = needsClarification ? 'decision_required' : 'queued'
    return {
      id: randomUUID(),
      title,
      goal,
      context: input.context?.trim() ?? '',
      acceptanceCriteria,
      workspace,
      source: input.source ?? { kind: 'manual' },
      dependsOn: [...(input.dependsOn ?? [])],
      writeIntent: 'write',
      status,
      createdAt: at,
      updatedAt: at,
      queuedAt: at,
      ...needsClarification ? {
        decision: {
          question: 'What observable outcome should Firstmate use to decide this task is complete?',
          requestedAt: at,
        },
      } : {},
      revisionCount: 0,
      retryCount: 0,
      history: [{
        at,
        to: status,
        reason: needsClarification
          ? 'critical acceptance criteria are missing'
          : 'task submitted to the persistent queue',
      }],
    }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

function required(value: string, label: string): string {
  const clean = value.trim()
  if (clean === '') throw new Error(`${label} is required`)
  return clean
}

async function canonicalWorkspace(path: string): Promise<string> {
  const clean = required(path, 'Workspace')
  const canonical = await realpath(clean)
  if (!(await stat(canonical)).isDirectory()) throw new Error(`Workspace is not a directory: ${canonical}`)
  return canonical
}
