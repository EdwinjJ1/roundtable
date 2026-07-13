# Roundtable Roadmap

> **Product direction:** Turn AI coding sessions into reusable, reviewable
> workflows.

Roundtable is a visual workflow and governance layer for local AI agents such as
Claude Code and Codex. The beta is for people who can build with AI tools but
want more control, repeatability, and evidence than several disconnected
terminal sessions provide.

Roadmap items are intentions, not commitments or claims about current behavior.
Architecture proposals are recorded under `docs/adr/`.

## Current foundation

- visual workbench with planning and user approval;
- dependency-aware parallel scheduler and bounded reviewer/fixer loop;
- deterministic `local-dispatch` demo adapter;
- local Claude Code, Codex, OpenCode, and configured adapter integration;
- artifacts, handoffs, safety findings, runtime activity, and mission history;
- local JSON and normalized Postgres persistence;
- shared action layer for UI, REST, tRPC, and CLI.

## `v0.1.0-beta.1` release scope

### Durable, reviewable workflows

- immutable, owner-scoped Workflow and WorkflowRevision records;
- each mission/run pinned to an exact revision and content hash;
- versioned `*.roundtable.json` import/export with preview and validation;
- compatibility checks for app version, runtime, platform, capabilities, and
  enforceable permissions;
- draft workflow generation from an existing prompt or script, never automatic
  execution;
- revision-pinned share links and one-click owner-scoped copies of community
  templates.

### Controllable execution

- durable ExecutionRun and append-only TaskAttempt records;
- safe-checkpoint pause, resume, cancellation, and process reconciliation;
- single-task retry with downstream stale-state detection;
- per-attempt runtime/model, duration, token, and cost evidence; unavailable
  data shown honestly;
- isolated task changes and a conflict gate that never silently overwrites user
  work.

### Permission and privacy boundary

- explicit approval for file read, file write, command execution, and network
  access;
- enforcement shown as `enforced`, `runtime_delegated`, `advisory`, or
  `unsupported`;
- no release-default permission bypass;
- opt-in, disableable activation telemetry limited to the documented allowlist;
- manually exported, previewable, redacted diagnostic bundles.

### Release quality

- Playwright golden path covering planning, approval, deterministic execution,
  artifacts/review, and history after reload;
- runtime smoke and failure-path tests, including missing login and interruption;
- smaller, cohesive UI, action, runner, and store modules with stable public
  boundaries;
- complete package/release metadata, security policy, architecture docs,
  contribution templates, changelog, dependency/secret scanning, and a signed or
  checksummed beta release.

Testing follows behavior contracts and unique risks, not a coverage quota.
Vitest protects domain transitions, migrations, runtime protocols, permission
policy, and redaction at stable module boundaries. Playwright protects only the
few cross-layer journeys that require the real UI/action/store integration. The
same risk is not re-tested at every layer unless the integration boundary is the
risk, and tests avoid private call order, incidental copy, and other fragile
implementation details.

## Beta exit criteria

- a new user can connect a supported local runtime and complete a reviewed
  mission without hidden setup knowledge;
- ten consecutive CI golden-path runs are free of flaky failures;
- build, typecheck, lint, Vitest, and the deterministic Playwright golden path
  pass as one release gate without retrying failures away;
- legacy JSON and Postgres data migrate without losing historical runs;
- pause/resume leaves no orphan process and never repeats a completed node;
- concurrent file changes are merged or stopped at a visible conflict gate;
- a private workflow cannot be read or run by another owner;
- denied permissions prevent process launch;
- no prompt, source, path, diff, secret, or raw error enters telemetry or the
  default diagnostic bundle;
- documentation distinguishes deterministic demo output from real runtime work.

## Initial audience and workflows

The primary audience is product designers already using Cursor, Claude Code, or
Codex; vibe-coding independent developers; solo founders; creative
technologists; and Git-capable product/design engineers who lose context across
multiple agent terminals.

Initial reference workflows:

1. ship a feature in an existing project with plan, implementation, tests,
   review, and repair;
2. build and review a landing page from a product brief and references;
3. produce a file-based video script through research, outline, fact-check,
   scene list, and final review.

Content teams, growth teams, technical writers, and small AI studios are a
secondary audience where work is expressed as files, scripts, and commands.

## Explicit non-goals for the beta

- competing with n8n, Zapier, or general SaaS integration automation;
- a broad connector marketplace before reusable workflows have demonstrated
  demand;
- autonomous execution without user-visible plans and meaningful gates;
- pretending advisory prompt rules are a sandbox;
- hiding runtime limits or estimating unavailable local-subscription costs as
  exact values;
- supporting every runtime and operating system before their capability matrix
  is tested;
- replacing Git, an IDE, or the underlying coding runtimes;
- a cloud service that silently receives local source, prompts, credentials, or
  CLI login state.
