# Changelog

Notable user-visible changes are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
[Semantic Versioning](https://semver.org/) for tagged releases.

## [Unreleased]

### Added

- Initial open-source beta documentation, including architecture decisions,
  privacy boundaries, security reporting, roadmap, and contribution templates.
- Immutable, owner-scoped workflow revision foundation with historical mission
  snapshots.
- Execution run and task-attempt foundation for durable run history.
- Deterministic Chromium Playwright golden paths for plan approval, delivery,
  and history recovery.
- Versioned `.roundtable.json` export, compatibility preflight, and explicit
  owner-scoped import with server-recomputed content confirmation.
- Workflow revision and execution history in the editor, including honest
  runtime, model, duration, token, and cost evidence per task attempt.
- Safe-checkpoint pause/resume and single-task retry with transitive downstream
  stale-state detection.
- A first-time-friendly workflow builder with a visible creation action,
  explicit step instructions, expected results, ownership, and approval rules.

### Changed

- Package metadata now identifies the private application as
  `@roundtable/app` and prepares version `0.1.0-beta.1`.
- Product positioning now describes Roundtable as a visual workflow and
  governance layer over local AI coding agents.
- Runtime usage evidence distinguishes complete, partial, and unavailable
  provider reports instead of presenting missing data as zero.

### Security

- Documented the difference between artifact safety scanning and runtime
  permission enforcement, including the current external-runtime risks.
- Defined an opt-in telemetry allowlist and manual diagnostic-export boundary;
  these are policies for future implementation, not enabled collection.
- Workflow imports reject incompatible environments, invalid domain graphs,
  invalid SemVer requirements, and provenance hash mismatches before
  persistence.
- Clarified that the current beta supports one trusted operator per host;
  runtime commands and provider configuration are not tenant-isolated.

## Before this changelog

Roundtable was developed without a maintained release changelog. Git history is
the source of truth for earlier work. The first published beta should move the
relevant entries above into a dated version section without rewriting earlier
release history.
