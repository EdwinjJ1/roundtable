import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createExecutionRun,
  finishExecutionRun,
  finishTaskAttempt,
  getExecutionRun,
  listExecutionRuns,
  startTaskAttempt,
} from '../src/server/actions/execution-actions.js';
import { saveWorkflowRevision, workflowTemplateById } from '../src/server/actions/mission-actions.js';
import { saveAgentRuntimeConfig } from '../src/server/actions/runtime-actions.js';
import { approveTurn, createTurn } from '../src/server/actions/turn-actions.js';
import { resetData } from '../src/server/store.js';
import type { Actor, WorkflowStage, WorkflowTemplate } from '../src/server/types.js';
import { appRouter } from '../src/server/root.js';
import { createChat } from '../src/server/actions/chat-actions.js';
import { createWorkbench } from '../src/server/actions/workbench-actions.js';
import { listArtifactsByChat, listHandoffsByChat } from '../src/server/actions/read-actions.js';

const alice: Actor = { id: 'alice', email: 'alice@example.com', name: 'Alice' };
const bob: Actor = { id: 'bob', email: 'bob@example.com', name: 'Bob' };
let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'roundtable-execution-control-'));
  process.env.ROUNDTABLE_DATA_PATH = join(tempDir, 'data.json');
  process.env.ROUNDTABLE_WORKSPACE_ROOT = join(tempDir, 'workspaces');
  process.env.ROUNDTABLE_CLARIFY_ENABLED = 'false';
  process.env.ROUNDTABLE_ENABLE_EXTERNAL_AGENT = 'true';
  await resetData();
});

afterEach(async () => {
  delete process.env.ROUNDTABLE_DATA_PATH;
  delete process.env.ROUNDTABLE_WORKSPACE_ROOT;
  delete process.env.ROUNDTABLE_CLARIFY_ENABLED;
  delete process.env.ROUNDTABLE_ENABLE_EXTERNAL_AGENT;
  await rm(tempDir, { recursive: true, force: true });
});

