import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  saveWorkflowRevision,
  workflowExecutableContentHash,
  workflowTemplateById,
} from '../src/server/actions/mission-actions.js';
import {
  exportWorkflowRevisionFile,
  importWorkflowFile,
  MAX_WORKFLOW_FILE_BYTES,
  preflightWorkflowFile,
  workflowDocumentHash,
} from '../src/server/actions/workflow-portability-actions.js';
import { saveAgentRuntimeConfig } from '../src/server/actions/runtime-actions.js';
import { approveTurn, createTurn } from '../src/server/actions/turn-actions.js';
import { appRouter } from '../src/server/root.js';
import { mutateData, readData, resetData } from '../src/server/store.js';
import type { Actor } from '../src/server/types.js';

const alice: Actor = { id: 'alice', email: 'alice@example.com', name: 'Alice' };
const bob: Actor = { id: 'bob', email: 'bob@example.com', name: 'Bob' };
let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'roundtable-portability-'));
  process.env.ROUNDTABLE_DATA_PATH = join(tempDir, 'data.json');
  process.env.ROUNDTABLE_CLARIFY_ENABLED = 'false';
  await resetData();
});

afterEach(async () => {
  delete process.env.ROUNDTABLE_DATA_PATH;
  delete process.env.ROUNDTABLE_CLARIFY_ENABLED;
  await rm(tempDir, { recursive: true, force: true });
});

