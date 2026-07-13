# ADR 001: Immutable workflow revisions

- **Status:** Proposed
- **Date:** 2026-07-13

## Context

`WorkflowTemplate` currently has a mutable numeric `version`. Saving a custom
template replaces the prior entry with the same id, while a turn stores a
resolved workflow snapshot. That snapshot protects many historical views, but
there is no addressable immutable revision for a run, export, or share link.
Custom templates are also currently stored in global settings rather than as
owner-scoped workflow records.

Upcoming import/export, sharing, community copying, compatibility checks, and
run history require stable identity. A link to “workflow X” must not change its
meaning when the author edits X tomorrow.

## Decision

Introduce two records:

```text
Workflow
  id
  ownerId
  name and discovery metadata
  latestRevisionId

WorkflowRevision
  id
  workflowId
  revisionNumber
  schemaVersion
  contentHash
  definition
  createdAt
  createdBy
```

A revision is immutable after creation. Editing a workflow creates the next
revision transactionally and updates `latestRevisionId`. Revision numbers are
monotonic within a workflow; the content hash is computed from a canonical
serialization of the executable definition, not mutable discovery metadata.

Every new mission and execution run stores:

- `workflowId`;
- `workflowRevisionId`;
- the resolved definition snapshot needed to run safely;
- the revision content hash.

The id is the durable relation; the snapshot is a recovery and audit boundary.
Loading a run verifies that its snapshot hash matches the recorded revision.
Historical runs never resolve through `latestRevisionId`.

Built-in workflows use the same revision model. A user copy receives a new
workflow id and owner; it does not mutate or inherit write access to the source.
A share link points to a published revision id, not “latest”. Publishing a new
revision creates a new explicit share target.

Workflow records and private revisions are owner-scoped. Public/community
visibility is explicit metadata and never inferred from possession of an id.
Server actions enforce visibility; clients cannot bypass it by submitting a
revision id directly.

## Compatibility and migration

Existing `WorkflowTemplate` entries will be migrated into one workflow and one
initial revision per template. Existing turns that already contain a usable
snapshot will retain it. Where possible, migration creates a revision from that
snapshot and attaches its id and hash; ambiguous legacy snapshots remain
readable and are labelled legacy rather than silently mapped to a newer
definition.

The external `*.roundtable.json` format carries a schema version and workflow
definition, not database ids or ownership. Import validates and previews the
document, then creates a new owner-scoped workflow/revision.

## Consequences

- Run history and share links stay reproducible after edits.
- Storage and APIs become more explicit and require migrations for JSON and
  normalized Postgres.
- Deleting a workflow must preserve revisions referenced by historical runs;
  deletion therefore hides or archives the workflow rather than cascading into
  audit history.
- Content hashes detect accidental mutation but are not signatures or proof of
  authorship.

## Alternatives rejected

- **Keep overwriting one template row:** cannot provide stable links or reliable
  historical attribution.
- **Store snapshots only:** preserves execution input but makes revisions hard
  to address, compare, share, and govern.
- **Resolve old runs to the latest version:** changes history and can make a
  previously valid run appear incompatible.
