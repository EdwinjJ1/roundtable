import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkflowEditSession,
  createServerWorkflowDraft,
  createWorkflowSaveController,
} from '../src/ui/lib/workflow-save-controller.js';
import { appRouter } from '../src/server/root.js';
import { resetData } from '../src/server/store.js';
import { createTurn } from '../src/server/actions/turn-actions.js';
import type { Actor } from '../src/server/types.js';

const actor: Actor = { id: 'alice', email: 'alice@example.com', name: 'Alice' };
let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'roundtable-workflow-save-'));
  process.env.ROUNDTABLE_DATA_PATH = join(tempDir, 'data.json');
  process.env.ROUNDTABLE_CLARIFY_ENABLED = 'false';
  await resetData();
});

afterEach(async () => {
  delete process.env.ROUNDTABLE_DATA_PATH;
  delete process.env.ROUNDTABLE_CLARIFY_ENABLED;
  await rm(tempDir, { recursive: true, force: true });
});

describe('workflow save controller', () => {
  it('awaits persistence before success and suppresses a rapid duplicate save', async () => {
    let resolveSave!: (value: { ok: true }) => void;
    const save = vi.fn(() => new Promise<{ ok: true }>((resolve) => { resolveSave = resolve; }));
    const onSaved = vi.fn();
    const controller = createWorkflowSaveController();

    const first = controller.run({ payload: { id: 'wf' }, save, onSaved });
    const duplicate = await controller.run({ payload: { id: 'wf' }, save, onSaved });
    expect(duplicate).toEqual({ ok: false, code: 'IN_FLIGHT' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();

    resolveSave({ ok: true });
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('refreshes latest revisions and reports a recoverable conflict without success', async () => {
    const onConflict = vi.fn(async () => undefined);
    const onSaved = vi.fn();
    const onError = vi.fn();
    const controller = createWorkflowSaveController();
    const localDraft = { name: 'Unsaved local edit' };

    const result = await controller.run({
      payload: localDraft,
      save: async () => { throw Object.assign(new Error('workflow_revision_conflict'), { data: { code: 'CONFLICT' } }); },
      onConflict,
      onSaved,
      onError,
    });

    expect(result).toEqual({ ok: false, code: 'CONFLICT' });
    expect(onConflict).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('A newer workflow revision exists. Your edits are still here; load the latest revision before saving again.');
    expect(onSaved).not.toHaveBeenCalled();
    expect(localDraft).toEqual({ name: 'Unsaved local edit' });
  });

  it('releases the save lock when conflict refresh itself fails', async () => {
    const controller = createWorkflowSaveController();
    const failed = await controller.run({
      payload: {},
      save: async () => { throw Object.assign(new Error('conflict'), { data: { code: 'CONFLICT' } }); },
      onConflict: async () => { throw new Error('refresh_failed'); },
    });
    const retried = await controller.run({ payload: {}, save: async () => 'saved' });

    expect(failed).toEqual({ ok: false, code: 'ERROR' });
    expect(retried).toMatchObject({ ok: true });
  });

  it('pins CAS and export identity while a background refetch reports a newer revision', () => {
    const loaded = {
      id: 'wf-custom', name: 'Local edit', expectedRevision: 2, workflowRevisionId: 'revision-2', stages: [],
    };
    const controller = createWorkflowEditSession(loaded);
    controller.markDirty();
    controller.observeRemote({ ...loaded, expectedRevision: 3, workflowRevisionId: 'revision-3' });

    expect(controller.state).toMatchObject({
      expectedRevision: 2,
      loadedRevisionId: 'revision-2',
      dirty: true,
      remoteChanged: true,
      remoteExpectedRevision: 3,
      remoteRevisionId: 'revision-3',
    });
    expect(controller.state.loadedWorkflow.name).toBe('Local edit');
  });

  it('advances the pinned edit session only after a successful save or explicit load', () => {
    const controller = createWorkflowEditSession({
      id: 'wf-custom', name: 'Draft', expectedRevision: 2, workflowRevisionId: 'revision-2', stages: [],
    });
    controller.markDirty();
    controller.commitSaved({
      revision: { id: 'revision-3', revision: 3, template: { id: 'wf-custom', name: 'Saved', stages: [] } },
    });

    expect(controller.state).toMatchObject({
      expectedRevision: 3,
      loadedRevisionId: 'revision-3',
      dirty: false,
      remoteChanged: false,
    });
    expect(controller.state.loadedWorkflow.name).toBe('Saved');
  });

  it('creates a server-mode workflow draft that the real save action accepts', async () => {
    const draft = createServerWorkflowDraft(1234);
    const caller = appRouter.createCaller({ session: null, user: actor });

    const saved = await caller.missions.saveTemplate({ template: draft, expectedRevision: 0 });
    const listed = await caller.missions.templates();
    const turn = await createTurn({ actor, workflowTemplateId: draft.id, message: 'Build a profile page.' });

    expect(listed.some((template) => template.id === draft.id)).toBe(true);
    expect(saved.revision.template.stages.some((stage) =>
      stage.kind === 'work' && stage.seats.some((seat) => seat.ref.kind === 'role' && seat.ref.role === 'implementer'),
    )).toBe(true);
    expect(turn.plan.tasks.some((task) => task.owner === 'atlas')).toBe(true);
  });
});