describe('versioned workflow portability', () => {
  it('exports the requested immutable revision and enforces its owner boundary', async () => {
    const template = workflowTemplateById('wf-feature-builder');
    template.stages[2]!.desc = 'Revision one planning instruction.';
    const first = await saveWorkflowRevision(alice, { template, expectedRevision: 0 });
    template.stages[2]!.desc = 'Revision two planning instruction.';
    await saveWorkflowRevision(alice, { template, expectedRevision: 1 });

    const exported = await exportWorkflowRevisionFile(alice, first.revision.id);

    expect(exported.fileName).toMatch(/\.roundtable\.json$/);
    expect(exported.file.provenance.revision).toBe(1);
    expect(exported.file.provenance.contentHash).toBe(first.revision.contentHash);
    expect(exported.file.provenance.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.file.provenance.documentHash).toBe(workflowDocumentHash(exported.file));
    expect(exported.file.workflow.stages[2]?.desc).toBe('Revision one planning instruction.');
    await expect(exportWorkflowRevisionFile(bob, first.revision.id))
      .rejects.toMatchObject({ message: 'workflow_revision_not_found', status: 404 });
  });

  it('preflights every compatibility dimension without persisting the file', async () => {
    const saved = await saveWorkflowRevision(alice, {
      template: workflowTemplateById('wf-feature-builder'),
      expectedRevision: 0,
    });
    const exported = await exportWorkflowRevisionFile(alice, saved.revision.id);
    const candidate = structuredClone(exported.file);
    candidate.minimumAppVersion = '999.0.0';
    candidate.compatibility.runtimes = ['ghost-runtime'];
    candidate.compatibility.platforms = ['plan9'];
    candidate.compatibility.capabilities = ['capability.that-is-not-installed'];
    candidate.compatibility.permissions = ['network.connect'];
    const before = await readData();

    const result = await preflightWorkflowFile(alice, candidate);
    const statusByCategory = Object.fromEntries(result.checks.map((check) => [check.category, check.status]));

    expect(statusByCategory).toMatchObject({
      schema: 'available',
      app: 'blocking',
      runtime: 'unavailable',
      platform: 'unavailable',
      capabilities: 'unavailable',
      permissions: 'warning',
      integrity: 'blocking',
    });
    expect(result.canImport).toBe(false);
    expect(result.canRun).toBe(false);
    const after = await readData();
    expect(after.workflows).toEqual(before.workflows);
    expect(after.workflowRevisions).toEqual(before.workflowRevisions);

    const unavailableOnly = structuredClone(exported.file);
    unavailableOnly.compatibility.runtimes = ['ghost-runtime'];
    unavailableOnly.provenance.documentHash = workflowDocumentHash(unavailableOnly);
    const unavailableResult = await preflightWorkflowFile(alice, unavailableOnly);
    expect(unavailableResult).toMatchObject({ canImport: true, canRun: false });

    const permissionAdvisory = await preflightWorkflowFile(alice, exported.file);
    const permissionCheck = permissionAdvisory.checks.find((check) => check.category === 'permissions');
    expect(permissionCheck).toMatchObject({ status: 'warning' });
    expect(permissionCheck?.message).toMatch(/advisory|runtime-specific/i);
    expect(permissionCheck?.message).not.toMatch(/will be required/i);

    for (const minimumAppVersion of ['0.1.0', 'not-semver']) {
      const requiresStableOrInvalid = structuredClone(exported.file);
      requiresStableOrInvalid.minimumAppVersion = minimumAppVersion;
      requiresStableOrInvalid.provenance.documentHash = workflowDocumentHash(requiresStableOrInvalid);
      const versionResult = await preflightWorkflowFile(alice, requiresStableOrInvalid);
      expect(versionResult.checks.find((check) => check.category === 'app')).toMatchObject({ status: 'blocking' });
      expect(versionResult).toMatchObject({ canImport: false, canRun: false });
    }
  });

  it('explicitly imports a sanitized owner copy using the recomputed preview hash', async () => {
    const source = await saveWorkflowRevision(bob, {
      template: workflowTemplateById('wf-feature-builder'),
      expectedRevision: 0,
    });
    const candidate = structuredClone((await exportWorkflowRevisionFile(bob, source.revision.id)).file);
    Object.assign(candidate, { ownerId: 'bob' });
    Object.assign(candidate.workflow, { ownerId: 'bob' });
    candidate.workflow.id = 'wf-owned-by-bob';
    candidate.workflow.builtin = true;
    candidate.workflow.version = 999;
    candidate.compatibility.runtimes = ['codex'];
    const envelopeTampered = await preflightWorkflowFile(alice, candidate);
    expect(envelopeTampered.checks.find((check) => check.category === 'integrity'))
      .toMatchObject({ status: 'blocking' });

    await saveAgentRuntimeConfig({ agentId: 'atlas', runtime: 'codex', actor: alice });
    candidate.provenance.documentHash = workflowDocumentHash(candidate);
    candidate.provenance.contentHash = 'a'.repeat(64);
    const rejectedPreview = await preflightWorkflowFile(alice, candidate);

    expect(rejectedPreview).toMatchObject({ canImport: false, canRun: false });
    expect(rejectedPreview.checks.find((check) => check.category === 'integrity'))
      .toMatchObject({ status: 'blocking' });

    candidate.provenance.contentHash = source.revision.contentHash;
    candidate.provenance.documentHash = workflowDocumentHash(candidate);
    const preview = await preflightWorkflowFile(alice, candidate);

    await expect(importWorkflowFile(alice, { input: candidate, confirmedContentHash: 'wrong-preview' }))
      .rejects.toMatchObject({ message: 'workflow_import_confirmation_mismatch', status: 409 });
    const imported = await importWorkflowFile(alice, {
      input: candidate,
      confirmedContentHash: preview.documentHash!,
    });

    expect(imported.workflow.ownerId).toBe(alice.id);
    expect(imported.workflow.id).not.toBe('wf-owned-by-bob');
    expect(imported.revision.revision).toBe(1);
    expect(imported.revision.template).not.toHaveProperty('ownerId');
    expect(imported.revision.contentHash).toBe(preview.workflowContentHash);
    expect(imported.revision.contentHash).toBe(candidate.provenance.contentHash);
    expect(imported.revision.documentHash).toBe(preview.documentHash);
    expect(imported.revision.compatibility).toMatchObject({ runtimes: ['codex'] });
    expect((await preflightWorkflowFile(bob, candidate)).workflow?.id).toBe('wf-owned-by-bob');
    expect((await readData()).workflows.filter((workflow) => workflow.ownerId === alice.id)).toHaveLength(1);

    await mutateData((data) => {
      const revision = data.workflowRevisions.find((item) => item.id === imported.revision.id)!;
      revision.compatibility = null;
    });
    const tamperedTurn = await createTurn({
      actor: alice,
      workflowTemplateId: imported.workflow.id,
      message: 'Run the imported workflow after its declaration was cleared.',
    });
    await expect(approveTurn({
      actor: alice,
      turnId: tamperedTurn.id,
      decision: 'approve',
      autoDispatch: true,
      agentAdapter: 'local-dispatch',
    })).rejects.toMatchObject({ message: 'workflow_incompatible:missing_compatibility_declaration', status: 409 });
    await mutateData((data) => {
      const revision = data.workflowRevisions.find((item) => item.id === imported.revision.id)!;
      revision.compatibility = imported.revision.compatibility;
    });

    await mutateData((data) => {
      data.agentRuntimeConfigs = [];
      data.agentRuntimeDefaults = [];
    });
    const turn = await createTurn({
      actor: alice,
      workflowTemplateId: imported.workflow.id,
      message: 'Run the imported workflow after its runtime disappeared.',
    });
    await expect(approveTurn({
      actor: alice,
      turnId: turn.id,
      decision: 'approve',
      autoDispatch: true,
      agentAdapter: 'local-dispatch',
    })).rejects.toMatchObject({ message: expect.stringMatching(/workflow_incompatible/), status: 409 });
  });

  it('rejects oversized unknown input before parsing or persistence', async () => {
    const before = await readData();
    const oversized = JSON.stringify({ padding: 'x'.repeat(MAX_WORKFLOW_FILE_BYTES + 1) });

    await expect(preflightWorkflowFile(alice, oversized))
      .rejects.toMatchObject({ message: 'workflow_file_too_large', status: 413 });
    expect((await readData()).workflows).toEqual(before.workflows);
  });

  it('reports malformed structure and domain-invalid workflows as blocking preview results', async () => {
    const result = await preflightWorkflowFile(alice, { schema: 'roundtable.workflow', workflow: [] });

    expect(result).toMatchObject({ canImport: false, canRun: false, workflow: null });
    expect(result.checks).toEqual([
      expect.objectContaining({ category: 'schema', status: 'blocking' }),
    ]);

    const saved = await saveWorkflowRevision(alice, {
      template: workflowTemplateById('wf-feature-builder'),
      expectedRevision: 0,
    });
    const exported = await exportWorkflowRevisionFile(alice, saved.revision.id);
    const unknownAgent = structuredClone(exported.file);
    const roleSeat = unknownAgent.workflow.stages
      .flatMap((stage) => stage.seats)
      .find((seat) => seat.ref.kind === 'role');
    if (!roleSeat || roleSeat.ref.kind !== 'role') throw new Error('missing_role_seat_fixture');
    roleSeat.ref.agentId = 'agent-that-does-not-exist';

    const duplicateStage = structuredClone(exported.file);
    duplicateStage.workflow.stages[1]!.id = duplicateStage.workflow.stages[0]!.id;

    const noRunnableSeat = structuredClone(exported.file);
    for (const stage of noRunnableSeat.workflow.stages) {
      if (stage.kind === 'plan' || stage.kind === 'work' || stage.kind === 'review') {
        stage.seats = [{ ref: { kind: 'user' } }];
      }
    }

    for (const document of [unknownAgent, duplicateStage, noRunnableSeat]) {
      document.provenance.contentHash = workflowExecutableContentHash(document.workflow);
      document.provenance.documentHash = workflowDocumentHash(document);
      const preview = await preflightWorkflowFile(alice, document);
      expect(preview).toMatchObject({ canImport: false, canRun: false });
      expect(preview.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: 'schema', status: 'blocking' }),
      ]));
    }
  });

  it('exposes export, preflight, and confirmed import through authenticated tRPC', async () => {
    const saved = await saveWorkflowRevision(alice, {
      template: workflowTemplateById('wf-feature-builder'),
      expectedRevision: 0,
    });
    const caller = appRouter.createCaller({ session: null, user: alice });
    const anonymous = appRouter.createCaller({ session: null, user: null });

    const exported = await caller.missions.exportRevision({ revisionId: saved.revision.id });
    const listed = await caller.missions.templates();
    const preview = await caller.missions.previewImport({ document: exported.document });
    const imported = await caller.missions.importDocument({
      document: exported.document,
      confirmedContentHash: preview.documentHash!,
    });

    expect(imported.workflow.ownerId).toBe(alice.id);
    expect(listed.find((template) => template.id === saved.workflow.id)?.workflowRevisionId).toBe(saved.revision.id);
    expect(listed.find((template) => template.id === 'wf-bug-fixer')?.workflowRevisionId).toBeNull();
    await expect(anonymous.missions.previewImport({ document: exported.document }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const incompatible = structuredClone(exported.document);
    incompatible.compatibility.runtimes = ['ghost-runtime'];
    incompatible.provenance.documentHash = workflowDocumentHash(incompatible);
    const blockedPreview = await caller.missions.previewImport({ document: incompatible });
    expect(blockedPreview).toMatchObject({ canImport: true, canRun: false });
    await expect(caller.missions.importDocument({
      document: incompatible,
      confirmedContentHash: blockedPreview.documentHash!,
    })).resolves.toMatchObject({ workflow: { ownerId: alice.id } });
  });
});
