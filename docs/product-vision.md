# Product vision

## Positioning

Firstmate is a management layer for DeepSeek Harness, not another agent runtime. Its job is to let a developer delegate a backlog and return only when human judgment or acceptance is necessary.

The product promise is:

> One first mate. Multiple workers.

The user owns intent, decisions, and acceptance. Firstmate owns queue durability, dependency admission, workspace safety, worker supervision, bounded recovery, and review packaging. DSH owns agent execution, model providers, continuable subagents, sessions, and lifecycle events.

## Initial users

The MVP is for independent developers, technical founders, and small teams that:

- maintain several repositories or workstreams;
- have a backlog of bugs, features, tests, and refactors;
- can review diffs, test evidence, and residual risk;
- do not want to supervise several agent conversations directly.

## User loop

1. Delegate one or more software tasks with workspaces and observable acceptance criteria.
2. Firstmate validates the request, persists it, resolves dependencies, and admits work under deterministic workspace locks.
3. Native DSH workers execute in durable, continuable sessions.
4. Firstmate handles ordinary progress and safe retry silently.
5. The user returns for `decision_required`, `review_ready`, or `blocked` items.
6. Acceptance completes the task and releases its workspace; revision continues the same worker context.

## Product principles

- **Manager-centric:** task outcomes and attention come before agent rosters or transcripts.
- **Deterministic safety:** concurrency and lifecycle rules live in code, not only in a prompt.
- **Sparse interruption:** routine progress and internal recovery do not demand attention.
- **Inspectable results:** review packages include files, Git evidence, tests, risks, and unfinished work.
- **Native composition:** use DSH extension points and do not fork or modify DSH core.
- **Human release control:** the runtime never merges, deploys, or publishes. Maintainer-approved tags may publish validated npm and GitHub Release artifacts through CI.

## MVP boundary

The first release deliberately excludes a desktop shell, terminal wall, general office automation, multiple agent runtimes, mobile UI, plugin marketplace, automatic merge, and automatic deployment. Success is a trustworthy delegation and review loop inside DSH Web, not breadth of integrations.
