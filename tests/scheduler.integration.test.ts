import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeWorkerProvider } from '../src/firstmate-core/fake-worker-provider.ts'
import { TaskLedger } from '../src/firstmate-core/ledger.ts'
import { FirstmateScheduler } from '../src/firstmate-core/scheduler.ts'
import { FirstmateManager } from '../src/firstmate-manager/manager.ts'
import type { TaskInput } from '../src/shared/types.ts'
import { reviewFixture, taskFixture } from './helpers.ts'

interface Suite {
  readonly root: string
  readonly workspaceA: string
  readonly workspaceB: string
  readonly ledger: TaskLedger
  readonly workers: FakeWorkerProvider
  readonly scheduler: FirstmateScheduler
  readonly manager: FirstmateManager
}

const suites: Suite[] = []

afterEach(async () => {
  await Promise.all(suites.splice(0).map(async suite => {
    await suite.scheduler.stop()
    await rm(suite.root, { recursive: true, force: true })
  }))
})

async function setup(options: { maxRetries?: number; now?: () => Date } = {}): Promise<Suite> {
  const root = await mkdtemp(join(tmpdir(), 'firstmate-scheduler-'))
  const workspaceA = join(root, 'workspace-a')
  const workspaceB = join(root, 'workspace-b')
  await Promise.all([mkdir(workspaceA), mkdir(workspaceB)])
  const ledger = new TaskLedger(join(root, 'ledger.json'))
  await ledger.init()
  const workers = new FakeWorkerProvider()
  const scheduler = new FirstmateScheduler(ledger, workers, {
    maxRetries: options.maxRetries ?? 1,
    staleAfterMs: 60_000,
    heartbeatIntervalMs: 3_600_000,
    now: options.now,
  })
  const manager = new FirstmateManager(ledger, scheduler, options.now)
  await scheduler.start()
  const suite = { root, workspaceA, workspaceB, ledger, workers, scheduler, manager }
  suites.push(suite)
  return suite
}

function input(title: string, workspace: string): TaskInput {
  return {
    title,
    goal: `Complete ${title}`,
    acceptanceCriteria: [`${title} is verified`],
    workspace,
  }
}

