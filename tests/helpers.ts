import type { FirstmateTask, ReviewResult } from '../src/shared/types.ts'

export function taskFixture(overrides: Partial<FirstmateTask> = {}): FirstmateTask {
  const at = '2026-08-15T08:00:00.000Z'
  return {
    id: 'task-1',
    title: 'Test task',
    goal: 'Make the observable behavior pass',
    context: '',
    acceptanceCriteria: ['The requested behavior is covered by tests'],
    workspace: '/tmp/firstmate-workspace',
    source: { kind: 'manual' },
    dependsOn: [],
    writeIntent: 'write',
    status: 'queued',
    createdAt: at,
    updatedAt: at,
    queuedAt: at,
    revisionCount: 0,
    retryCount: 0,
    history: [{ at, to: 'queued', reason: 'test fixture created' }],
    ...overrides,
  }
}

export function reviewFixture(summary = 'Implemented and verified the task'): ReviewResult {
  return {
    summary,
    files: ['src/example.ts'],
    diff: '1 file changed, 1 insertion(+)',
    tests: [{ command: 'npm test', outcome: 'passed', summary: 'All tests passed' }],
    risks: [],
    incomplete: [],
  }
}
