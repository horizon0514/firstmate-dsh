// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InvocationDescriptor, TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import { FirstmateService } from '../src/firstmate-web/service.ts'
import { TYPERT } from '../src/firstmate-web/typert.ts'
import { FIRSTMATE_REMOTE } from '../src/firstmate-web/client/contribution.ts'
import { apply, createFirstmateRemote, inject, name } from '../src/firstmate-web/client/index.tsx'

function descriptor(method: string): InvocationDescriptor {
  const entry = FIRSTMATE_REMOTE.descriptors.find(candidate => candidate.method === method)
  expect(entry).toBeDefined()
  return entry!
}

function parse(codec: TypertCodec, value: unknown): unknown {
  if (codec.mode !== 'strict') throw new Error('expected strict codec')
  return codec.schema.parse(value)
}

interface WireSymbols {
  readonly id: string
  readonly result: string | undefined
  readonly parameters: readonly (string | undefined)[]
}

interface MaybeStrictCodec {
  readonly mode: string
  readonly typeSymbol?: string
}

function symbolsOf(entry: {
  readonly id: string
  readonly result: MaybeStrictCodec
  readonly parameters: readonly { readonly codec: MaybeStrictCodec }[]
}): WireSymbols {
  return {
    id: entry.id,
    result: entry.result.typeSymbol,
    parameters: entry.parameters.map(parameter => parameter.codec.typeSymbol),
  }
}