describe('Firstmate scheduler integration', () => {
  it('runs different workspaces in parallel and serializes writes in one workspace', async () => {
    const suite = await setup()
    const result = await suite.manager.submit({ tasks: [
      input('A1 needs a decision', suite.workspaceA),
      input('B1 is reviewable', suite.workspaceB),
      input('A2 waits', suite.workspaceA),
    ] })
    const [a1, b1, a2] = result.taskIds

    expect(suite.workers.startedTaskIds).toEqual([a1, b1])
    expect(suite.ledger.get(a1!)?.status).toBe('running')
    expect(suite.ledger.get(b1!)?.status).toBe('running')
    expect(suite.ledger.get(a2!)?.status).toBe('queued')

    suite.workers.decision(a1!, 'Use SQLite or PostgreSQL?')
    suite.workers.review(b1!, reviewFixture('B1 is ready'))
    await vi.waitFor(() => {
      expect(suite.ledger.get(a1!)?.status).toBe('decision_required')
      expect(suite.ledger.get(b1!)?.status).toBe('review_ready')
    })
    expect(suite.manager.snapshot().counts).toMatchObject({ decision_required: 1, review_ready: 1, queued: 1 })

    await suite.manager.answerDecision(a1!, 'Use SQLite for the MVP')
    expect(suite.workers.messages.at(-1)).toMatchObject({ taskId: a1 })
    suite.workers.review(a1!, reviewFixture('A1 is ready'))
    await vi.waitFor(() => expect(suite.ledger.get(a1!)?.status).toBe('review_ready'))
    expect(suite.ledger.get(a2!)?.status).toBe('queued')

    await suite.manager.review({ taskId: a1!, action: 'accept' })
    expect(suite.ledger.get(a1!)?.status).toBe('completed')
    expect(suite.ledger.get(a2!)?.status).toBe('running')
    expect(suite.workers.startedTaskIds).toEqual([a1, b1, a2])

    await suite.manager.review({ taskId: b1!, action: 'accept' })
    suite.workers.review(a2!, reviewFixture('A2 is ready'))
    await vi.waitFor(() => expect(suite.ledger.get(a2!)?.status).toBe('review_ready'))
    await suite.manager.review({ taskId: a2!, action: 'accept' })
    expect(suite.manager.snapshot().counts.completed).toBe(3)
  })

  it('asks for missing acceptance criteria before launching a worker', async () => {
    const suite = await setup()
    const result = await suite.manager.submit({ tasks: [{
      title: 'Ambiguous task',
      goal: 'Improve the module',
      acceptanceCriteria: [],
      workspace: suite.workspaceA,
    }] })
    const taskId = result.taskIds[0]!

    expect(suite.ledger.get(taskId)).toMatchObject({
      status: 'decision_required',
      decision: { question: expect.stringContaining('observable outcome') },
    })
    expect(suite.ledger.get(taskId)?.worker).toBeUndefined()
    expect(suite.workers.startedTaskIds).toEqual([])

    await suite.manager.answerDecision(taskId, 'The public API has passing unit tests')
    expect(suite.ledger.get(taskId)?.acceptanceCriteria).toContain('The public API has passing unit tests')
    expect(suite.ledger.get(taskId)?.status).toBe('running')
    expect(suite.workers.startedTaskIds).toEqual([taskId])
  })

  it('retries failures within budget, surfaces blockers, and handles revision and cancellation', async () => {
    const suite = await setup({ maxRetries: 1 })
    const { taskIds: [taskId] } = await suite.manager.submit({ tasks: [input('Recoverable task', suite.workspaceA)] })

    suite.workers.fail(taskId!, 'temporary transport error')
    await vi.waitFor(() => expect(suite.ledger.get(taskId!)).toMatchObject({ status: 'running', retryCount: 1 }))
    expect(suite.workers.messages.at(-1)?.message).toContain('Recover after this failure')

    suite.workers.fail(taskId!, 'same failure again')
    await vi.waitFor(() => expect(suite.ledger.get(taskId!)).toMatchObject({
      status: 'blocked',
      retryCount: 2,
      blocked: { reason: 'same failure again' },
    }))

    await suite.manager.retry(taskId!)
    expect(suite.ledger.get(taskId!)?.status).toBe('running')
    suite.workers.review(taskId!, reviewFixture())
    await vi.waitFor(() => expect(suite.ledger.get(taskId!)?.status).toBe('review_ready'))
    await suite.manager.review({ taskId: taskId!, action: 'revise', feedback: 'Add a regression test' })
    expect(suite.ledger.get(taskId!)).toMatchObject({ status: 'running', revisionCount: 1, result: undefined })
    expect(suite.workers.messages.at(-1)?.message).toContain('Add a regression test')

    await suite.manager.cancel(taskId!)
    expect(suite.ledger.get(taskId!)?.status).toBe('cancelled')
    expect(suite.workers.interruptedTaskIds).toContain(taskId)
  })

  it('surfaces a worker-declared blocker without consuming the automatic retry budget', async () => {
    const suite = await setup({ maxRetries: 1 })
    const { taskIds: [taskId] } = await suite.manager.submit({ tasks: [input('Needs credentials', suite.workspaceA)] })
    suite.workers.block(taskId!, 'A repository credential must be supplied by the user')
    await vi.waitFor(() => expect(suite.ledger.get(taskId!)).toMatchObject({
      status: 'blocked',
      retryCount: 0,
      blocked: { reason: 'A repository credential must be supplied by the user' },
    }))
  })

  it('recovers stale and interrupted workers through the deterministic retry budget', async () => {
    let current = new Date('2026-08-15T08:00:00.000Z')
    const suite = await setup({ maxRetries: 1, now: () => current })
    const { taskIds: [taskId] } = await suite.manager.submit({ tasks: [input('Long task', suite.workspaceA)] })

    current = new Date('2026-08-15T08:02:00.000Z')
    await suite.scheduler.recoverStale(current)
    expect(suite.workers.interruptedTaskIds).toContain(taskId)
    expect(suite.ledger.get(taskId!)).toMatchObject({ status: 'running', retryCount: 1 })
    expect(suite.ledger.get(taskId!)?.history.filter(entry => entry.reason.includes('automatic retry'))).toHaveLength(1)

    suite.workers.interrupted(taskId!, 'worker exited')
    await vi.waitFor(() => expect(suite.ledger.get(taskId!)).toMatchObject({ status: 'blocked', retryCount: 2 }))
  })

  it('requeues a worker creation failure without deadlocking the active pump', async () => {
    const suite = await setup({ maxRetries: 1 })
    const task = taskFixture({ id: 'start-failure-task', workspace: suite.workspaceA })
    suite.workers.failNextStart(task.id)
    await suite.ledger.createMany([task])

    await suite.scheduler.pump()
    await vi.waitFor(() => expect(suite.ledger.get(task.id)).toMatchObject({
      status: 'running',
      retryCount: 1,
      worker: { provider: 'fake', attempt: 2 },
    }))
    expect(suite.workers.startedTaskIds).toEqual([task.id])
  })

  it('ignores lifecycle events from a stale worker identity', async () => {
    const suite = await setup()
    const running = taskFixture({
      id: 'stale-event-task',
      workspace: suite.workspaceA,
      status: 'running',
      worker: {
        id: 'current-worker',
        provider: 'fake',
        attempt: 2,
        lastHeartbeatAt: '2026-08-15T08:00:00.000Z',
      },
    })
    await suite.ledger.createMany([running])

    suite.workers.publish({
      type: 'review_ready',
      taskId: running.id,
      workerId: 'old-worker',
      at: '2026-08-15T08:01:00.000Z',
      result: reviewFixture(),
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(suite.ledger.get(running.id)?.status).toBe('running')
  })
})
