# Firstmate for DeepSeek Harness

> One first mate. Multiple workers.
>
> Delegate multiple software tasks and only return for decisions and review-ready results.

[![CI](https://github.com/horizon0514/firstmate-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/horizon0514/firstmate-dsh/actions/workflows/ci.yml)

Firstmate is a manager-centric task orchestration plugin for DeepSeek Harness (DSH). Give it several software tasks across one or more repositories; deterministic code controls admission, persistence, retry, recovery, and user attention while DSH's native continuable subagents do the work.

This is not a terminal wall or a collection of agent chats. The primary surface is an attention inbox for the only three states that should interrupt you: a decision is required, a result is ready for review, or safe recovery has been exhausted.

[Chinese documentation / 中文文档](./README.zh-CN.md)

## MVP capabilities

- Submit up to 20 tasks at once, each with a workspace, goal, context, and acceptance criteria.
- Run write tasks concurrently across different canonical workspaces and serially within the same workspace.
- Persist the task ledger atomically at `$DSH_HOME/firstmate/ledger.json` by default.
- Restore active work after a DSH restart and recover stale workers within a bounded retry budget.
- Use native DSH Agents, continuable Subagents, Session persistence, and lifecycle events.
- Keep worker transcripts out of the main UI while presenting changed files, Git evidence, tests, risks, and incomplete work for review.
- Accept, request changes, retry, cancel, or answer a required decision from the Firstmate surface.

## Compatibility

The MVP is tested against **DeepSeek Harness `0.1.0-rc.6` exactly**. DSH is a developer preview with breaking API changes; Firstmate isolates all DSH-specific calls in `firstmate-dsh`, but other versions are not supported until verified.

Prerequisites:

- Node.js `22.19+` or `24+`
- pnpm `10+` on `PATH` for `dsh plugin` profile management
- DeepSeek Harness `0.1.0-rc.6`
- Git for review evidence

## Install from source

The MVP has not been published to npm. Build the checkout, then add it to the DSH Web profile:

```sh
git clone https://github.com/horizon0514/firstmate-dsh.git
cd firstmate-dsh
git checkout feat/firstmate-mvp
npm ci
npm run build

dsh plugin --profile web add "$(pwd)"
dsh web --dump-config
dsh web --host 127.0.0.1 --port 3080
```

The config dump should contain a `firstmate` row from the `firstmate-dsh` layer. Open `http://127.0.0.1:3080`, then select **Firstmate** in the sidebar footer.

To use the exact CLI without a global DSH install:

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add "$(pwd)"
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 web --host 127.0.0.1 --port 3080
```

Remove the plugin with:

```sh
dsh plugin --profile web remove firstmate-dsh
```

## Demo and validation

The deterministic demo uses fake workers and no model credentials or model cost:

```sh
npm run demo
```

It proves that two workspaces run in parallel, a second write task in the same workspace waits, decision and review events enter the inbox, acceptance releases the workspace, and restart preserves pending review.

Run the full local gate and the isolated DSH install/start smoke:

```sh
npm run gate
npm run smoke:dsh
```

`smoke:dsh` creates a temporary `DSH_HOME`, installs the checkout into a fresh Web profile, verifies the composed config, starts Web on an OS-assigned port, fetches the Firstmate client bundle, calls the strict Host Remote snapshot endpoint, and terminates the server.

## Configuration

Defaults live in [`cordis.patch.yml`](./cordis.patch.yml). Override the `firstmate` row in the Web profile's `cordis.patch.yml` when needed:

| Field | Default | Meaning |
| --- | --- | --- |
| `stateFile` | `$DSH_HOME/firstmate/ledger.json` | Versioned durable task ledger |
| `subagentProvider` | `spawn` | DSH continuable subagent provider |
| `agentProvider` | DSH default | Optional parent/worker agent provider |
| `model` | DSH default | Optional parent/worker model |
| `maxDepth` | `1` | Worker subagent depth |
| `maxRetries` | `1` | Automatic retry budget before `blocked` |
| `staleAfterMs` | `900000` | Running-worker heartbeat timeout |

## Current limitations

- Every MVP task is treated as a write task; read-only parallelism is not exposed.
- Task creation is manual. The model permits future GitHub Issue sources, but no importer is included.
- Dependencies can be supplied through the Host API but are not editable in the Web composer yet.
- Worker transcripts remain in DSH sessions and are intentionally hidden; there is no advanced diagnostics link in the MVP UI.
- The ledger is a single local JSON document, intended for one DSH process rather than distributed coordination.
- A valid DSH model/provider configuration is required for real workers. Tests, the demo, and smoke checks do not require one.
- Firstmate never merges, deploys, publishes packages, or creates releases.

## Documentation

- [Product vision](./docs/product-vision.md)
- [Architecture](./docs/architecture.md)
- [Task lifecycle](./docs/task-lifecycle.md)
- [Development](./docs/development.md)
- [Roadmap](./docs/roadmap.md)

## License

[MIT](./LICENSE)
