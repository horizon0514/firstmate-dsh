import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeWorkerProvider } from '../src/firstmate-core/fake-worker-provider.ts'
import { TaskLedger } from '../src/firstmate-core/ledger.ts'
import { FirstmateScheduler } from '../src/firstmate-core/scheduler.ts'
import { FirstmateManager } from '../src/firstmate-manager/manager.ts'
import type { DashboardSnapshot, ReviewResult, TaskInput, TaskStatus } from '../src/shared/types.ts'

const reviewResult: ReviewResult = {
  summary: 'Implemented the requested change and verified it.',
  files: ['src/change.ts'],
  diff: '1 file changed, 4 insertions(+)',
  tests: [{ command: 'npm test', outcome: 'passed', summary: 'All tests passed' }],
  risks: [],
  incomplete: [],
}

function task(title: string, workspace: string): TaskInput {
  return { title, goal: `Complete ${title}`, acceptanceCriteria: [`${title} is verified`], workspace }
}

function printStage(stage: string, snapshot: DashboardSnapshot): void {
  const states = Object.fromEntries(snapshot.tasks.map(item => [item.title, item.status]))
  console.log(`${stage}: ${JSON.stringify({ counts: snapshot.counts, states })}`)
}

async function waitFor(ledger: TaskLedger, taskId: string, status: TaskStatus): Promise<void> {
  const deadline = Date.now() + 2_000
  while (ledger.get(taskId)?.status !== status) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${taskId} to become ${status}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'firstmate-demo-'))
  const workspaceA = join(root, 'workspace-a')
  const workspaceB = join(root, 'workspace-b')
  const stateFile = join(root, 'firstmate', 'ledger.json')
  await Promise.all([mkdir(workspaceA), mkdir(workspaceB)])

  let firstScheduler: FirstmateScheduler | undefined
  let secondScheduler: FirstmateScheduler | undefined
  try {
    const ledger = new TaskLedger(stateFile)
    await ledger.init()
    const workers = new FakeWorkerProvider()
    firstScheduler = new FirstmateScheduler(ledger, workers, {
      maxRetries: 1,
      staleAfterMs: 15 * 60_000,
      heartbeatIntervalMs: 3_600_000,
    })
    const manager = new FirstmateManager(ledger, firstScheduler)
    await firstScheduler.start()

    const { taskIds: [a1, b1, a2] } = await manager.submit({ tasks: [
      task('Workspace A: choose storage', workspaceA),
      task('Workspace B: implement endpoint', workspaceB),
      task('Workspace A: add regression test', workspaceA),
    ] })
    assert(a1 !== undefined && b1 !== undefined && a2 !== undefined)
    assert.deepEqual(workers.startedTaskIds, [a1, b1])
    assert.equal(ledger.get(a2)?.status, 'queued')
    printStage('parallel admission', manager.snapshot())

    workers.decision(a1, 'Use SQLite or PostgreSQL for the MVP?')
    workers.review(b1, { ...reviewResult, summary: 'Endpoint is ready for review.' })
    await Promise.all([waitFor(ledger, a1, 'decision_required'), waitFor(ledger, b1, 'review_ready')])
    printStage('attention inbox', manager.snapshot())

    await manager.answerDecision(a1, 'Use SQLite')
    workers.review(a1, { ...reviewResult, summary: 'SQLite implementation is ready.' })
    await waitFor(ledger, a1, 'review_ready')
    await manager.review({ taskId: a1, action: 'accept' })
    assert.equal(ledger.get(a2)?.status, 'running')
    await manager.review({ taskId: b1, action: 'accept' })
    printStage('same-workspace handoff', manager.snapshot())

    workers.review(a2, { ...reviewResult, summary: 'Regression test is ready.' })
    await waitFor(ledger, a2, 'review_ready')
    await firstScheduler.stop()
    firstScheduler = undefined

    const restoredLedger = new TaskLedger(stateFile)
    await restoredLedger.init()
    const restoredWorkers = new FakeWorkerProvider()
    secondScheduler = new FirstmateScheduler(restoredLedger, restoredWorkers, {
      maxRetries: 1,
      staleAfterMs: 15 * 60_000,
      heartbeatIntervalMs: 3_600_000,
    })
    const restoredManager = new FirstmateManager(restoredLedger, secondScheduler)
    await secondScheduler.start()
    assert.equal(restoredLedger.get(a2)?.status, 'review_ready')
    assert.equal(restoredManager.snapshot().counts.review_ready, 1)
    printStage('restart restoration', restoredManager.snapshot())

    await restoredManager.review({ taskId: a2, action: 'accept' })
    assert.equal(restoredManager.snapshot().counts.completed, 3)
    printStage('all accepted', restoredManager.snapshot())
    console.log('Demo passed: deterministic scheduling, attention handling, review, and persistence verified without a model.')
  } finally {
    await firstScheduler?.stop()
    await secondScheduler?.stop()
    await rm(root, { recursive: true, force: true })
  }
}

await main()