describe('Firstmate Host/Client Remote contract', () => {
  it('mirrors every host method with a direct strict descriptor', () => {
    const methods = ['cancel', 'decision', 'retry', 'review', 'snapshot', 'submit']
    expect(FIRSTMATE_REMOTE.package).toBe('firstmate-dsh')
    expect(FIRSTMATE_REMOTE.descriptors.map(entry => entry.method).sort()).toEqual(methods)
    for (const entry of FIRSTMATE_REMOTE.descriptors) {
      expect(entry.id).toBe(`firstmate-dsh#firstmate/${entry.method}`)
      expect(entry.namespace).toBe('firstmate')
      expect(entry.service).toBe('firstmate')
      expect(entry.invocation).toEqual({ kind: 'direct' })
      expect(entry.result.mode).toBe('strict')
      expect(typeof FirstmateService.prototype[entry.method as keyof FirstmateService]).toBe('function')
      for (const parameter of entry.parameters) {
        expect(parameter.name).toBe('request')
        expect(parameter.wire).toBe('request')
        expect(parameter.source).toBe('json')
        expect(parameter.codec.mode).toBe('strict')
      }
    }
  })

  it('publishes matching strict Host descriptors for DSH route discovery', () => {
    expect(TYPERT.package).toBe('firstmate-dsh')
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.invocations.map(entry => entry.id)).toEqual(
      FIRSTMATE_REMOTE.descriptors.map(entry => entry.id),
    )
    for (const entry of TYPERT.invocations) {
      expect(entry.result.mode).toBe('strict')
      expect('_zod' in entry.result.schema).toBe(true)
    }
  })

  it('agrees with the Host on every wire type symbol', () => {
    // DSH routes on the type symbol, so a Client symbol derived from the method name
    // silently fails to bind to the Host descriptor it is meant to call.
    const hostSymbols = TYPERT.invocations.map(entry => symbolsOf(entry))
    const clientSymbols = FIRSTMATE_REMOTE.descriptors.map(entry => symbolsOf(entry))
    expect(clientSymbols).toEqual(hostSymbols)
    expect(hostSymbols).toContainEqual({
      id: 'firstmate-dsh#firstmate/submit',
      result: 'firstmate-dsh#SubmitTasksResult',
      parameters: ['firstmate-dsh#SubmitTasksRequest'],
    })
    expect(clientSymbols.flatMap(entry => entry.parameters)).toEqual([
      'firstmate-dsh#SubmitTasksRequest',
      'firstmate-dsh#DecisionResponseRequest',
      'firstmate-dsh#ReviewActionRequest',
      'firstmate-dsh#TaskActionRequest',
      'firstmate-dsh#TaskActionRequest',
    ])
  })

  it('validates command arguments and wire results', () => {
    const snapshot = { tasks: [], counts: {}, generatedAt: '2026-08-15T08:00:00.000Z' }
    expect(parse(descriptor('snapshot').result, snapshot)).toBe(snapshot)
    expect(() => parse(descriptor('snapshot').result, { tasks: 'bad', counts: {} })).toThrow(TypeError)

    const submit = descriptor('submit')
    expect(parse(submit.parameters[0]!.codec, { tasks: [{}] })).toEqual({ tasks: [{}] })
    expect(() => parse(submit.parameters[0]!.codec, { tasks: [] })).toThrow(TypeError)
    expect(parse(submit.result, { taskIds: ['task-1'] })).toEqual({ taskIds: ['task-1'] })

    expect(parse(descriptor('decision').parameters[0]!.codec, { taskId: 'task-1', answer: 'yes' }))
      .toEqual({ taskId: 'task-1', answer: 'yes' })
    expect(() => parse(descriptor('decision').parameters[0]!.codec, { taskId: 'task-1', answer: '' })).toThrow(TypeError)
    expect(() => parse(descriptor('review').parameters[0]!.codec, { taskId: 'task-1', action: 'merge' })).toThrow(TypeError)
    expect(parse(descriptor('cancel').result, null)).toBeUndefined()
    expect(() => parse(descriptor('cancel').result, {})).toThrow(TypeError)
  })

  it('mounts the namespace and registers both DSH-native UI slots', async () => {
    const injected: string[] = []
    const registrations: { options: { name: string; id: string; order: number }; component: unknown }[] = []
    const namespace = {
      snapshot: vi.fn(async () => ({
        ok: true as const,
        value: {
          tasks: [],
          counts: { decision_required: 0, review_ready: 0, blocked: 0, running: 0, queued: 0, completed: 0 },
          generatedAt: '',
        },
      })),
      submit: vi.fn(async () => ({ ok: true as const, value: { taskIds: [] } })),
      decision: vi.fn(async () => ({ ok: true as const, value: undefined })),
      review: vi.fn(async () => ({ ok: true as const, value: undefined })),
      retry: vi.fn(async () => ({ ok: true as const, value: undefined })),
      cancel: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const raw = {
      remote: { $mount: vi.fn(async () => () => undefined) },
      get: vi.fn((key: string) => key === 'remote.firstmate' ? namespace : undefined),
      slots: {
        inject: vi.fn((key: string, callback: () => () => void) => {
          injected.push(key)
          return callback()
        }),
        register: vi.fn((options: { name: string; id: string; order: number }, component: unknown) => {
          registrations.push({ options, component })
          return () => undefined
        }),
      },
    }

    await apply(raw as unknown as Context)
    expect(name).toBe('firstmate-web')
    expect(inject).toEqual(['remote', 'slots'])
    expect(raw.remote.$mount).toHaveBeenCalledWith(FIRSTMATE_REMOTE)
    expect(injected).toEqual(['sidebar.footer.action', 'shell.overlay'])
    expect(registrations.map(entry => entry.options)).toEqual([
      { name: 'sidebar.footer.action', id: 'firstmate', order: 10 },
      { name: 'shell.overlay', id: 'firstmate', order: 10 },
    ])
  })

  it('unwraps DSH Remote results and surfaces carrier failures', async () => {
    const namespace = {
      snapshot: vi.fn(async () => ({
        ok: true as const,
        value: {
          tasks: [],
          counts: { decision_required: 0, review_ready: 0, blocked: 0, running: 0, queued: 0, completed: 0 },
          generatedAt: '2026-08-16T08:00:00.000Z',
        },
      })),
      submit: vi.fn(async () => ({ ok: true as const, value: { taskIds: ['task-1'] } })),
      decision: vi.fn(async () => ({ ok: true as const, value: undefined })),
      review: vi.fn(async () => ({ ok: true as const, value: undefined })),
      retry: vi.fn(async () => ({ ok: true as const, value: undefined })),
      cancel: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'conflict', message: 'task already completed', details: {} },
      })),
    }
    const remote = createFirstmateRemote(namespace)

    await expect(remote.snapshot()).resolves.toMatchObject({ tasks: [] })
    await expect(remote.submit({ tasks: [{}] as never })).resolves.toEqual({ taskIds: ['task-1'] })
    await expect(remote.cancel({ taskId: 'task-1' })).rejects.toThrow(
      'Firstmate Remote failed: conflict: task already completed',
    )
  })
})