describe('safe checkpoint execution control', () => {
  it('pauses after the current wave and resumes without repeating completed attempts', async () => {
    const aliceCaller = appRouter.createCaller({ session: null, user: alice });
    const bobCaller = appRouter.createCaller({ session: null, user: bob });
    const template = await saveControlWorkflow();
    await configureRuntime('atlas', 'setTimeout(() => process.stdout.write("atlas done"), 350)');
    await configureRuntime('beam', 'process.stdout.write("beam done")');
    await configureRuntime('vera', 'process.stdout.write("review done")');
    const turn = await createTurn({ actor: alice, workflowTemplateId: template.id, message: 'Build a controlled feature.' });
    await approveTurn({
      actor: alice,
      turnId: turn.id,
      decision: 'approve',
      autoDispatch: true,
      background: true,
      agentAdapter: 'agent-cli',
    });
    const running = await waitForRun(turn.id, (projection) =>
      projection.attempts.some((attempt) => attempt.status === 'running'),
    );

    const requested = await aliceCaller.execution.pause({ runId: running.run.id });
    expect(requested.status).toBe('pause_requested');
    const paused = await waitForProjection(running.run.id, (projection) => projection.run.status === 'paused');
    expect(paused.attempts.map((attempt) => attempt.taskId)).toEqual([turn.plan.tasks[0]!.id]);
    expect(paused.attempts[0]?.status).toBe('completed');
    await expect(bobCaller.execution.pause({ runId: running.run.id }))
      .rejects.toMatchObject({ message: 'execution_run_not_found', code: 'NOT_FOUND' });

    await aliceCaller.execution.resume({ runId: running.run.id, agentAdapter: 'agent-cli' });
    const completed = await getExecutionRun(alice, running.run.id);
    expect(completed?.run.status).toBe('completed');
    expect(completed?.run.generation).toBeGreaterThan(running.run.generation);
    expect(completed?.attempts.filter((attempt) => attempt.taskId === turn.plan.tasks[0]!.id)).toHaveLength(1);
    expect(new Set(completed?.attempts.map((attempt) => attempt.taskId))).toEqual(
      new Set(turn.plan.tasks.map((task) => task.id)),
    );
  }, 20_000);

  it('retries one task with a new attempt and reruns every stale downstream task', async () => {
    const caller = appRouter.createCaller({ session: null, user: alice });
    const template = await saveControlWorkflow();
    const workbench = await createWorkbench(alice, { name: 'Retry history' });
    const chat = await createChat(alice, { workbenchId: workbench.id, title: 'Retry history' });
    const turn = await createTurn({ actor: alice, chatId: chat.id, workflowTemplateId: template.id, message: 'Build a retryable feature.' });
    const dispatched = await approveTurn({
      actor: alice,
      turnId: turn.id,
      decision: 'approve',
      autoDispatch: true,
      agentAdapter: 'local-dispatch',
    });
    const runId = dispatched.activeExecutionRunId!;
    const handoffIdsBefore = (await listHandoffsByChat(alice, chat.id)).map((handoff) => handoff.card?.['id']);
    const [upstream, target, downstream] = turn.plan.tasks;
    expect(upstream && target && downstream).toBeTruthy();

    const retryRequested = await caller.execution.retryTask({ runId, taskId: target!.id });
    expect(retryRequested.status).toBe('paused');
    expect(retryRequested.staleTaskIds).toEqual(expect.arrayContaining([target!.id, downstream!.id]));
    expect(retryRequested.staleTaskIds).not.toContain(upstream!.id);

    await caller.execution.resume({ runId, agentAdapter: 'local-dispatch' });
    const retried = await getExecutionRun(alice, runId);
    const attemptsFor = (taskId: string) => retried!.attempts.filter((attempt) => attempt.taskId === taskId);
    expect(attemptsFor(upstream!.id)).toHaveLength(1);
    expect(attemptsFor(target!.id).map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(attemptsFor(downstream!.id).map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(retried?.run.staleTaskIds).toEqual([]);
    const reportIds = (await listArtifactsByChat(alice, chat.id))
      .filter((artifact) => artifact.id.startsWith('final_report_') || artifact.id.startsWith('review_summary_'))
      .map((artifact) => artifact.id);
    const handoffIdsAfter = (await listHandoffsByChat(alice, chat.id)).map((handoff) => handoff.card?.['id']);
    expect(new Set(reportIds).size).toBe(reportIds.length);
    expect(new Set(handoffIdsAfter).size).toBe(handoffIdsAfter.length);
    expect(handoffIdsAfter.length).toBe(handoffIdsBefore.length);
    await expect(caller.execution.pause({ runId }))
      .rejects.toMatchObject({ message: 'execution_run_invalid_state', code: 'CONFLICT' });
  });

  it('commits every task in a parallel wave before honoring pause and lands paused after the final wave', async () => {
    const base = workflowTemplateById('wf-feature-builder');
    const template = await saveWorkflowRevision(alice, { template: { ...base, id: 'wf-parallel-pause' }, expectedRevision: 0 });
    await configureRuntime('atlas', 'process.stdout.write("build done")');
    await configureRuntime('vera', 'setTimeout(() => process.stdout.write("vera done"), 300)');
    await configureRuntime('nova', 'setTimeout(() => process.stdout.write("nova done"), 300)');
    const turn = await createTurn({ actor: alice, workflowTemplateId: template.workflow.id, message: 'Build a React profile page.' });
    await approveTurn({ actor: alice, turnId: turn.id, decision: 'approve', autoDispatch: true, background: true, agentAdapter: 'agent-cli' });
    const reviewTaskIds = turn.plan.tasks.filter((task) => task.stageId === 'review').map((task) => task.id);
    const running = await waitForRun(turn.id, (projection) =>
      projection.attempts.some((attempt) => reviewTaskIds.includes(attempt.taskId) && attempt.status === 'running'),
    );

    await appRouter.createCaller({ session: null, user: alice }).execution.pause({ runId: running.run.id });
    const paused = await waitForProjection(running.run.id, (projection) => projection.run.status === 'paused');
    const reviewAttempts = paused.attempts.filter((attempt) => reviewTaskIds.includes(attempt.taskId));
    expect(reviewAttempts).toHaveLength(reviewTaskIds.length);
    expect(reviewAttempts.every((attempt) => attempt.status === 'completed')).toBe(true);
    expect(reviewAttempts.every((attempt) => attempt.outputSummary && attempt.artifactRefs.length > 0)).toBe(true);
  }, 20_000);

  it('rolls a failed resume startup back to paused and rejects partial retry of a failed run', async () => {
    const caller = appRouter.createCaller({ session: null, user: alice });
    const template = await saveControlWorkflow();
    const turn = await createTurn({ actor: alice, workflowTemplateId: template.id, message: 'Build a resumable feature.' });
    const dispatched = await approveTurn({ actor: alice, turnId: turn.id, decision: 'approve', autoDispatch: true, agentAdapter: 'local-dispatch' });
    const runId = dispatched.activeExecutionRunId!;
    await caller.execution.retryTask({ runId, taskId: turn.plan.tasks[1]!.id });
    const invalidRoot = join(tempDir, 'workspace-root-file');
    await writeFile(invalidRoot, 'not a directory', 'utf8');
    process.env.ROUNDTABLE_WORKSPACE_ROOT = invalidRoot;

    await expect(caller.execution.resume({ runId, agentAdapter: 'local-dispatch' })).rejects.toBeTruthy();
    expect((await getExecutionRun(alice, runId))?.run.status).toBe('paused');

    const failedTurn = await createTurn({ actor: alice, message: 'Build a failing unit.' });
    const failedRun = await createExecutionRun(alice, { missionId: failedTurn.missionId, turnId: failedTurn.id });
    const failedAttempt = await startTaskAttempt(alice, { executionRunId: failedRun.id, taskId: failedTurn.plan.tasks[0]!.id });
    await finishTaskAttempt(alice, { attemptId: failedAttempt.id, status: 'failed' });
    await finishExecutionRun(alice, failedRun.id, 'failed');
    await expect(caller.execution.retryTask({ runId: failedRun.id, taskId: failedTurn.plan.tasks[0]!.id }))
      .rejects.toMatchObject({ message: 'execution_run_invalid_state', code: 'CONFLICT' });
  });

  it('lands paused when a pause request wins the final persistence race', async () => {
    const turn = await createTurn({ actor: alice, message: 'Build one safely pausable unit.' });
    const run = await createExecutionRun(alice, { missionId: turn.missionId, turnId: turn.id });
    const attempt = await startTaskAttempt(alice, {
      executionRunId: run.id,
      taskId: turn.plan.tasks[0]!.id,
      expectedGeneration: run.generation,
    });
    await finishTaskAttempt(alice, {
      attemptId: attempt.id,
      status: 'completed',
      expectedGeneration: run.generation,
    });
    await appRouter.createCaller({ session: null, user: alice }).execution.pause({ runId: run.id });

    expect(await finishExecutionRun(alice, run.id, 'completed', run.generation)).toBeNull();
    const projection = await getExecutionRun(alice, run.id);
    expect(projection?.run.status).toBe('paused');
    expect(projection?.run.finishedAt).toBeNull();
  });
});

async function saveControlWorkflow(): Promise<WorkflowTemplate> {
  const base = workflowTemplateById('wf-feature-builder');
  const intake = base.stages.find((stage) => stage.kind === 'intake')!;
  const ship = base.stages.find((stage) => stage.kind === 'ship')!;
  const stage = (id: string, kind: WorkflowStage['kind'], role: 'implementer' | 'reviewer', agentId: string): WorkflowStage => ({
    id,
    name: id,
    icon: kind === 'review' ? 'eye' : 'code',
    kind,
    desc: `${id} controlled step`,
    seats: [{ ref: { kind: 'role', role, agentId } }],
    gate: { kind: 'none', required: false, label: id, description: id, actions: [] },
    requiredInputs: [],
    expectedOutputs: [],
    requiredCapabilities: [],
  });
  const template: WorkflowTemplate = {
    ...base,
    id: 'wf-control-test',
    stages: [
      intake,
      stage('build-one', 'work', 'implementer', 'atlas'),
      stage('build-two', 'work', 'implementer', 'beam'),
      stage('review-three', 'review', 'reviewer', 'vera'),
      ship,
    ],
  };
  return (await saveWorkflowRevision(alice, { template, expectedRevision: 0 })).revision.template;
}

async function configureRuntime(agentId: string, source: string): Promise<void> {
  await saveAgentRuntimeConfig({
    agentId,
    runtime: 'claude-code',
    command: process.execPath,
    args: ['-e', source],
  });
}

async function waitForRun(
  turnId: string,
  predicate: (projection: NonNullable<Awaited<ReturnType<typeof getExecutionRun>>>) => boolean,
) {
  for (let index = 0; index < 160; index += 1) {
    const projection = (await listExecutionRuns(alice, { turnId, limit: 1 }))[0];
    if (projection && predicate(projection)) return projection;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('execution_run_wait_timeout');
}

async function waitForProjection(
  runId: string,
  predicate: (projection: NonNullable<Awaited<ReturnType<typeof getExecutionRun>>>) => boolean,
) {
  for (let index = 0; index < 160; index += 1) {
    const projection = await getExecutionRun(alice, runId);
    if (projection && predicate(projection)) return projection;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('execution_projection_wait_timeout');
}
