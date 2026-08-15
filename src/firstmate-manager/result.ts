import type { ReviewResult, TestEvidence } from '../shared/types.ts'

export type WorkerEnvelope =
  | { readonly kind: 'decision_required'; readonly question: string }
  | { readonly kind: 'review_ready'; readonly result: ReviewResult }
  | { readonly kind: 'blocked'; readonly reason: string }

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function tests(value: unknown): TestEvidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null || typeof item.command !== 'string'
      || typeof item.summary !== 'string'
      || !['passed', 'failed', 'not_run'].includes(String(item.outcome))) return []
    return [{
      command: item.command,
      outcome: item.outcome as TestEvidence['outcome'],
      summary: item.summary,
    }]
  })
}

function parseJsonEnvelope(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced?.[1] ?? trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const first = candidate.indexOf('{')
    const last = candidate.lastIndexOf('}')
    if (first >= 0 && last > first) return JSON.parse(candidate.slice(first, last + 1))
    throw new Error('worker did not return a JSON result envelope')
  }
}

export function parseWorkerEnvelope(text: string): WorkerEnvelope {
  const parsed = parseJsonEnvelope(text)
  if (typeof parsed !== 'object' || parsed === null || typeof Reflect.get(parsed, 'kind') !== 'string') {
    throw new Error('worker result envelope is not an object with a kind')
  }
  const value = parsed as Record<string, unknown>
  if (value.kind === 'decision_required') {
    if (typeof value.question !== 'string' || value.question.trim() === '') {
      throw new Error('decision_required result needs a question')
    }
    return { kind: 'decision_required', question: value.question.trim() }
  }
  if (value.kind === 'blocked') {
    if (typeof value.reason !== 'string' || value.reason.trim() === '') {
      throw new Error('blocked result needs a reason')
    }
    return { kind: 'blocked', reason: value.reason.trim() }
  }
  if (value.kind !== 'review_ready') throw new Error(`unknown worker result kind: ${value.kind}`)
  if (typeof value.summary !== 'string' || value.summary.trim() === '') {
    throw new Error('review_ready result needs a summary')
  }
  return {
    kind: 'review_ready',
    result: {
      summary: value.summary.trim(),
      files: strings(value.files),
      ...typeof value.diff === 'string' && value.diff !== '' ? { diff: value.diff } : {},
      ...typeof value.commit === 'string' && value.commit !== '' ? { commit: value.commit } : {},
      tests: tests(value.tests),
      risks: strings(value.risks),
      incomplete: strings(value.incomplete),
    },
  }
}

export function fallbackReviewResult(text: string, reason: string): ReviewResult {
  return {
    summary: text.trim() || 'Worker completed without a written summary.',
    files: [],
    tests: [],
    risks: [`Structured worker report unavailable: ${reason}`],
    incomplete: [],
  }
}
