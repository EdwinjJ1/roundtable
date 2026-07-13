# Roundtable Architecture

Roundtable is a visual workflow and governance layer over local AI coding
runtimes such as Claude Code, Codex, and OpenCode. It turns an AI coding session
into a plan that can be reviewed, executed as a dependency graph, and inspected
through its artifacts and decisions.

> **Implementation status:** this document separates the architecture that
> exists today from proposed release work. A section or diagram labelled
> **Proposed** is a design target, not a claim about the current product.

## System shape

```text
Next.js UI / CLI / REST / tRPC
              |
              v
       server action layer
  (turns, missions, workflows)
              |
              v
   scheduler ---- runtime adapters
       |          |-- local-dispatch
       |          |-- Claude Code / router
       |          |-- Codex / OpenCode
       |          |-- E2B / model adapters
       v
 artifacts, handoffs, safety findings
              |
              v
     JSON or Postgres store
```

### Interfaces

The Next.js workbench is the primary interface. REST routes under
`src/app/api/orchestrator` and the tRPC router call the same server action
layer; the CLI also enters through that business layer. Interface code should
validate and translate requests, not reimplement mission rules.

### Action layer

`src/server/actions` owns orchestration and domain transitions:

- turn creation performs intake, resolves a workflow, runs planning, and parks
  execution at clarification or approval gates;
- mission actions project persisted turns into user-facing stages, tasks,
  checkpoints, decisions, and final delivery state;
- approval moves an eligible turn into dispatch; web approval starts dispatch
  in the background;
- read actions assemble artifacts, handoffs, runtime activity, and history for
  the UI.

`LocalTurn` currently holds the resolved workflow snapshot, plan, dispatch
records, artifacts, and a mission projection. `Mission` carries the durable,
cross-turn view of a goal. These records overlap by design today; new code
should not add another execution state without reconciling both views.

### Scheduler and runtimes

`src/server/actions/scheduler.ts` is a runtime-agnostic DAG primitive. It checks
dependencies before execution, runs ready tasks in parallel waves, allows
independent branches to continue after a failure, blocks downstream tasks, and
can derive bounded fixer tasks. It does not enforce permissions or own process
lifecycle.

The dispatch action binds scheduler tasks to agents and workspaces. The agent
runner selects an adapter. `local-dispatch` is deterministic and intended for
development, CI, and demos; it is not evidence that a real local coding runtime
was used. CLI adapters probe installation and authentication, spawn a local
process, parse runtime events, and persist a runtime conversation. Claude Code
and Claude Code Router sessions can currently be saved for later continuation.

Artifacts and handoffs are first-class run output. Safety scanning checks agent
artifacts before delivery, but it is not a process sandbox or a replacement for
runtime permission enforcement.

### Persistence

`src/server/store.ts` exposes a shared `readData` / `mutateData` abstraction:

- the default local driver stores one normalized JSON document at
  `.roundtable/data.json` and serializes in-process mutations;
- a legacy Postgres JSONB driver stores the same document in one row;
- the production-default Postgres driver maps the aggregate to normalized
  tables.

Domain changes must work with both the local JSON and normalized Postgres
drivers. Stored records are normalized on read for backward compatibility.
Schema evolution must preserve existing turns, missions, artifacts, and runtime
conversations.

## Local and hosted trust boundary

Roundtable's differentiating capability depends on processes and files on the
user's machine. A hosted Next.js server cannot directly use a browser visitor's
Claude Code or Codex login, filesystem, or CLI process.

Current self-hosted/local deployments place the UI, action layer, store, and
runtime process in the same host trust boundary. Production workspaces resolve
under `ROUNDTABLE_WORKSPACE_ROOT/{ownerId}/{workbenchId}` by default. Custom
workspace paths are ignored in production unless explicitly enabled.

Hosted deployments may provide a demo, collaboration UI, or persisted metadata,
but must not imply that a remote server has access to the user's local runtime.
Any future hosted product that performs local work requires an authenticated
local bridge or desktop service with explicit, scoped capability grants.

### Proposed local execution boundary

```text
Hosted or local UI
       |
       | authenticated, user-approved requests
       v
Local bridge / desktop service
       |-- workspace capability grants
       |-- process lifecycle and cancellation
       |-- network and command policy
       |-- runtime login remains local
       v
Claude Code / Codex / OpenCode + local files
```

The bridge must reject requests outside its grant; the hosted service must not
receive CLI credentials. Transport security alone does not establish authority
to read a file, write a file, execute a command, or access the network.

## Proposed durable execution model

The next foundation introduces two independent identities:

- `WorkflowRevision`: an immutable definition of *what should run*;
- `ExecutionRun` with `TaskAttempt` children: a durable record of *what did
  run*.

A mission pins a workflow revision and resolved snapshot. An execution run pins
that same revision and owns lifecycle state. Every retry creates a new attempt;
it never overwrites evidence from an earlier attempt. See
[ADR 001](adr/001-workflow-revisions.md) and
[ADR 002](adr/002-execution-runs-and-attempts.md).

Permissions are evaluated before process launch and reported with an honest
enforcement level. See [ADR 003](adr/003-permission-enforcement.md).

## Architectural invariants

1. A plan is approved before a real coding runtime starts.
2. A historical run remains attributable to the exact workflow definition that
   produced it.
3. A retry appends evidence; it does not rewrite history.
4. A task cannot broaden its workspace, command, or network authority by
   changing a prompt.
5. `local-dispatch` and real runtime execution are visibly distinguishable.
6. Missing token or cost data is `unavailable`, never silently represented as
   zero.
7. User source, prompts, secrets, paths, and diffs are not telemetry.
8. The JSON and normalized Postgres stores express the same domain semantics.

## Testing philosophy

Tests protect observable behavior and release risks, not implementation shape or
coverage targets.

- Vitest unit and integration tests own domain contracts: workflow validation,
  state transitions, DAG ordering, authorization, migrations, runtime protocol
  parsing, redaction, and failure recovery. Prefer testing through a stable
  action or module boundary over asserting private call order.
- Playwright owns a small number of cross-layer user journeys that a module test
  cannot prove: create a mission, inspect and approve its plan, execute it,
  observe artifacts/review, reload, and recover history. Real-runtime smoke
  tests are a separate opt-in lane because they require installed and
  authenticated CLIs.
- Each material risk should have one clearest lowest-layer test plus a
  cross-layer test only when integration itself is the risk. Duplicating the
  same assertion across every layer makes the suite slower without adding
  confidence.
- Coverage reports identify unexamined behavior; a percentage is not a product
  requirement. Do not add tests solely to increase line coverage.
- Avoid brittle snapshots, exact incidental copy, timers, private helpers, and
  mock choreography unless those details are themselves a public contract.

The release quality gate is build, typecheck, lint, domain/integration tests, and
the deterministic Playwright golden path. A failing or flaky gate blocks release
rather than being retried until green.

## Module ownership guidance

- UI components render state and issue intent; they do not decide domain
  transitions.
- API routes and tRPC procedures authenticate, validate, and call actions.
- Action modules own use cases and authorization checks.
- The scheduler owns graph ordering only.
- Runtime adapters own protocol translation and process I/O only.
- Permission enforcement belongs at the local execution boundary, before a
  runtime is spawned.
- The store persists domain records and migrations; it does not invent business
  state.
