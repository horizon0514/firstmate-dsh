# Architecture

## System view

```text
DSH Web sidebar / overlay
          |
          | strict Typert Remote calls
          v
  FirstmateService (Host)
          |
          v
  FirstmateManager
     |          |
     v          v
 TaskLedger  FirstmateScheduler
                  |
                  v
          DshWorkerProvider
                  |
          DSH Agents / Subagents / Sessions
```

The package exposes one DSH bundle layer through `package.json#dsh.bundle` and `cordis.patch.yml`. The same package contributes a Web client bundle through `package.json#dsh.client`.

## Module boundaries

### `firstmate-core`

- `TaskLedger` owns the version-1 JSON document and serializes mutations.
- Persistence writes a mode-`0600` temporary file and atomically renames it over the ledger.
- The state machine is the authority for legal transitions and workspace-locking states.
- `FirstmateScheduler` resolves completed dependencies, admits work, supervises heartbeats, applies bounded retry, restores work, and releases locks.
- `WorkerProvider` is the narrow execution abstraction; tests use `FakeWorkerProvider`.

### `firstmate-manager`

- Validates titles, goals, canonical workspace directories, submission size, and dependencies.
- Starts tasks without acceptance criteria in `decision_required`, before a worker is created.
- Sorts the dashboard by attention priority and recency.
- Defines the worker persona and JSON result envelope.
- Parses worker outcomes and provides a review fallback when a completed worker returns malformed output.

### `firstmate-dsh`

- Creates or resumes one deterministic parent Agent session per canonical workspace.
- Starts native continuable workers with `ctx.subagents.startContinuable`.
- Discovers a persisted worker with `ctx.subagents.listChildren` before restart follow-up.
- Uses `followup` for decisions, revisions, retries, and restart recovery.
- Uses `interrupt` for cancellation and stale recovery, waiting up to 30 seconds for the lifecycle end event.
- Converts `subagent/start`, `subagent/end`, and `session/event` into structured Firstmate events.
- Rejects stale events whose worker identity no longer matches the task.
- Treats a malformed terminal result envelope as worker drift and routes it through bounded recovery rather than presenting it for review.
- Uses Git CLI only to collect changed files, diff, and current commit for review evidence; task state never depends on terminal text.

### `firstmate-web`

- `FirstmateService` composes the ledger, manager, scheduler, and DSH provider.
- A generated-shape `./typert` Host artifact registers strict DSH gateway descriptors.
- The client mounts matching strict Remote descriptors and unwraps DSH `RemoteResult` envelopes.
- `sidebar.footer.action` provides the entry; `shell.overlay` provides the manager surface.
- The overlay polls the durable snapshot every 1.5 seconds while open. Stable keyed task-detail components preserve drafted user input during refreshes.

## Scheduling invariants

Workspaces are canonicalized with `realpath` before persistence. All MVP tasks have `writeIntent: "write"`. A workspace is locked while a task is `running`, `decision_required`, `review_ready`, or `blocked`. Therefore:

- different workspaces can run concurrently;
- only one write task can own a workspace;
- queued dependants require every referenced task to be `completed`;
- review, decisions, and unresolved blockers retain the lock because their workspace may contain unaccepted changes.

These rules are implemented by the scheduler and do not rely on a model predicting file conflicts.

## Persistence and recovery

The default ledger is `$DSH_HOME/firstmate/ledger.json`; `stateFile` can override it. Startup reads the versioned document, restores tasks in `running`, and requeues a running task that has no worker identity. A durable worker identity is followed up through its native DSH session. Failed restoration consumes the same bounded retry policy as runtime failure.

The ledger is process-local and optimized for one DSH Host. It is not a distributed lock or multi-writer database.

## DSH compatibility boundary

The verified boundary is DSH `0.1.0-rc.6`:

- Cordis plugin and service lifecycle
- `ctx.agents`
- `ctx.subagents`
- Session persistence and structured session events
- Typert Host/Client Remote descriptors
- Web client module loader and CSS Modules bundle protocol
- `sidebar.footer.action` and `shell.overlay` slots

No DSH core file is forked or patched. Version-specific calls remain in `firstmate-dsh` and the Web transport layer, and CI installs the plugin into an isolated real Web profile on every change.

The named DSH worker controls and their service-level equivalents are one compatibility boundary, not a second runtime:

| DSH capability | Firstmate use |
| --- | --- |
| `list_agents` | `ctx.subagents.listChildren` verifies the durable continuable child before restart recovery. |
| `send_message` | `ctx.subagents.followup` sends decisions, revision feedback, retries, and recovery instructions. |
| `interrupt_agent` | `ctx.subagents.interrupt` stops cancellation and stale-worker turns under the exact parent authority. |
| `report` | DSH installs the child-scoped tool for continuable workers; the worker prompt requires the structured envelope to be reported before the identical terminal envelope. |

The adapter consumes the structured lifecycle end event as its deterministic completion boundary. DSH persists the child transcript, `report` handoff, and lifecycle notices in Sessions for recovery and future diagnostics.

Attention items are durable task transitions, not transient notifications. `decision_required`, `review_ready`, and `blocked` are persisted in the ledger with timestamped history, and the Web inbox derives only those three attention classes.
