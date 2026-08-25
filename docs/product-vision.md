# Product vision

> **Status:** this document states the direction the project is moving toward. The code in `src/` still implements the delivered multi-task orchestration MVP, and `docs/architecture.md` and `docs/task-lifecycle.md` still describe that implementation. They are rewritten as the direction lands; `docs/roadmap.md` holds the staged plan.

## Positioning

Firstmate is a working secretary for one developer inside DeepSeek Harness. It watches the workspace you are actually working in, remembers what happened there, answers questions about it, and — when something needs doing — proposes one small action and waits for you.

It is not an agent runtime, a task queue, or a terminal wall.

The product promise is:

> One first mate. It watches, remembers, and answers.

The user owns intent, decisions, and acceptance. Firstmate owns observation, durable memory, recall, and the single gate in front of any action. DSH owns agent execution, model providers, continuable subagents, sessions, and lifecycle events.

## Why the direction changed

The delivered MVP asked the user to delegate a backlog: up to twenty tasks, each with a workspace, goal, context, and observable acceptance criteria. That input cost is high and the occasion is rare. A backlog specified well enough to delegate exists a few times a week, not a few times an hour.

What made that MVP feel trustworthy was never the fan-out. It was the discipline around it — an agent that is able to act, but stops at a gate and presents evidence first. That discipline is worth far more attached to something used twenty times a day than to something used twice.

So the fan-out is retired and the discipline becomes the center of the product. Execution is not removed, because an assistant that *cannot* act earns no trust by stopping. It is narrowed to one gated path, so that stopping still means something.

## Core loop

1. **Observe.** Firstmate watches the workspace: changed files, commits, commands and their outcomes, session events, and where work was left. Observation is passive and costs the user nothing.
2. **Remember.** Observations and user notes enter one durable, atomically persisted memory. Nothing depends on a model recalling a transcript.
3. **Answer.** The user asks about their own work — what changed, what broke, what was decided, what was deferred — and gets an answer that cites what it was drawn from.
4. **Propose.** When an answer implies an action, Firstmate proposes exactly one, scoped small, and stops.
5. **Report.** A confirmed action returns changed files, Git evidence, test outcomes, risks, and unfinished work, and waits for acceptance.

## Product principles

- **Observation before action.** Inspect, then propose, then act. The gate is structural, implemented in code, not a habit requested of a prompt.
- **Capture by observation, not data entry.** A memory whose only input is manual typing is empty within two weeks. The default source is what Firstmate observes in the workspace; typing is a supplement, never a prerequisite.
- **One thing at a time.** No concurrency, no workspace contention, no dependency admission, no retry budget spent unsupervised. A single active thread of work is a feature, not a limitation.
- **Sparse interruption.** Only a required decision, a result ready for review, or exhausted safe recovery may interrupt. Observation, capture, and recall never do.
- **Inspectable answers.** An answer names its source — a commit, a file, a session event, or a note the user wrote. An unsourced assertion is a defect.
- **The narrowest execution path.** Firstmate retains the ability to act so that its restraint carries meaning. Every action is proposed, confirmed, and reported with evidence.
- **Native composition.** Use DSH extension points; do not fork or modify DSH core.
- **Human release control.** The runtime never merges, deploys, or publishes. Maintainer-approved tags may publish validated npm and GitHub Release artifacts through CI; this grants the runtime no publication capability.

## Initial users

Firstmate is for independent developers, technical founders, and small teams that:

- move between several repositories or workstreams in a day;
- lose context between sessions and reconstruct it by hand;
- want recall and a second pair of eyes more than they want delegation;
- will accept an action only with evidence attached.

## Boundary

The direction deliberately excludes multi-task fan-out, parallel workers, dependency graphs, backlog management, a desktop shell, a terminal wall, general office automation, multiple agent runtimes, mobile UI, a plugin marketplace, automatic merge, and automatic deployment.

Success is a companion the user trusts with their working context — not breadth of integrations, and not throughput.
