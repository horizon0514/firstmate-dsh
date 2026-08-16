import { describe, expect, it } from 'vitest'
import { parseWorkerEnvelope } from '../src/firstmate-manager/result.ts'

describe('worker result envelopes', () => {
  it('parses decision, blocker, and review envelopes', () => {
    expect(parseWorkerEnvelope('{"kind":"decision_required","question":"Choose a database"}'))
      .toEqual({ kind: 'decision_required', question: 'Choose a database' })
    expect(parseWorkerEnvelope('```json\n{"kind":"blocked","reason":"Missing credentials"}\n```'))
      .toEqual({ kind: 'blocked', reason: 'Missing credentials' })
    expect(parseWorkerEnvelope(JSON.stringify({
      kind: 'review_ready',
      summary: 'Implemented the endpoint',
      files: ['src/api.ts', 42],
      tests: [{ command: 'npm test', outcome: 'passed', summary: 'green' }, { command: 1 }],
      risks: ['Preview API'],
      incomplete: [],
    }))).toEqual({
      kind: 'review_ready',
      result: {
        summary: 'Implemented the endpoint',
        files: ['src/api.ts'],
        tests: [{ command: 'npm test', outcome: 'passed', summary: 'green' }],
        risks: ['Preview API'],
        incomplete: [],
      },
    })
  })

  it('rejects malformed envelopes so the scheduler can recover worker drift', () => {
    expect(() => parseWorkerEnvelope('{"kind":"decision_required","question":""}')).toThrow(/question/)
    expect(() => parseWorkerEnvelope('{"kind":"unknown"}')).toThrow(/unknown/)
    expect(() => parseWorkerEnvelope('not json')).toThrow()
  })
})
