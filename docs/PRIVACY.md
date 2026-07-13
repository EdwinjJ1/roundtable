# Privacy, Telemetry, and Diagnostics

Roundtable operates on source code, prompts, local paths, and AI runtime output.
Those inputs are sensitive by default. This document defines the proposed
privacy boundary for the official beta. Telemetry and diagnostic bundle
collection described below are **not yet implemented unless the product UI
explicitly says otherwise**.

## Principles

1. Local work stays local unless the user deliberately sends or publishes it.
2. Product analytics use a small event allowlist, not arbitrary event payloads.
3. Consent is understandable, reversible, and does not block core local use.
4. Unknown fields are dropped rather than uploaded.
5. Diagnostics are previewed and exported manually; they are not silently sent.

## Telemetry consent

The official distribution asks for telemetry consent on first run. The default
choice is off until the user opts in. The setting can be changed at any time,
and opting out stops new events without degrading workflow execution.

Self-hosted builds default telemetry off. Building or running the repository
does not imply consent. A deployer that enables its own analytics is responsible
for documenting that separate processing.

No telemetry event is emitted before the consent decision is persisted. The
consent record includes policy version, decision, timestamp, and distribution
channel, but no hardware fingerprint.

## Event allowlist

Only these coarse activation events are proposed for beta:

- `app_started`
- `runtime_connected` (runtime kind and compatibility outcome only)
- `mission_created`
- `plan_approved`
- `run_completed` (success/failure category and coarse duration bucket)
- `workflow_reused`
- `first_value_reached`

Allowed common properties are application version, operating-system family,
distribution channel, anonymous installation id, event timestamp, and coarse
feature/runtime identifiers. Event schemas are versioned and enforced before
queueing. There is no generic “metadata” or free-text property.

## Fields that must never be collected as telemetry

- prompts, messages, responses, transcripts, plans, or model reasoning;
- source code, file contents, diffs, artifacts, screenshots, or previews;
- file names, absolute/relative paths, workspace names, repository URLs, branch
  names, commit messages, or remote names;
- user name, email, OAuth identity, IP address stored as an identifier, or CLI
  account identity;
- environment variables, command arguments, API keys, cookies, tokens,
  credentials, authorization headers, or secret scan matches;
- raw errors, stack traces, stdout/stderr, process ids, runtime session ids, or
  model request ids;
- workflow names/descriptions or community/share-link contents;
- high-resolution timing or a stable machine fingerprint.

Token counts and costs belong to the local execution record. They are not beta
telemetry fields.

## Diagnostics boundary

A diagnostic bundle is created only after the user requests it. Before export,
Roundtable shows the exact included files/categories and lets the user cancel.
Export creates a local archive; uploading or attaching it is a separate manual
action.

The default bundle may contain:

- Roundtable version, distribution channel, and OS family/version;
- enabled feature names and runtime kinds, with credential sources removed;
- compatibility/probe outcomes and structured Roundtable error codes;
- redacted lifecycle timestamps and coarse durations;
- migration/schema versions and aggregate record counts;
- recent structured logs after allowlist filtering and redaction.

The default bundle excludes prompts, source, artifacts, diffs, workspace paths,
repository metadata, environment values, command arguments, raw runtime output,
runtime session ids, credentials, and personal identity. A user may explicitly
add a specific file after a warning, but it is never selected by default.

Redaction is defense in depth, not permission to collect broadly. Diagnostic
generation starts from an allowlist, then applies secret and path redaction.
Tests use a corpus of API keys, tokens, home paths, repository URLs, emails, and
runtime output to prevent regressions.

## Local retention and deletion

Workflow history, run records, artifacts, token/cost observations, and runtime
conversations are product data stored by the configured JSON or Postgres store;
they are not telemetry. The product must disclose their configured location and
provide deletion controls without requiring analytics consent.

Telemetry queues use bounded retention and are deleted on opt-out before any
future upload. The public beta release must publish the provider, region,
retention period, deletion behavior, and policy version before collection is
enabled.

## Incident rule

If a disallowed field is discovered in telemetry, collection for the affected
event is disabled, queued copies are deleted where possible, the schema and
redaction tests are fixed, and the incident is documented according to the
published security process.
