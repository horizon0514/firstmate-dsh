# Roadmap

## MVP delivered

- Durable manual multi-task input
- Deterministic cross-workspace parallelism and same-workspace serialization
- Native continuable DSH workers
- Decision, review, blocked, queued, running, and completed views
- Bounded retry, stale recovery, interruption, and restart restoration
- Structured review packages with Git and test evidence
- Exact DSH `0.1.0-rc.6` package and Web profile smoke coverage

## Next

1. **Read-only task class:** add an explicit, user-visible task intent and permit safe read-only concurrency without model-based conflict guessing.
2. **Dependency authoring:** expose dependency selection and validation in the Web composer.
3. **Advanced diagnostics:** link from a task to its hidden DSH worker session, lifecycle history, retry attempts, and recovery evidence.
4. **Issue import:** add GitHub Issue ingestion using the existing `TaskSource` model, with preview and deduplication before submission.
5. **Ledger operations:** add export, backup, compaction, corruption diagnostics, and an intentional migration mechanism beyond version 1.
6. **Compatibility matrix:** test and document each DSH preview release before widening support.

## Later

- Team-visible task ownership and audit history
- Policy presets for retry, model/provider selection, and approval boundaries
- Richer dependency graphs and cancellation propagation
- Notification integrations that preserve the three-state interruption discipline
- Optional review integrations that prepare, but never automatically merge, a pull request

## Continuing non-goals

Firstmate is not planned as a terminal wall, tmux manager, generic office assistant, multi-runtime abstraction, or autonomous deployment system. Automatic merge, deployment, and npm publication remain outside the product's runtime trust boundary. Maintainer-approved tags may publish validated npm and GitHub Release artifacts through CI; they do not grant the runtime any publication capability.
