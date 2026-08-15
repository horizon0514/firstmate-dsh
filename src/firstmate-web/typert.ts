import { z } from 'zod'
import { TASK_STATUSES } from '../shared/types.ts'

const taskStatus = z.enum(TASK_STATUSES)
const taskSource = z.object({
  kind: z.enum(['manual', 'github_issue']),
  reference: z.string().optional(),
})
const taskInput = z.object({
  title: z.string(),
  goal: z.string(),
  context: z.string().optional(),
  acceptanceCriteria: z.array(z.string()),
  workspace: z.string(),
  dependsOn: z.array(z.string()).optional(),
  source: taskSource.optional(),
})
const testEvidence = z.object({
  command: z.string(),
  outcome: z.enum(['passed', 'failed', 'not_run']),
  summary: z.string(),
})
const reviewResult = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  diff: z.string().optional(),
  commit: z.string().optional(),
  tests: z.array(testEvidence),
  risks: z.array(z.string()),
  incomplete: z.array(z.string()),
})
const firstmateTask = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  context: z.string(),
  acceptanceCriteria: z.array(z.string()),
  workspace: z.string(),
  source: taskSource,
  dependsOn: z.array(z.string()),
  writeIntent: z.literal('write'),
  status: taskStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  queuedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  worker: z.object({
    id: z.string(),
    provider: z.string(),
    attempt: z.number(),
    lastHeartbeatAt: z.string(),
  }).optional(),
  decision: z.object({
    question: z.string(),
    requestedAt: z.string(),
    answer: z.string().optional(),
    answeredAt: z.string().optional(),
  }).optional(),
  result: reviewResult.optional(),
  blocked: z.object({
    reason: z.string(),
    since: z.string(),
    retryCount: z.number(),
  }).optional(),
  revisionCount: z.number(),
  retryCount: z.number(),
  history: z.array(z.object({
    at: z.string(),
    from: taskStatus.optional(),
    to: taskStatus,
    reason: z.string(),
  })),
})
const dashboardSnapshot = z.object({
  tasks: z.array(firstmateTask),
  counts: z.object({
    decision_required: z.number(),
    review_ready: z.number(),
    blocked: z.number(),
    running: z.number(),
    queued: z.number(),
    completed: z.number(),
  }),
  generatedAt: z.string(),
})
const submitRequest = z.object({ tasks: z.array(taskInput).min(1) })
const submitResult = z.object({ taskIds: z.array(z.string()) })
const decisionRequest = z.object({ taskId: z.string(), answer: z.string().min(1) })
const reviewRequest = z.object({
  taskId: z.string(),
  action: z.enum(['accept', 'revise', 'cancel']),
  feedback: z.string().optional(),
})
const taskActionRequest = z.object({ taskId: z.string() })

function codec(typeSymbol: string, schema: z.ZodType): {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly schema: z.ZodType
} {
  return { mode: 'strict', typeSymbol, schema }
}

function query(method: string, result: ReturnType<typeof codec>) {
  return {
    id: `firstmate-dsh#firstmate/${method}`,
    service: 'firstmate',
    namespace: 'firstmate',
    method,
    invocation: { kind: 'direct' as const },
    parameters: [],
    result,
  }
}

function command(method: string, requestType: string, schema: z.ZodType) {
  return {
    ...query(method, codec('firstmate-dsh#Void', z.void())),
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json' as const,
      codec: codec(requestType, schema),
    }],
  }
}

export const TYPERT = {
  package: 'firstmate-dsh',
  face: 'host',
  schemas: [],
  invocations: [
    query('snapshot', codec('firstmate-dsh#DashboardSnapshot', dashboardSnapshot)),
    {
      ...command('submit', 'firstmate-dsh#SubmitTasksRequest', submitRequest),
      result: codec('firstmate-dsh#SubmitTasksResult', submitResult),
    },
    command('decision', 'firstmate-dsh#DecisionResponseRequest', decisionRequest),
    command('review', 'firstmate-dsh#ReviewActionRequest', reviewRequest),
    command('retry', 'firstmate-dsh#TaskActionRequest', taskActionRequest),
    command('cancel', 'firstmate-dsh#TaskActionRequest', taskActionRequest),
  ],
  model: { services: [], events: [], objects: [] },
} as const
