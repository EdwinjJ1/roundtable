# Security Policy

Roundtable can launch AI coding runtimes that read and modify a workspace and
execute commands. Treat a real-runtime run with the same care as a local shell
session. The artifact safety scan is useful defense in depth; it is not a
sandbox and does not prevent all process side effects.

## Supported versions

Roundtable is preparing its first public beta and does not yet provide long-term
support branches.

| Version | Security fixes |
| --- | --- |
| `main` | Yes |
| Latest `0.1.0-beta.x` release | Best effort |
| Older prereleases and commits | No |

Upgrade to the newest beta before reporting a problem that may already be
fixed. Security-relevant fixes will be documented in [CHANGELOG.md](CHANGELOG.md).

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include secrets,
exploit details, private source, or personal data in a public discussion.

1. Use GitHub's
   [private vulnerability report](https://github.com/EdwinjJ1/roundtable/security/advisories/new).
2. If GitHub does not offer the private report form, contact the maintainer
   through the repository owner's
   [GitHub profile](https://github.com/EdwinjJ1) with only a request for a
   private reporting channel. Do not send vulnerability details publicly.
3. Include the affected commit/version, operating system, store driver and
   runtime kind, impact, minimal reproduction, and any mitigation you have
   already tested. Redact credentials, tokens, source, and personal paths.

You should receive an acknowledgement within five business days. The
maintainer will validate the report, agree on disclosure timing, prepare a fix
and regression test, and publish an advisory or release note when users can
upgrade. Please allow a reasonable remediation window before public disclosure.

There is currently no bug bounty program. Good-faith research that avoids
privacy violations, destructive actions, service disruption, and access to
other users' data is welcome.

## Useful report categories

- authentication or owner-isolation bypass;
- workspace traversal, symlink escape, or unauthorized file access;
- command or argument injection;
- runtime permission bypass or misleading enforcement claims;
- credential exposure through logs, artifacts, diagnostics, APIs, or UI;
- unsafe workflow import/deserialization;
- cross-site scripting, request forgery, or server-side request forgery;
- Postgres/JSON migration that exposes another owner's data;
- telemetry or diagnostics collecting fields excluded by
  [the privacy policy](docs/PRIVACY.md).

## Current security boundaries

- This beta is a single-trusted-operator deployment. Runtime commands,
  provider environment, and runtime defaults are shared by the host. Do not
  deploy it for mutually untrusted users; authentication and workflow owner
  checks do not isolate runtime configuration or credentials between tenants.
- `local-dispatch` is deterministic test/demo code. It does not invoke a model
  or prove that a real runtime is safely configured.
- Claude Code, Codex, OpenCode, E2B, and model-provider adapters have different
  controls. Roundtable does not yet provide one technically enforced
  read/write/process/network permission model across all of them.
- The E2B adapter's default Claude command currently uses
  `bypassPermissions` when no custom arguments are configured. Only use
  external agents and sandboxes you trust, with a disposable or isolated
  workspace.
- Production workspaces are rooted under `ROUNDTABLE_WORKSPACE_ROOT` unless an
  operator deliberately enables custom paths. That path restriction does not
  turn a runtime into a complete sandbox.
- A hosted web server cannot use a browser visitor's local CLI login without a
  separate local bridge. No such general hosted-to-local trust bridge is
  claimed by the current repository.

The intended permission design and its enforcement vocabulary are documented
as a proposal in
[ADR 003](docs/adr/003-permission-enforcement.md). Do not report the absence of
a roadmap feature as a vulnerability; do report a behavior that contradicts a
current security statement or crosses an existing authorization boundary.

## Protecting local development

- Keep `.env`, `.env.local`, `.roundtable/`, workspaces, test results, and
  runtime credentials out of commits.
- Use `local-dispatch` for ordinary tests and untrusted workflow examples.
- Enable `ROUNDTABLE_ENABLE_EXTERNAL_AGENT=1` only when you intend to launch a
  local runtime.
- Review the workspace, runtime command, model provider, and environment before
  approval. Prefer a disposable repository with clean Git state.
- Never put secrets in prompts or diagnostic reports. Rotate a credential if it
  appears in a log, artifact, diff, or commit.
- Keep the artifact safety scan enabled outside tests.
