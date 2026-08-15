import { describe, expect, it } from 'vitest'
import {
  InvalidTaskTransitionError,
  canTransition,
  holdsWorkspaceLock,
  transitionTask,
} from '../src/firstmate-core/state-machine.ts'
import { taskFixture } from './helpers.ts'

describe('Firstmate task state machine', () => {
  it('accepts the lifecycle transitions used by the manager', () => {
    expect(canTransition('queued', 'running')).toBe(true)
    expect(canTransition('running', 'decision_required')).toBe(true)
    expect(canTransition('decision_required', 'running')).toBe(true)
    expect(canTransition('running', 'review_ready')).toBe(true)
    expect(canTransition('review_ready', 'completed')).toBe(true)
    expect(canTransition('blocked', 'queued')).toBe(true)
    expect(canTransition('completed', 'running')).toBe(false)
    expect(canTransition('cancelled', 'queued')).toBe(false)
  })

  it('records a transition and rejects invalid terminal changes', () => {
    const running = transitionTask(taskFixture(), 'running', 'admitted', '2026-08-15T08:01:00.000Z')
    expect(running.status).toBe('running')
    expect(running.startedAt).toBe('2026-08-15T08:01:00.000Z')
    expect(running.history.at(-1)).toMatchObject({ from: 'queued', to: 'running', reason: 'admitted' })

    const completed = transitionTask(
      { ...running, status: 'review_ready' },
      'completed',
      'accepted',
      '2026-08-15T08:02:00.000Z',
    )
    expect(completed.finishedAt).toBe('2026-08-15T08:02:00.000Z')
    expect(() => transitionTask(completed, 'running', 'invalid', '2026-08-15T08:03:00.000Z'))
      .toThrow(InvalidTaskTransitionError)
  })

  it('keeps write workspaces locked while attention is pending', () => {
    for (const status of ['running', 'decision_required', 'review_ready', 'blocked'] as const) {
      expect(holdsWorkspaceLock(taskFixture({ status })), status).toBe(true)
    }
    expect(holdsWorkspaceLock(taskFixture({ status: 'queued' }))).toBe(false)
    expect(holdsWorkspaceLock(taskFixture({ status: 'completed' }))).toBe(false)
  })
})
