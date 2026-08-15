import type { FirstmateTask } from '../shared/types.ts'

export const FIRSTMATE_WORKER_PERSONA = `You are a Firstmate worker executing exactly one software task.
Work directly in the assigned workspace. Inspect before editing, keep changes focused, and run the relevant tests.
Do not ask the end user routine questions. When a decision is truly required, stop and return the decision_required JSON envelope.
Do not merge, deploy, publish packages, or create releases.
Your final assistant message must contain only one JSON object matching one of the documented envelopes.`

export function initialWorkerPrompt(task: FirstmateTask): string {
  return `Execute this software task.

Title: ${task.title}
Goal: ${task.goal}
Context: ${task.context || '(none provided)'}
Workspace: ${task.workspace}
Acceptance criteria:
${task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')}

Return only one JSON object:
- Decision needed: {"kind":"decision_required","question":"..."}
- Blocked after your own safe recovery attempts: {"kind":"blocked","reason":"..."}
- Ready for review: {"kind":"review_ready","summary":"...","files":["..."],"diff":"optional concise diff or stat","commit":"optional hash","tests":[{"command":"...","outcome":"passed|failed|not_run","summary":"..."}],"risks":["..."],"incomplete":["..."]}

Do not wrap the JSON in Markdown.`
}
