import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FirstmateTask } from '../shared/types.ts'

interface LedgerDocument {
  readonly version: 1
  readonly tasks: readonly FirstmateTask[]
}

type Listener = (tasks: readonly FirstmateTask[]) => void

function snapshot<T>(value: T): T {
  return structuredClone(value)
}

function parseDocument(raw: string): LedgerDocument {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
    || !('tasks' in value) || !Array.isArray(value.tasks)) {
    throw new Error('firstmate ledger is not a supported version-1 document')
  }
  for (const task of value.tasks) {
    if (typeof task !== 'object' || task === null || typeof task.id !== 'string'
      || typeof task.workspace !== 'string' || typeof task.status !== 'string') {
      throw new Error('firstmate ledger contains a malformed task')
    }
  }
  return value as unknown as LedgerDocument
}

export class TaskLedger {
  private tasks = new Map<string, FirstmateTask>()
  private listeners = new Set<Listener>()
  private tail: Promise<void> = Promise.resolve()
  private initialized = false

  constructor(readonly path: string) {}

  async init(): Promise<void> {
    if (this.initialized) return
    try {
      const document = parseDocument(await readFile(this.path, 'utf8'))
      this.tasks = new Map(document.tasks.map(task => [task.id, snapshot(task)]))
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      await this.persist()
    }
    this.initialized = true
  }

  list(): readonly FirstmateTask[] {
    this.assertInitialized()
    return snapshot([...this.tasks.values()])
  }

  get(id: string): FirstmateTask | undefined {
    this.assertInitialized()
    const task = this.tasks.get(id)
    return task === undefined ? undefined : snapshot(task)
  }

  async createMany(tasks: readonly FirstmateTask[]): Promise<void> {
    await this.mutate(() => {
      for (const task of tasks) {
        if (this.tasks.has(task.id)) throw new Error(`Firstmate task already exists: ${task.id}`)
        this.tasks.set(task.id, snapshot(task))
      }
    })
  }

  async update(id: string, update: (task: FirstmateTask) => FirstmateTask): Promise<FirstmateTask> {
    let result: FirstmateTask | undefined
    await this.mutate(() => {
      const current = this.tasks.get(id)
      if (current === undefined) throw new Error(`Firstmate task not found: ${id}`)
      result = snapshot(update(snapshot(current)))
      if (result.id !== id) throw new Error('Firstmate task updates cannot change task identity')
      this.tasks.set(id, result)
    })
    return snapshot(result as FirstmateTask)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async mutate(operation: () => void): Promise<void> {
    this.assertInitialized()
    const run = this.tail.then(async () => {
      const previous = this.tasks
      this.tasks = new Map([...previous].map(([id, task]) => [id, snapshot(task)]))
      try {
        operation()
        await this.persist()
      } catch (error: unknown) {
        this.tasks = previous
        throw error
      }
      const tasks = this.list()
      for (const listener of this.listeners) listener(tasks)
    })
    this.tail = run.catch(() => undefined)
    return run
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    const document: LedgerDocument = { version: 1, tasks: [...this.tasks.values()] }
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.path)
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Firstmate ledger has not been initialized')
  }
}
