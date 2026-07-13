# ADR 003: Capability-based permissions with explicit enforcement levels

- **Status:** Proposed
- **Date:** 2026-07-13

## Context

AI coding runtimes can read and change source, execute programs, and initiate
network requests. A confirmation shown only in the Roundtable UI is not a
security boundary if the spawned runtime can exceed it.

The current generic external-agent path invokes Claude with
`--permission-mode bypassPermissions` when no custom arguments are configured.
That bypass is an acknowledged release risk: safety scanning of resulting
artifacts occurs after execution and cannot prevent unauthorized reads,
commands, network access, or writes outside the intended change set.

Different runtimes and host platforms expose different controls. Roundtable
must describe the strength of each control honestly.

## Decision

Model permission requests using four capability families:

- `filesystem.read`: scoped paths or workspace roots;
- `filesystem.write`: scoped paths or workspace roots;
- `process.execute`: commands or command classes, cwd, and argument policy;
- `network.connect`: destinations, protocols, and ports where enforceable.

Every capability decision is allow or deny, scoped to one task/run unless the
user deliberately creates a reusable grant. Approval is evaluated server-side
at the local execution boundary before spawn. Denial prevents the process from
starting. A prompt cannot grant itself capabilities.

Every requested capability also carries exactly one enforcement level:

| Level | Meaning |
| --- | --- |
| `enforced` | Roundtable or its sandbox technically prevents access outside the grant. |
| `runtime_delegated` | A supported runtime permission mechanism enforces the grant; Roundtable verifies and records the configuration but does not own the boundary. |
| `advisory` | The constraint is supplied as policy or prompt, but neither Roundtable nor the runtime can technically prevent violation. |
| `unsupported` | The runtime/platform cannot represent or honor the requested constraint; execution is blocked unless an explicit higher-risk policy permits that exact case. |

The UI displays both the capability and enforcement level before approval. It
must not label advisory behavior “sandboxed” or “protected”. Compatibility
checks use the same matrix and run on the server again immediately before
spawn.

Default policy for real runtimes is deny until approved. `bypassPermissions`
must not be the default path in a release build. If retained for local developer
testing, it requires an explicit unsafe configuration, a persistent warning,
and audit evidence; it cannot satisfy an `enforced` or `runtime_delegated`
grant.

Child processes receive a minimal environment. Credentials unrelated to the
selected runtime are removed. Workspace path validation uses canonical paths
and rejects traversal/symlink escapes at the enforcement boundary. Network
approval is distinct from permission to execute a network-capable command.

## Audit record

Each task attempt records:

- requested capability and scope;
- user/policy decision, actor, and timestamp;
- enforcement level and enforcing component/version;
- any explicit unsafe override;
- policy hash used at launch.

Audit records describe authorization decisions but exclude secret values.

## Consequences

- Runtime integrations need a tested capability matrix rather than one generic
  “permissions supported” flag.
- Some combinations will be blocked or visibly advisory until a local sandbox
  or runtime API can enforce them.
- Approval UX becomes more detailed, but users can distinguish intent from an
  actual technical boundary.
- Post-execution safety scanning remains useful for deliverable quality and
  secret detection, but is not counted as permission enforcement.

## Alternatives rejected

- **Trust the prompt:** advisory text cannot constrain a compromised or
  mistaken process.
- **One broad “allow agent” checkbox:** hides materially different read, write,
  execution, and network risks.
- **Claim all runtime controls are equivalent:** produces a false security
  promise across runtimes and platforms.
- **Rely on artifact scanning:** too late to prevent side effects or data
  disclosure.
