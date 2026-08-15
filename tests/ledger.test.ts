import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskLedger } from '../src/firstmate-core/ledger.ts'
import { taskFixture } from './helpers.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('TaskLedger', () => {
  it('persists versioned snapshots atomically and restores them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'firstmate-ledger-'))
    roots.push(root)
    const path = join(root, 'state', 'ledger.json')
    const ledger = new TaskLedger(path)
    await ledger.init()
    await ledger.createMany([taskFixture()])
    await ledger.update('task-1', task => ({ ...task, status: 'running', updatedAt: '2026-08-15T08:01:00.000Z' }))

    const document = JSON.parse(await readFile(path, 'utf8')) as { version: number; tasks: FirstmateTask[] }
    expect(document.version).toBe(1)
    expect(document.tasks).toHaveLength(1)
    expect(document.tasks[0]?.status).toBe('running')

    const restored = new TaskLedger(path)
    await restored.init()
    expect(restored.get('task-1')).toEqual(ledger.get('task-1'))
  })

  it('serializes concurrent updates without losing either mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'firstmate-ledger-'))
    roots.push(root)
    const ledger = new TaskLedger(join(root, 'ledger.json'))
    await ledger.init()
    await ledger.createMany([taskFixture()])

    await Promise.all([
      ledger.update('task-1', task => ({ ...task, revisionCount: task.revisionCount + 1 })),
      ledger.update('task-1', task => ({ ...task, retryCount: task.retryCount + 1 })),
    ])

    expect(ledger.get('task-1')).toMatchObject({ revisionCount: 1, retryCount: 1 })
  })

  it('rolls back every item when a batch mutation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'firstmate-ledger-'))
    roots.push(root)
    const path = join(root, 'ledger.json')
    const ledger = new TaskLedger(path)
    const existing = taskFixture({ id: 'existing-task' })
    const transient = taskFixture({ id: 'transient-task' })
    await ledger.init()
    await ledger.createMany([existing])

    await expect(ledger.createMany([transient, existing])).rejects.toThrow('already exists')
    expect(ledger.get(transient.id)).toBeUndefined()

    const restored = new TaskLedger(path)
    await restored.init()
    expect(restored.get(transient.id)).toBeUndefined()
    expect(restored.get(existing.id)).toEqual(existing)
  })
})

interface FirstmateTask {
  readonly status: string
}
