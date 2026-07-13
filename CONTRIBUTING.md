# Contributing to Roundtable

Thank you for improving Roundtable. This guide is designed to get a first
contribution from clone to pull request without requiring a real AI runtime or
API key.

Security reports do not belong in public issues. Follow
[SECURITY.md](SECURITY.md) instead.

## Prerequisites

- Node.js 20 or newer (CI currently uses Node.js 24);
- Corepack and pnpm 9;
- Git;
- Linux or macOS for the current Playwright runner;
- Docker only if you choose to test normalized Postgres.

The app itself may run in other Node environments, but Windows E2E process-tree
cleanup is not currently supported. Do not claim Windows compatibility based on
unit tests alone.

## First local run

```bash
git clone https://github.com/EdwinjJ1/roundtable.git
cd roundtable
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
corepack pnpm dev
```

Open <http://localhost:3000>. If Google OAuth is not configured, enable the
documented non-production developer login in `.env.local`:

```text
ROUNDTABLE_ENABLE_DEV_AUTH=1
```

Keep `ROUNDTABLE_AGENT_ADAPTER=local-dispatch`. It is deterministic, requires no
secret, and writes fixture-like outputs so the workflow can be exercised. It
does not call Claude Code, Codex, or another model and is not a real-runtime
acceptance test.

## Make a focused change

Before editing, read [the architecture overview](docs/ARCHITECTURE.md) and any
relevant decision under `docs/adr/`. Keep interface concerns in the UI/API,
domain transitions in actions, graph ordering in the scheduler, runtime protocol
translation in adapters, and persistence/migration in the store.

Do not bundle a feature, a broad refactor, generated formatting, and dependency
updates in one pull request. Preserve unrelated changes in a dirty worktree.

## Test the behavior you changed

Vitest covers domain and module behavior:

```bash
corepack pnpm test -- tests/scheduler.test.ts
corepack pnpm test
```

Use the lowest layer that proves the behavior. Add a cross-layer test only when
the integration is the risk. Tests should not assert private helper calls,
incidental copy, or coverage for its own sake.

Playwright covers the deterministic workbench golden path:

```bash
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

The E2E configuration starts an isolated dev server, enables developer auth,
uses `local-dispatch`, and writes JSON/workspaces under the system temporary
directory. It does not require runtime credentials. The runner currently relies
on POSIX process groups for reliable descendant cleanup and signal forwarding;
run it on Linux or macOS. Windows is not yet a supported E2E environment.

For scheduler or store behavior, the deterministic CLI smoke is also useful:

```bash
corepack pnpm cli workflow smoke --message "Build a waitlist page"
```

Normalized Postgres changes should additionally use the local database commands
documented in [README.md](README.md). Never point tests at production data.

## Full verification

Before opening a pull request, run:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

CI runs typecheck, lint, Vitest, dependency audit, and build on Ubuntu. If you
cannot run an applicable command, explain why and what narrower verification you
performed. Do not repeatedly retry a flaky failure until it happens to pass.

Real-runtime changes also need a sanitized manual result from the runtime they
affect. Never post raw transcripts, prompts, local paths, API responses, or
credentials. A maintainer may perform credentialed smoke testing separately.

## Pull requests

- Open an issue first for a large feature, schema change, security-boundary
  change, or new runtime.
- Use Conventional Commits: `<type>: <description>`, where type is `feat`,
  `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, or `ci`.
- Explain the problem and observable outcome, not only the files changed.
- Include migration and rollback implications for stored-data changes.
- Add screenshots or a short clip for visible UI changes.
- Update `CHANGELOG.md` for notable user-visible, compatibility, migration, or
  security changes.
- Keep generated files, local data, test results, and secrets out of the diff.

## Issues

Use the GitHub templates for reproducible bugs and evidence-led feature
requests. Search existing issues and [ROADMAP.md](ROADMAP.md) first. Sanitize
screenshots and logs: issue content is public and permanent even after editing.

## Style

- TypeScript is strict; avoid `any` where practical.
- Prefer cohesive modules, explicit boundaries, and immutable inputs.
- Validate user and persisted data at trust boundaries.
- Do not hardcode credentials, endpoints, or machine-specific paths.
- Comments should explain decisions or constraints, not restate syntax.

## License

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
