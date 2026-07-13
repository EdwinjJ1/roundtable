import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createExecutionRun,
  finishTaskAttempt,
  getExecutionRun,
  startTaskAttempt,
} from '../src/server/actions/execution-actions.js';
import { approveTurn, createTurn } from '../src/server/actions/turn-actions.js';
import { createChat } from '../src/server/actions/chat-actions.js';
import { createWorkbench } from '../src/server/actions/workbench-actions.js';
import { resetData } from '../src/server/store.js';
import type { Actor } from '../src/server/types.js';

let tempDir = '';
const alice: Actor = { id: 'alice', email: 'alice@example.com', name: 'Alice' };
const bob: Actor = { id: 'bob', email: 'bob@example.com', name: 'Bob' };

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'roundtable-execution-runs-'));
  process.env.ROUNDTABLE_DATA_PATH = join(tempDir, 'data.json');
  process.env.ROUNDTABLE_CLARIFY_ENABLED = 'false';
  await resetData();
});

afterEach(async () => {
  delete process.env.ROUNDTABLE_DATA_PATH;
  delete process.env.ROUNDTABLE_CLARIFY_ENABLED;
  await rm(tempDir, { recursive: true, force: true });
});

describe('execution run history', () => {
  it('records attempts when the real approved scheduler run executes tasks', async () => {
    const turn = await createTurn({ actor: alice, message: 'Build a profile page.' });
    const dispatched = await approveTurn({
      actor: alice,
      turnId: turn.id,
      decision: 'approve',
      autoDispatch: true,
      agentAdapter: 'local-dispatch',
    });

    expect(dispatched.activeExecutionRunId).toBeTruthy();
    const projection = await getExecutionRun(alice, dispatched.activeExecutionRunId!);
    expect(projection?.run.status).toBe('completed');
    expect(projection?.run.workflowRevisionId).toBe(dispatched.workflowRevisionId);
    expect(projection?.run.workflowContentHash).toBe(dispatched.mission?.workflowContentHash);
    expect(projection?.run.planSnapshot).toEqual(turn.plan);
    expect(projection?.run.startedAt).toBeTruthy();
    expect(projection?.run.finishedAt).toBeTruthy();
    expect(projection?.attempts.every((attempt) => attempt.startedAt && attempt.finishedAt)).toBe(true);
    expect(projection?.attempts.map((attempt) => [attempt.taskId, attempt.status])).toEqual(
      dispatched.records
        .filter((record) => record.status === 'completed' || record.status === 'failed')
        .map((record) => [record.taskId, record.status]),
    );
  });

  it('does not expose a run projection to a different actor', async () => {
    const turn = await createTurn({ actor: alice, message: 'Build a profile page.' });
    const run = await createExecutionRun(alice, { missionId: turn.missionId, turnId: turn.id });

    expect(await getExecutionRun(bob, run.id)).toBeNull();
  });

  it('rejects attempts that cannot be linked to a task in the pinned mission', async () => {
    const turn = await createTurn({ actor: alice, message: 'Build a profile page.' });
    const run = await createExecutionRun(alice, { missionId: turn.missionId, turnId: turn.id });

    await expect(startTaskAttempt(alice, {
      executionRunId: run.id,
      taskId: 'task_that_never_existed',
    })).rejects.toMatchObject({ message: 'execution_task_not_found', status: 404 });
  });

  it('validates attempts against the run snapshot after a follow-up replaces the mission plan', async () => {
    const workbench = await createWorkbench(alice, { name: 'Snapshot test' });
    const chat = await createChat(alice, { workbenchId: workbench.id, title: 'Snapshot test' });
    const firstTurn = await createTurn({ actor: alice, chatId: chat.id, message: 'Build a React profile page.' });
    const originalTaskId = firstTurn.plan.tasks[0]!.id;
    const run = await createExecutionRun(alice, { missionId: firstTurn.missionId, turnId: firstTurn.id });
    await createTurn({ actor: alice, chatId: chat.id, message: 'Fix the login error in Node.' });

    const attempt = await startTaskAttempt(alice, {
      executionRunId: run.id,
      taskId: originalTaskId,
    });

    expect(attempt.taskId).toBe(originalTaskId);
    expect((await getExecutionRun(alice, run.id))?.run.planSnapshot.tasks.map((task) => task.id))
      .toContain(originalTaskId);
  });

  it('rejects finishing the same task attempt twice', async () => {
    const turn = await createTurn({ actor: alice, message: 'Build a React profile page.' });
    const run = await createExecutionRun(alice, { missionId: turn.missionId, turnId: turn.id });
    const attempt = await startTaskAttempt(alice, {
      executionRunId: run.id,
      taskId: turn.plan.tasks[0]!.id,
    });
    await finishTaskAttempt(alice, { attemptId: attempt.id, status: 'completed' });

    await expect(finishTaskAttempt(alice, { attemptId: attempt.id, status: 'failed' }))
      .rejects.toMatchObject({ message: 'task_attempt_invalid_transition', status: 409 });
  });
});
