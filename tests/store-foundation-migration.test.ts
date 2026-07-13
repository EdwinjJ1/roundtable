import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTurn } from '../src/server/actions/turn-actions.js';
import { readData, resetData } from '../src/server/store.js';
import { saveWorkflowRevision, workflowTemplateById } from '../src/server/actions/mission-actions.js';
import type { Actor } from '../src/server/types.js';

let tempDir = '';
let dataPath = '';
const actor: Actor = { id: 'alice', email: 'alice@example.com', name: 'Alice' };

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'roundtable-foundation-migration-'));
  dataPath = join(tempDir, 'data.json');
  process.env.ROUNDTABLE_DATA_PATH = dataPath;
  process.env.ROUNDTABLE_CLARIFY_ENABLED = 'false';
  await resetData();
});

afterEach(async () => {
  delete process.env.ROUNDTABLE_DATA_PATH;
  delete process.env.ROUNDTABLE_CLARIFY_ENABLED;
  await rm(tempDir, { recursive: true, force: true });
});

describe('foundation data migration', () => {
  it('normalizes a pre-foundation JSON store without losing its turn or mission', async () => {
    const turn = await createTurn({ actor, message: 'Build a profile page.' });
    const legacy = JSON.parse(await readFile(dataPath, 'utf8')) as Record<string, unknown>;
    delete legacy['workflows'];
    delete legacy['workflowRevisions'];
    delete legacy['executionRuns'];
    delete legacy['taskAttempts'];
    const legacyTurn = (legacy['turns'] as Array<Record<string, unknown>>)[0]!;
    const legacyMission = (legacy['missions'] as Array<Record<string, unknown>>)[0]!;
    delete legacyTurn['workflowRevisionId'];
    delete legacyTurn['activeExecutionRunId'];
    delete legacyMission['workflowRevisionId'];
    delete legacyMission['workflowContentHash'];
    await writeFile(dataPath, JSON.stringify(legacy), 'utf8');

    const migrated = await readData();
    expect(migrated.turns[0]).toMatchObject({
      id: turn.id,
      workflowRevisionId: null,
      activeExecutionRunId: null,
    });
    expect(migrated.missions[0]).toMatchObject({
      id: turn.missionId,
      workflowRevisionId: null,
      workflowContentHash: null,
    });
    expect(migrated.workflows).toEqual([]);
    expect(migrated.workflowRevisions).toEqual([]);
    expect(migrated.executionRuns).toEqual([]);
    expect(migrated.taskAttempts).toEqual([]);
  });

  it('migrates legacy workflow rows to a stable opaque storage identity', async () => {
    await saveWorkflowRevision(actor, {
      template: workflowTemplateById('wf-feature-builder'),
      expectedRevision: 0,
    });
    const legacy = JSON.parse(await readFile(dataPath, 'utf8')) as {
      workflows: Array<Record<string, unknown>>;
      workflowRevisions: Array<Record<string, unknown>>;
    };
    delete legacy.workflows[0]!['storageId'];
    delete legacy.workflowRevisions[0]!['workflowStorageId'];
    await writeFile(dataPath, JSON.stringify(legacy), 'utf8');

    const firstRead = await readData();
    const secondRead = await readData();
    const storageId = firstRead.workflows[0]!.storageId;
    expect(storageId).toMatch(/^workflow_legacy_[a-f0-9]{24}$/);
    expect(secondRead.workflows[0]!.storageId).toBe(storageId);
    expect(firstRead.workflowRevisions[0]!.workflowStorageId).toBe(storageId);
  });
});
