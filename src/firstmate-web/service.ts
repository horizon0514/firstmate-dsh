import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { TaskLedger } from '../firstmate-core/ledger.ts'
import { FirstmateScheduler } from '../firstmate-core/scheduler.ts'
import { DshWorkerProvider } from '../firstmate-dsh/provider.ts'
import { FirstmateManager } from '../firstmate-manager/manager.ts'
import type {
  DashboardSnapshot,
  DecisionResponseRequest,
  ReviewActionRequest,
  SubmitTasksRequest,
  SubmitTasksResult,
  TaskActionRequest,
} from '../shared/types.ts'

export interface FirstmateConfig {
  readonly stateFile?: string
  readonly subagentProvider?: string
  readonly agentProvider?: string
  readonly model?: string
  readonly maxDepth?: number
  readonly maxRetries?: number
  readonly staleAfterMs?: number
}

interface ResolvedFirstmateConfig {
  readonly stateFile: string
  readonly subagentProvider: string
  readonly agentProvider?: string
  readonly model?: string
  readonly maxDepth: number
  readonly maxRetries: number
  readonly staleAfterMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    firstmate: FirstmateService
  }
}

function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return configured === undefined || configured === '' ? join(homedir(), '.dsh') : configured
}

export class FirstmateService extends TypertRemoteService {
  static inject = ['agents', 'subagents', 'sessionPersistence']

  static Config: s<FirstmateConfig> = s.object({
    stateFile: s.string().default(join(dshHome(), 'firstmate', 'ledger.json')),
    subagentProvider: s.string().default('spawn'),
    agentProvider: s.string(),
    model: s.string(),
    maxDepth: s.number().default(1),
    maxRetries: s.number().default(1),
    staleAfterMs: s.number().default(15 * 60 * 1000),
  })

  private readonly ready: Promise<void>
  private readonly workers: DshWorkerProvider
  private readonly scheduler: FirstmateScheduler
  private readonly ledger: TaskLedger
  private manager: FirstmateManager | undefined

  constructor(ctx: Context, config: FirstmateConfig = {}) {
    super(ctx, 'firstmate')
    const resolved = resolveConfig(config)
    this.ledger = new TaskLedger(resolved.stateFile)
    this.workers = new DshWorkerProvider(ctx, {
      subagentProvider: resolved.subagentProvider,
      agentProvider: resolved.agentProvider,
      model: resolved.model,
      maxDepth: resolved.maxDepth,
    })
    this.scheduler = new FirstmateScheduler(this.ledger, this.workers, {
      maxRetries: resolved.maxRetries,
      staleAfterMs: resolved.staleAfterMs,
      onError: error => ctx.logger.error(`firstmate scheduler: ${renderError(error)}`),
    })
    this.ready = this.initialize()
    ctx.effect(() => async () => {
      await this.ready.catch(() => undefined)
      await this.scheduler.stop()
      await this.workers.dispose()
    }, 'firstmate: runtime')
  }

  @Remote('snapshot')
  async snapshot(): Promise<DashboardSnapshot> {
    return (await this.requireManager()).snapshot()
  }

  @Remote('submit')
  async submit(request: SubmitTasksRequest): Promise<SubmitTasksResult> {
    return (await this.requireManager()).submit(request)
  }

  @Remote('decision')
  async decision(request: DecisionResponseRequest): Promise<void> {
    await (await this.requireManager()).answerDecision(request.taskId, request.answer)
  }

  @Remote('review')
  async review(request: ReviewActionRequest): Promise<void> {
    await (await this.requireManager()).review(request)
  }

  @Remote('retry')
  async retry(request: TaskActionRequest): Promise<void> {
    await (await this.requireManager()).retry(request.taskId)
  }

  @Remote('cancel')
  async cancel(request: TaskActionRequest): Promise<void> {
    await (await this.requireManager()).cancel(request.taskId)
  }

  private async initialize(): Promise<void> {
    await this.ledger.init()
    this.manager = new FirstmateManager(this.ledger, this.scheduler)
    await this.scheduler.start()
  }

  private async requireManager(): Promise<FirstmateManager> {
    await this.ready
    if (this.manager === undefined) throw new Error('Firstmate manager did not initialize')
    return this.manager
  }
}

function resolveConfig(config: FirstmateConfig): ResolvedFirstmateConfig {
  const maxDepth = integerAtLeast(config.maxDepth ?? 1, 0, 'maxDepth')
  const maxRetries = integerAtLeast(config.maxRetries ?? 1, 0, 'maxRetries')
  const staleAfterMs = integerAtLeast(config.staleAfterMs ?? 15 * 60 * 1000, 1_000, 'staleAfterMs')
  return {
    stateFile: config.stateFile ?? join(dshHome(), 'firstmate', 'ledger.json'),
    subagentProvider: config.subagentProvider ?? 'spawn',
    ...(config.agentProvider === undefined || config.agentProvider.trim() === '' ? {} : { agentProvider: config.agentProvider }),
    ...(config.model === undefined || config.model.trim() === '' ? {} : { model: config.model }),
    maxDepth,
    maxRetries,
    staleAfterMs,
  }
}

function integerAtLeast(value: number, minimum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`Firstmate ${field} must be a safe integer >= ${minimum}`)
  }
  return value
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}
