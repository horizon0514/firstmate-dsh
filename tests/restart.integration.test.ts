import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeWorkerProvider } from '../src/firstmate-core/fake-worker-provider.ts'
import { TaskLedger } from '../src/firstmate-core/ledger.ts'
import { FirstmateScheduler } from '../src/firstmate-core/scheduler.ts'
import { FirstmateManager } from '../src/firstmate-manager/manager.ts'
import { taskFixture } from './helpers.ts'

describe('DSH restart recovery', () => {
  it('restores a durable running worker and preserves queued work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'firstmate-restart-'))
    const workspace = join(root, 'workspace')
    const stateFile = join(root, 'ledger.json')
    await mkdir(workspace)

    const firstLedger = new TaskLedger(stateFile)
    await firstLedger.init()
    const firstWorkers = new FakeWorkerProvider()
    const firstScheduler = new FirstmateScheduler(firstLedger, firstWorkers, {
      maxRetries: 1,
      staleAfterMs: 60_000,
      heartbeatIntervalMs: 3_600_000,
    })
    await firstScheduler.start()
    const manager = new FirstmateManager(firstLedger, firstScheduler)
    const result = await manager.submit({ tasks: [
      { title: 'Running', goal: 'Keep running', acceptanceCriteria: ['Done'], workspace },
      { title: 'Queued', goal: 'Wait safely', acceptanceCriteria: ['Done'], workspace },
    ] })
    await firstScheduler.stop()

    const secondLedger = new TaskLedger(stateFile)
    await secondLedger.init()
    const secondWorkers = new FakeWorkerProvider()
    const secondScheduler = new FirstmateScheduler(secondLedger, secondWorkers, {
      maxRetries: 1,
      staleAfterMs: 60_000,
      heartbeatIntervalMs: 3_600_000,
    })
    await secondScheduler.start()
    try {
      expect(secondWorkers.restoredTaskIds).toEqual([result.taskIds[0]])
      expect(secondWorkers.startedTaskIds).toEqual([])
      expect(secondLedger.get(result.taskIds[0]!)?.status).toBe('running')
      expect(secondLedger.get(result.taskIds[1]!)?.status).toBe('queued')
    } finally {
      await secondScheduler.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restarts the heartbeat clock so downtime does not look like a stalled worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'firstmate-restart-heartbeat-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const ledger = new TaskLedger(join(root, 'ledger.json'))
    await ledger.init()
    // DSH was down for an hour, so the persisted heartbeat is far outside the stale window.
    await ledger.createMany([taskFixture({
      id: 'downtime-task',
      workspace,
      status: 'running',
      worker: { id: 'durable-worker', provider: 'fake', attempt: 1, lastHeartbeatAt: '2026-08-15T08:00:00.000Z' },
    })])

    const workers = new FakeWorkerProvider()
    const scheduler = new FirstmateScheduler(ledger, workers, {
      maxRetries: 1,
      staleAfterMs: 60_000,
      heartbeatIntervalMs: 3_600_000,
      now: () => new Date('2026-08-15T09:00:00.000Z'),
    })
    await scheduler.start()
    try {
      expect(workers.restoredTaskIds).toEqual(['downtime-task'])
      expect(ledger.get('downtime-task')?.worker?.lastHeartbeatAt).toBe('2026-08-15T09:00:00.000Z')

      await scheduler.recoverStale(new Date('2026-08-15T09:00:30.000Z'))
      expect(ledger.get('downtime-task')).toMatchObject({ status: 'running', retryCount: 0 })
      expect(workers.interruptedTaskIds).toEqual([])
    } finally {
      await scheduler.stop()
      await rm(root, { recursive: true, force: true })
    }
  })
})
