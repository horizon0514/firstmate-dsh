import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeWorkerProvider } from '../src/firstmate-core/fake-worker-provider.ts'
import { TaskLedger } from '../src/firstmate-core/ledger.ts'
import { FirstmateScheduler } from '../src/firstmate-core/scheduler.ts'
import { FirstmateManager } from '../src/firstmate-manager/manager.ts'

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
})
