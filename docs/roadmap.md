# Roadmap

> **Status:** stage 1 below is this documentation change. Stages 2 and later are not implemented; `src/` still contains the delivered orchestration MVP.

## Carried forward from the MVP

These are assets, not legacy. They survive the direction change largely intact:

- **Durable atomic ledger** (`src/firstmate-core/ledger.ts`) — becomes the memory store.
- **Gate discipline** (`src/firstmate-core/state-machine.ts`) — a decision or a review is a persisted state with timestamped history, not a transient notification.
- **Evidence collection** (`src/firstmate-dsh/git-artifacts.ts`) — the seed of ambient observation, and the basis of every reported action.
- **DSH adapter boundary** (`src/firstmate-dsh/`) — continuable sessions, lifecycle events, and the verified `0.1.0-rc.6` compatibility surface.
- **Web contribution surface** (`src/firstmate-web/`) — the sidebar entry, overlay slot, and strict Typert Host/Remote transport.

## Retired

- Multi-task submission and the twenty-task batch.
- Cross-workspace parallelism, workspace locks, and same-workspace serialization.
- Dependency admission and `dependsOn` resolution.
- Unsupervised retry budget and stale-worker recovery as a background concern.
- The six-state task dashboard as the primary surface.
- The positioning line "One first mate. Multiple workers."

## Stages

### 1. Reposition (this change)

Rewrite `docs/product-vision.md` and `docs/roadmap.md`. No code changes. The cheapest place to be wrong.

### 2. Converge the data model

Replace the task-centric `src/shared/types.ts` with a note- and thread-centric model. A memory entry must be creatable from a single sentence, with every other field optional and filled in by observation. `acceptanceCriteria`, `dependsOn`, `writeIntent`, and `workspace` locking leave the required surface.

### 3. Capture by observation

Promote `collectGitArtifacts` from review packaging to a continuous observer: changed files, commits, command outcomes, and DSH session events become memory entries without user action. Manual notes use the same store and the same shape. This stage decides whether the product lives or goes stale — a memory fed only by typing is empty in two weeks.

### 4. Recall and answer

Add retrieval and question answering over the memory. Every answer cites its sources. An answer that cannot cite says so rather than asserting.

### 5. One gated action path

Collapse `FirstmateScheduler` from a concurrent admission engine to a single-threaded proposal executor: propose one scoped action, wait for confirmation, execute in a continuable DSH worker, return an evidence package, wait for acceptance. The existing decision and review gates are reused unchanged.

### 6. Rewrite the surface

Replace the attention dashboard with a timeline and an ask box. `docs/architecture.md` and `docs/task-lifecycle.md` are rewritten against the implemented behavior at this point, not before.

### 7. Reposition the package

`firstmate-dsh@0.1.0` is published. The direction change is a breaking release: update the package description, `README.md`, `README.zh-CN.md`, and the promise line, and ship as `0.2.0` with the change documented.

## Later

- Recall across repositories, not only the active workspace.
- Retention and compaction policy for the memory store, with export and corruption diagnostics.
- Selective sharing of a recall thread with a teammate.
- Notification integrations that preserve the interruption discipline.
- Optional review integrations that prepare, but never automatically merge, a pull request.
- Compatibility matrix: verify and document each DSH preview release before widening support.

## Continuing non-goals

Firstmate is not planned as a terminal wall, tmux manager, generic office assistant, multi-runtime abstraction, backlog manager, or autonomous deployment system. Automatic merge, deployment, and npm publication remain outside the product's runtime trust boundary. Maintainer-approved tags may publish validated artifacts through CI; they grant the runtime no publication capability.
