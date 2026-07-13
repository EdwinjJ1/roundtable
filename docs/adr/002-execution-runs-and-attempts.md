# ADR 002: Durable execution runs and append-only task attempts

- **Status:** Proposed
- **Date:** 2026-07-13

## Context

Today a `LocalTurn` contains dispatch status and one `DispatchRecord` per
scheduled task, while `Mission` projects task and stage state. Runtime
conversations separately track spawned CLI activity. This supports a complete
foreground dispatch, but it does not provide a durable identity for pause,
resume, crash recovery, or multiple attempts of one task.

Overwriting a task after a retry would lose the runtime, error, timing, artifact,
and permission evidence that explains what happened.

## Decision

Add an `ExecutionRun` for each approved execution of a mission and an append-only
`TaskAttempt` for every time a task is started.

```text
Mission
  -> ExecutionRun (pins WorkflowRevision)
       -> TaskAttempt task-A / attempt 1
       -> TaskAttempt task-A / attempt 2
       -> TaskAttempt task-B / attempt 1
```

An execution run owns the durable state machine:

```text
created -> awaiting_permission -> running
running -> pause_requested -> paused -> resuming -> running
running -> completed | failed | cancelled
paused  -> cancelled
```

Invalid transitions are rejected in the action layer. `pause_requested` stops
new scheduling immediately. Pause means a safe checkpoint, not suspension of an
arbitrary operating-system process: active child processes are asked to stop,
then terminated within a bounded grace period, and their attempts finish as
interrupted. Resume reconstructs the pending frontier from durable completed
attempts and the pinned task graph.

Each attempt records at least:

- run id, logical task id, attempt number, and triggering reason;
- agent, runtime, model, runtime conversation/session id when available;
- state, timestamps, duration, and structured terminal reason;
- artifacts and file change set;
- token/cost observations and their provenance;
- requested permissions, decisions, and enforcement levels;
- the run generation (fencing token) under which it was launched.

Starting or resuming a run increments its generation. Progress and terminal
writes from workers with an older generation are ignored. This prevents a late
process from changing a paused or resumed run back to `completed`.

Retrying a task creates the next attempt number. It never mutates the old
attempt. If the new output differs, downstream completed tasks become `stale`;
the user may retain them knowingly or rerun the downstream branch. Attempt
selection for dependency inputs is explicit and auditable.

## Recovery and idempotency

Commands that create attempts use an idempotency key scoped to run, task, and
generation. On process restart, the reconciler marks attempts whose process can
no longer be proven alive as interrupted; it does not assume success. The
scheduler resumes only after reconciliation and permission validation.

Runtime-native session continuation is a capability, not a universal promise.
Claude Code and Claude Code Router currently expose session continuation in the
codebase; other runtimes may restart from an explicit context package or report
resume as unsupported.

## Consequences

- Pause, resume, retry, costs, and diagnostics share one durable source of
  truth.
- Existing turn/mission projections must become read models of execution state
  during migration rather than competing authorities.
- Runtime process control and crash reconciliation require a local executor;
  a serverless request alone cannot guarantee them.
- Append-only attempts consume more storage, so retention and artifact cleanup
  policies must preserve audit references.

## Alternatives rejected

- **Add more statuses to `LocalTurn`:** does not represent repeated attempts or
  isolate one approved execution from another.
- **Overwrite a dispatch record on retry:** destroys evidence and makes cost and
  artifact attribution ambiguous.
- **Treat pause as OS-level process suspension:** runtime and platform support is
  inconsistent and suspended processes do not create a safe durable checkpoint.
