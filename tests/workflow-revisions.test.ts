import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getWorkflowRevision,
  listWorkflowRevisions,
  saveWorkflowTemplate,
  saveWorkflowRevision,
  workflowTemplateById,
} from '../src/server/actions/mission-actions.js';
import { answerClarification, createTurn } from '../src/server/actions/turn-actions.js';
import { appRouter } from '../src/server/root.js';
import { resetData } from '../src/server/store.js';
import type { Actor } from '../src/server/types.js';

let tempDir = '';
const alice: Actor = { id: 'alice', email: 'alice@example.com', name: 'Alice' };
const bob: Actor = { id: 'bob', email: 'bob@example.com', name: 'Bob' };

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'roundtable-workflow-revisions-'));
  process.env.ROUNDTABLE_DATA_PATH = join(tempDir, 'data.json');
  process.env.ROUNDTABLE_CLARIFY_ENABLED = 'false';
  await resetData();
});

afterEach(async () => {
  delete process.env.ROUNDTABLE_DATA_PATH;
  delete process.env.ROUNDTABLE_CLARIFY_ENABLED;
  await rm(tempDir, { recursive: true, force: true });
});

describe('owner-scoped immutable workflow revisions', () => {
  it('requires authentication before listing workflow overrides', async () => {
    const caller = appRouter.createCaller({ session: null, user: null });
    await expect(caller.missions.templates()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('appends revisions through the authenticated API without leaking them to another actor', async () => {
    const firstTemplate = workflowTemplateById('wf-feature-builder');
    firstTemplate.name = 'Alice workflow';
    const aliceCaller = appRouter.createCaller({ session: null, user: alice });
    const bobCaller = appRouter.createCaller({ session: null, user: bob });
    const first = await aliceCaller.missions.saveTemplate({
      template: firstTemplate,
      expectedRevision: 0,
    });

    const secondTemplate = structuredClone(firstTemplate);
    secondTemplate.name = 'Alice workflow v2';
    const second = await aliceCaller.missions.saveTemplate({
      template: secondTemplate,
      expectedRevision: 1,
    });

    expect(first.revision.revision).toBe(1);
    expect(second.revision.revision).toBe(2);
    expect(second.workflow.latestRevisionId).toBe(second.revision.id);
    expect((await getWorkflowRevision(alice, first.revision.id))?.template.name).toBe('Alice workflow');
    expect((await getWorkflowRevision(alice, second.revision.id))?.template.name).toBe('Alice workflow v2');
    expect((await bobCaller.missions.templates()).find((item) => item.name === 'Alice workflow v2')).toBeUndefined();
  });

  it('rejects a stale expected revision through the authenticated API', async () => {
    const template = workflowTemplateById('wf-feature-builder');
    const caller = appRouter.createCaller({ session: null, user: alice });
    await caller.missions.saveTemplate({ template, expectedRevision: 0 });

    await expect(caller.missions.saveTemplate({ template, expectedRevision: 0 }))
      .rejects.toMatchObject({ message: 'workflow_revision_conflict', code: 'CONFLICT' });
  });

  it('prevents another actor from deleting an owner workflow through the API', async () => {
    const template = workflowTemplateById('wf-feature-builder');
    template.name = 'Alice protected workflow';
    const aliceCaller = appRouter.createCaller({ session: null, user: alice });
    const bobCaller = appRouter.createCaller({ session: null, user: bob });
    await aliceCaller.missions.saveTemplate({ template, expectedRevision: 0 });

    await bobCaller.missions.deleteTemplate({ id: template.id });

    expect((await aliceCaller.missions.templates()).find((item) => item.id === template.id)?.name)
      .toBe('Alice protected workflow');
  });

  it('keeps the executable content hash stable when only discovery metadata changes', async () => {
    const template = workflowTemplateById('wf-feature-builder');
    const first = await saveWorkflowRevision(alice, { template, expectedRevision: 0 });
    template.version = 999;
    template.updatedAt = '2099-01-01T00:00:00.000Z';
    template.builtin = false;
    template.name = 'Renamed for discovery';
    template.tag = 'New category';
    template.desc = 'New catalog description';
    const second = await saveWorkflowRevision(alice, { template, expectedRevision: 1 });

    expect(second.revision.contentHash).toBe(first.revision.contentHash);
  });

  it('changes the executable content hash when a stage instruction changes', async () => {
    const template = workflowTemplateById('wf-feature-builder');
    const first = await saveWorkflowRevision(alice, { template, expectedRevision: 0 });
    template.stages[2]!.desc = 'Require a threat model before producing the technical plan.';
    const second = await saveWorkflowRevision(alice, { template, expectedRevision: 1 });

    expect(second.revision.contentHash).not.toBe(first.revision.contentHash);
  });

  it('lists immutable versions newest-first for the workflow history UI', async () => {
    const template = workflowTemplateById('wf-feature-builder');
    const first = await saveWorkflowRevision(alice, { template, expectedRevision: 0 });
    template.stages[2]!.desc = 'A second immutable instruction.';
    const second = await saveWorkflowRevision(alice, { template, expectedRevision: 1 });

    expect(await listWorkflowRevisions(alice, template.id)).toEqual([second.revision, first.revision]);
    expect(await listWorkflowRevisions(bob, template.id)).toEqual([]);
  });

  it('pins a new turn and mission to the actor latest revision without leaking the override', async () => {
    const template = workflowTemplateById('wf-feature-builder');
    template.name = 'Alice private builder';
    const saved = await saveWorkflowRevision(alice, { template, expectedRevision: 0 });

    const aliceTurn = await createTurn({ actor: alice, message: 'Build a profile page.' });
    const bobTurn = await createTurn({ actor: bob, message: 'Build a profile page.' });

    expect(aliceTurn.workflow?.['name']).toBe('Alice private builder');
    expect(aliceTurn.workflowRevisionId).toBe(saved.revision.id);
    expect(aliceTurn.mission?.workflowRevisionId).toBe(saved.revision.id);
    expect(aliceTurn.mission?.workflowContentHash).toBe(saved.revision.contentHash);
    expect(bobTurn.workflow?.['name']).toBe('Feature Builder');
    expect(bobTurn.workflowRevisionId).toBe('builtin:wf-feature-builder:v1');
  });

  it('does not apply a legacy global override to an authenticated actor without an owned revision', async () => {
    const legacy = workflowTemplateById('wf-feature-builder');
    legacy.name = 'Legacy global override';
    await saveWorkflowTemplate(legacy);

    const turn = await createTurn({ actor: alice, message: 'Build a React profile page.' });

    expect(turn.workflow?.['name']).toBe('Feature Builder');
    expect(turn.workflowRevisionId).toBe('builtin:wf-feature-builder:v1');
  });

  it('keeps the original builtin snapshot pinned while a turn waits for clarification', async () => {
    delete process.env.ROUNDTABLE_CLARIFY_ENABLED;
    const parked = await createTurn({ actor: alice, message: 'make a website' });
    expect(parked.needsClarification).toBe(true);
    const originalWorkflow = structuredClone(parked.workflow);

    const override = workflowTemplateById('wf-feature-builder');
    override.stages[2]!.desc = 'A later instruction that must not enter the parked turn.';
    await saveWorkflowRevision(alice, { template: override, expectedRevision: 0 });
    const question = parked.clarifyQuestions[0]!;
    const option = question.options[0]!;
    const resumed = await answerClarification({
      actor: alice,
      turnId: parked.id,
      answers: [{ questionId: question.id, optionId: option.id, label: option.label }],
    });

    expect(resumed.workflowRevisionId).toBe('builtin:wf-feature-builder:v1');
    expect(resumed.workflow).toEqual(originalWorkflow);
  });
});
