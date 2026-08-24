import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkerEvent } from '../src/shared/types.ts'
import { DshWorkerProvider } from '../src/firstmate-dsh/provider.ts'
import { taskFixture } from './helpers.ts'

describe('DshWorkerProvider', () => {
  it('uses continuable native subagents and translates structured lifecycle events', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'firstmate-dsh-provider-'))
    const callbacks = new Map<string, (...args: any[]) => void>()
    const parent = { id: 'parent-agent' }
    const createdHandles: { dispose: ReturnType<typeof vi.fn> }[] = []
    const followups: unknown[][] = []
    const starts: any[] = []
    let childLive = true
    const raw = {
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        callbacks.set(event, callback)
        return () => undefined
      }),
      agents: {
        get: vi.fn((id: string) => id === 'fake-child-1' && childLive ? {} : undefined),
        create: vi.fn(async () => {
          const handle = { agent: parent, dispose: vi.fn(async () => undefined) }
          createdHandles.push(handle)
          return handle
        }),
        resume: vi.fn(),
      },
      sessionPersistence: { listSnapshots: vi.fn(async () => []) },
      subagents: {
        getProvider: vi.fn(() => ({ prepareContinuable: vi.fn() })),
        list: vi.fn(() => ['spawn']),
        listChildren: vi.fn(async () => [{
          kind: 'child',
          id: 'fake-child-1',
          mode: 'continuable',
          label: 'firstmate:dsh-task',
          activity: 'inactive',
          hasChildren: false,
        }]),
        startContinuable: vi.fn(async (request: any) => {
          starts.push(request)
          callbacks.get('subagent/end')?.({
            id: 'fake-child-1',
            runId: 'run-1',
            provider: 'spawn',
            stopReason: 'completed',
            lastAssistantMessage: [{
              type: 'text',
              text: JSON.stringify({
                kind: 'review_ready',
                summary: 'Implemented through DSH',
                files: ['src/adapter.ts'],
                tests: [],
                risks: [],
                incomplete: [],
              }),
            }],
          })
          return { childId: 'fake-child-1', messageId: 'message-1' }
        }),
        followup: vi.fn(async (...args: unknown[]) => { followups.push(args) }),
        interrupt: vi.fn(() => {
          childLive = false
          callbacks.get('subagent/end')?.({
            id: 'fake-child-1',
            runId: 'run-2',
            provider: 'spawn',
            stopReason: 'aborted',
          })
        }),
      },
    }
    const provider = new DshWorkerProvider(raw as unknown as Context, {
      subagentProvider: 'spawn',
      agentProvider: 'openai',
      model: 'test-model',
      maxDepth: 1,
    })
    const events: WorkerEvent[] = []
    provider.subscribe(event => events.push(event))
    const task = taskFixture({ id: 'dsh-task', workspace })

    const started = await provider.start(task, new AbortController().signal)
    expect(started).toEqual({ workerId: 'fake-child-1', provider: 'spawn' })
    expect(starts[0]).toMatchObject({
      provider: 'spawn',
      label: 'firstmate:dsh-task',
      request: {
        parent,
        maxDepth: 1,
        agentOptions: { provider: 'openai', model: 'test-model' },
      },
    })
    expect(starts[0].request.prompt[0].text).toContain('Execute this software task')
    expect(starts[0].request.prompt[0].text).toContain('Call report once')

    await vi.waitFor(() => expect(events.find(event => event.type === 'review_ready')).toMatchObject({
      taskId: 'dsh-task',
      workerId: 'fake-child-1',
      result: { summary: 'Implemented through DSH', files: ['src/adapter.ts'] },
    }))

    callbacks.get('session/event')?.({ id: 'fake-child-1' }, { type: 'turn/start' })
    callbacks.get('session/event')?.({ id: 'fake-child-1' }, { type: 'assistant/message' })
    expect(events.filter(event => event.type === 'heartbeat')).toHaveLength(1)

    const running = taskFixture({
      id: task.id,
      workspace,
      status: 'running',
      worker: {
        id: 'fake-child-1',
        provider: 'spawn',
        attempt: 1,
        lastHeartbeatAt: new Date().toISOString(),
      },
    })
    await provider.send(running, 'Continue', new AbortController().signal)
    await provider.restore(running, new AbortController().signal)
    expect(followups).toHaveLength(2)
    expect(followups[0]?.[3]).toMatchObject({ source: { kind: 'plugin', plugin: 'firstmate-dsh' } })
    expect(raw.subagents.listChildren).toHaveBeenCalledWith(parent.id, expect.any(AbortSignal))

    callbacks.get('subagent/end')?.({
      id: 'fake-child-1',
      runId: 'run-drift',
      provider: 'spawn',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'worked on something else' }],
    })
    await vi.waitFor(() => expect(events.find(event => event.type === 'failed')).toMatchObject({
      taskId: 'dsh-task',
      reason: expect.stringContaining('drifted from the structured result contract'),
    }))

    await provider.interrupt(running, 'test cancellation')
    expect(events.at(-1)).toMatchObject({ type: 'interrupted', taskId: 'dsh-task', workerId: 'fake-child-1' })

    // A terminal task drops its bookkeeping instead of pinning it for the host's lifetime.
    provider.release('dsh-task')
    const afterRelease = events.length
    callbacks.get('session/event')?.({ id: 'fake-child-1' }, { type: 'turn/start' })
    callbacks.get('subagent/end')?.({
      id: 'fake-child-1',
      runId: 'run-late',
      provider: 'spawn',
      stopReason: 'failed',
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(events).toHaveLength(afterRelease)

    await provider.dispose()
    expect(createdHandles[0]?.dispose).toHaveBeenCalledOnce()
    await rm(workspace, { recursive: true, force: true })
  })
})
