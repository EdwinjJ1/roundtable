## Problem

What user or contributor problem does this change solve? Link the issue or ADR
when one exists.

## Change

Describe the smallest relevant behavior change and any deliberate non-goals.

## Verification

List commands and manual checks actually run. Do not mark a check complete if it
was skipped.

- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm lint`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm build`
- [ ] `corepack pnpm test:e2e` (cross-layer/UI changes on POSIX)

## Evidence and risk

- Add screenshots or a short clip for visible UI changes.
- Explain migration, owner-isolation, runtime, permission, privacy, or recovery
  risk when relevant.
- State any unsupported platform/runtime or follow-up work.

## Contributor checklist

- [ ] Tests verify public behavior or a distinct risk, not private call order or
      coverage for its own sake.
- [ ] No secret, private source, personal path, raw runtime output, or generated
      `.roundtable` data is included.
- [ ] User-facing behavior and `CHANGELOG.md` are updated when appropriate.
- [ ] The PR is focused and does not overwrite unrelated work.
