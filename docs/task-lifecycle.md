# Task lifecycle

> **Status:** this document describes the delivered multi-task orchestration implementation in `src/`. The project direction has changed; see `docs/product-vision.md`. This document is rewritten once the new behavior is implemented.

## States

| State | Meaning | User attention | Holds workspace lock |
| --- | --- | --- | --- |
| `queued` | Durable task waiting for dependencies or workspace admission | No | No |
| `running` | A native DSH worker owns the task | No | Yes |
| `decision_required` | A critical acceptance or execution decision is missing | Yes | Yes |
| `review_ready` | The acceptance package is ready | Yes | Yes |
| `blocked` | Safe retry is exhausted or the worker declared a real blocker | Yes | Yes |
| `completed` | User accepted the result | No | No |
| `cancelled` | User ended the task | No | No |

All MVP tasks are write tasks. Holding the lock through decision, review, and blocked states prevents another task from changing the same workspace before the current outcome is resolved.

## Transition table

| From | Allowed destinations |
| --- | --- |
| `queued` | `running`, `decision_required`, `blocked`, `cancelled` |
| `running` | `queued`, `decision_required`, `review_ready`, `blocked`, `cancelled` |
| `decision_required` | `queued`, `running`, `blocked`, `cancelled` |
| `review_ready` | `running`, `completed`, `cancelled` |
| `blocked` | `queued`, `running`, `cancelled` |
| `completed` | none |
| `cancelled` | none |

Each actual transition appends a timestamped history entry with its reason. Terminal states cannot be reopened.

## Clarification

If a submission has no non-empty acceptance criterion, Firstmate does not start a worker. It creates a `decision_required` item asking for an observable completion condition. The answer is added to the task's acceptance criteria, the task returns to `queued`, and normal admission begins.

An active worker can also return a structured `decision_required` envelope. Answering it moves the task back to `running` and sends the answer to the same continuable worker.

## Review

A worker completion is converted to `review_ready`. The review package contains:

- completion summary;
- changed files;
- diff and current commit when Git can provide them;
- commands and test outcomes;
- known risks and incomplete work.

The user can:

- **Accept:** transition to `completed` and release the workspace.
- **Request changes:** transition to `running`, increment the revision count, and follow up the same worker with feedback.
- **Cancel:** interrupt an active worker when present and transition to `cancelled`.

Firstmate does not merge or deploy accepted work.

## Failure and recovery

Worker start failures, failed lifecycle endings, interruptions, stale heartbeats, restart restoration failures, failed followups, and malformed structured result envelopes enter one bounded recovery path. A malformed envelope is deterministic evidence that the worker drifted from its result contract; it is never promoted to `review_ready`. Every automatic attempt increments `retryCount` and adds a history entry. When the configured budget is exceeded, the task becomes `blocked`; delivery failure during an attempted recovery also blocks the task.

For a stale running worker, Firstmate first asks DSH to interrupt it, then records the failure once. The matching interruption lifecycle event is suppressed while stale recovery owns that failure, so one abort consumes exactly one retry. Cancellation waits for a matching structured DSH end event, with a 30-second bound. Events from an old worker id are ignored after task ownership changes.

On DSH restart, running tasks with a worker id reattach through the persistent DSH parent and continuable child session. Running tasks without a worker id are requeued. Decision, review, and blocked states need no worker restoration and remain durable attention items.

## Interruption discipline

Only these states appear in the attention inbox:

1. `decision_required`
2. `review_ready`
3. `blocked`

Queued work, admission, heartbeats, ordinary progress, automatic retries, recovery messages, and worker-to-manager lifecycle traffic do not interrupt the user. Worker transcripts remain available in DSH persistence for future diagnostics but are not part of the default Firstmate surface.
