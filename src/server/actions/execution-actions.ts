import { id, mutateData, nowIso, readData } from '../store.js';
import type { RoundtableData } from '../store.js';
import type {
  Actor,
  AgentRuntimeKind,
  ExecutionRun,
  PlanTask,
  TaskAttempt,
  TaskAttemptStatus,
} from '../types.js';
import { workflowExecutableContentHash } from './mission-actions.js';
import { workflowRevisionCompatibilityError } from './workflow-portability-actions.js';
import { normalizeUsageEvidence } from './usage-evidence.js';
import { downstreamOf } from './scheduler.js';

export type ExecutionRunProjection = {
  run: ExecutionRun;
  attempts: TaskAttempt[];
};

export class ExecutionActionError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function createExecutionRun(actor: Actor, input: {
  missionId: string;
  turnId: string;
}): Promise<ExecutionRun> {
  return mutateData((data) => {
    const mission = data.missions.find((item) => item.id === input.missionId && item.ownerId === actor.id);
    const turn = data.turns.find((item) => item.id === input.turnId && item.ownerId === actor.id);
    if (!mission || !turn || turn.missionId !== mission.id) {
      throw new ExecutionActionError('execution_source_not_found', 404);
    }
    const workflowSnapshot = turn.workflow as import('../types.js').WorkflowTemplate | null;
    if (!workflowSnapshot) throw new ExecutionActionError('execution_workflow_snapshot_not_found', 409);
    const workflowContentHash = workflowExecutableContentHash(workflowSnapshot);
    if (turn.mission?.workflowContentHash && turn.mission.workflowContentHash !== workflowContentHash) {
      throw new ExecutionActionError('execution_workflow_snapshot_mismatch', 409);
    }
    if (
      turn.workflowRevisionId
      && turn.mission?.workflowRevisionId
      && turn.workflowRevisionId !== turn.mission.workflowRevisionId
    ) {
      throw new ExecutionActionError('execution_workflow_revision_mismatch', 409);
    }
    const workflowRevisionId = turn.workflowRevisionId ?? turn.mission?.workflowRevisionId ?? null;
    assertWorkflowRevisionCompatible(data, actor.id, workflowRevisionId);
    const now = nowIso();
    const run: ExecutionRun = {
      id: id('execution_run'),
      ownerId: actor.id,
      missionId: mission.id,
      turnId: turn.id,
      workflowId: workflowSnapshot.id,
      workflowRevisionId,
      workflowContentHash,
      workflowSnapshot: structuredClone(workflowSnapshot),
      planSnapshot: structuredClone(turn.plan),
      taskSnapshots: structuredClone(turn.plan.tasks),
      staleTaskIds: [],
      status: 'created',
      generation: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      workerFinishedAt: null,
    };
    data.executionRuns.push(run);
    return run;
  });
}

export async function startTaskAttempt(actor: Actor, input: {
  executionRunId: string;
  taskId: string;
  runtime?: AgentRuntimeKind | null | undefined;
  taskSnapshot?: PlanTask | undefined;
  expectedGeneration?: number | undefined;
}): Promise<TaskAttempt> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === input.executionRunId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (
      (input.expectedGeneration !== undefined && run.generation !== input.expectedGeneration)
      || !['created', 'running', 'resuming'].includes(run.status)
    ) {
      throw new ExecutionActionError('execution_run_fenced', 409);
    }
    assertWorkflowRevisionCompatible(data, actor.id, run.workflowRevisionId);
    let pinnedTask = run.taskSnapshots.find((task) => task.id === input.taskId);
    if (!pinnedTask && input.taskSnapshot?.id === input.taskId && input.taskSnapshot.producedFor) {
      const parentIsPinned = run.taskSnapshots.some((task) => task.id === input.taskSnapshot!.producedFor);
      if (parentIsPinned) {
        pinnedTask = structuredClone(input.taskSnapshot);
        run.taskSnapshots.push(pinnedTask);
      }
    }
    if (!pinnedTask) {
      throw new ExecutionActionError('execution_task_not_found', 404);
    }
    const priorAttempts = data.taskAttempts.filter((item) =>
      item.executionRunId === run.id && item.taskId === input.taskId,
    );
    const now = nowIso();
    const attempt: TaskAttempt = {
      id: id('task_attempt'),
      ownerId: actor.id,
      executionRunId: run.id,
      taskId: input.taskId,
      attempt: Math.max(0, ...priorAttempts.map((item) => item.attempt)) + 1,
      status: 'running',
      runtime: input.runtime ?? null,
      model: null,
      ...normalizeUsageEvidence(undefined),
      durationMs: null,
      outputSummary: null,
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: null,
      error: null,
    };
    data.taskAttempts.push(attempt);
    run.status = 'running';
    run.startedAt ??= now;
    run.updatedAt = now;
    return attempt;
  });
}

export async function startTaskAttemptWave(actor: Actor, input: {
  executionRunId: string;
  tasks: PlanTask[];
  expectedGeneration: number;
}): Promise<TaskAttempt[] | null> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === input.executionRunId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (run.generation !== input.expectedGeneration) {
      throw new ExecutionActionError('execution_run_fenced', 409);
    }
    // The pause request and wave registration share this mutation boundary. If
    // pause wins, no task in the wave starts; if the wave wins, every attempt is
    // registered before any task is launched.
    if (run.status === 'pause_requested') return null;
    if (!['created', 'running', 'resuming'].includes(run.status)) {
      throw new ExecutionActionError('execution_run_fenced', 409);
    }
    assertWorkflowRevisionCompatible(data, actor.id, run.workflowRevisionId);

    const pinnedTasks: PlanTask[] = [];
    for (const task of input.tasks) {
      let pinned = run.taskSnapshots.find((candidate) => candidate.id === task.id);
      if (!pinned && task.producedFor && run.taskSnapshots.some((candidate) => candidate.id === task.producedFor)) {
        pinned = structuredClone(task);
      }
      if (!pinned) throw new ExecutionActionError('execution_task_not_found', 404);
      pinnedTasks.push(pinned);
    }

    for (const task of pinnedTasks) {
      if (!run.taskSnapshots.some((candidate) => candidate.id === task.id)) {
        run.taskSnapshots.push(task);
      }
    }
    const now = nowIso();
    const attempts = pinnedTasks.map((task) => {
      const prior = data.taskAttempts.filter((item) => item.executionRunId === run.id && item.taskId === task.id);
      const attempt: TaskAttempt = {
        id: id('task_attempt'),
        ownerId: actor.id,
        executionRunId: run.id,
        taskId: task.id,
        attempt: Math.max(0, ...prior.map((item) => item.attempt)) + 1,
        status: 'running',
        runtime: null,
        model: null,
        ...normalizeUsageEvidence(undefined),
        durationMs: null,
        outputSummary: null,
        artifactRefs: [],
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: null,
        error: null,
      };
      return attempt;
    });
    data.taskAttempts.push(...attempts);
    run.status = 'running';
    run.startedAt ??= now;
    run.updatedAt = now;
    return attempts;
  });
}

export async function finishTaskAttempt(actor: Actor, input: {
  attemptId: string;
  status: Extract<TaskAttemptStatus, 'completed' | 'failed' | 'cancelled' | 'interrupted'>;
  error?: string | null | undefined;
  expectedGeneration?: number | undefined;
  evidence?: {
    runtime?: string | undefined;
    model?: string | null | undefined;
    usage?: Record<string, unknown> | undefined;
  } | undefined;
  outputSummary?: string | null | undefined;
  artifactRefs?: string[] | undefined;
}): Promise<TaskAttempt> {
  return mutateData((data) => {
    const attempt = data.taskAttempts.find((item) => item.id === input.attemptId && item.ownerId === actor.id);
    if (!attempt) throw new ExecutionActionError('task_attempt_not_found', 404);
    const run = data.executionRuns.find((item) => item.id === attempt.executionRunId && item.ownerId === actor.id);
    if (
      input.expectedGeneration !== undefined
      && (!run || run.generation !== input.expectedGeneration || !['running', 'pause_requested'].includes(run.status))
    ) {
      throw new ExecutionActionError('execution_run_fenced', 409);
    }
    if (attempt.status !== 'running') {
      throw new ExecutionActionError('task_attempt_invalid_transition', 409);
    }
    const now = nowIso();
    attempt.status = input.status;
    attempt.updatedAt = now;
    attempt.finishedAt = now;
    attempt.error = input.error ?? null;
    attempt.outputSummary = input.outputSummary ?? attempt.outputSummary;
    attempt.artifactRefs = input.artifactRefs ? [...new Set(input.artifactRefs)] : attempt.artifactRefs;
    if (input.evidence) {
      attempt.runtime = input.evidence.runtime ?? attempt.runtime;
      attempt.model = input.evidence.model ?? null;
      Object.assign(attempt, normalizeUsageEvidence(input.evidence.usage));
    }
    attempt.durationMs = attempt.startedAt
      ? Math.max(0, Date.parse(now) - Date.parse(attempt.startedAt))
      : null;
    if (run) run.updatedAt = now;
    return attempt;
  });
}

export async function finishExecutionRun(
  actor: Actor,
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  expectedGeneration?: number,
): Promise<ExecutionRun | null> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (expectedGeneration !== undefined && run.generation === expectedGeneration && run.status === 'pause_requested') {
      const now = nowIso();
      run.status = 'paused';
      run.updatedAt = now;
      run.workerFinishedAt = now;
      return null;
    }
    if (
      expectedGeneration !== undefined
      && (run.generation !== expectedGeneration || !['created', 'running', 'resuming'].includes(run.status))
    ) {
      run.workerFinishedAt = nowIso();
      run.updatedAt = run.workerFinishedAt;
      return null;
    }
    const now = nowIso();
    run.status = status;
    run.updatedAt = now;
    run.finishedAt = now;
    if (status === 'completed') run.staleTaskIds = [];
    return run;
  });
}

export async function requestExecutionRunPause(actor: Actor, runId: string): Promise<ExecutionRun> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (!['created', 'running'].includes(run.status)) {
      throw new ExecutionActionError('execution_run_invalid_state', 409);
    }
    run.status = 'pause_requested';
    run.updatedAt = nowIso();
    return run;
  });
}

export async function executionRunPauseRequested(
  actor: Actor,
  runId: string,
  generation: number,
): Promise<boolean> {
  const data = await readData();
  const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
  return Boolean(run && run.generation === generation && run.status === 'pause_requested');
}

export async function markExecutionRunPaused(
  actor: Actor,
  runId: string,
  generation: number,
): Promise<ExecutionRun> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (run.generation !== generation || run.status !== 'pause_requested') {
      throw new ExecutionActionError('execution_run_fenced', 409);
    }
    run.status = 'paused';
    run.updatedAt = nowIso();
    return run;
  });
}

export async function prepareExecutionRunResume(actor: Actor, runId: string): Promise<ExecutionRun> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (run.status !== 'paused') throw new ExecutionActionError('execution_run_invalid_state', 409);
    run.generation += 1;
    run.status = 'resuming';
    run.updatedAt = nowIso();
    run.finishedAt = null;
    run.workerFinishedAt = null;
    return run;
  });
}

export async function rollbackExecutionRunResume(
  actor: Actor,
  runId: string,
  generation: number,
): Promise<ExecutionRun | null> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (run.generation !== generation || run.status !== 'resuming') return null;
    run.status = 'paused';
    run.updatedAt = nowIso();
    return run;
  });
}

export async function requestExecutionTaskRetry(actor: Actor, runId: string, taskId: string): Promise<ExecutionRun> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
    if (!run) throw new ExecutionActionError('execution_run_not_found', 404);
    if (!['paused', 'completed'].includes(run.status)) {
      throw new ExecutionActionError('execution_run_invalid_state', 409);
    }
    if (!run.taskSnapshots.some((task) => task.id === taskId)) {
      throw new ExecutionActionError('execution_task_not_found', 404);
    }
    const stale = new Set([taskId, ...downstreamOf(taskId, run.taskSnapshots)]);
    run.staleTaskIds = [...new Set([...run.staleTaskIds, ...stale])];
    run.generation += 1;
    run.status = 'paused';
    run.updatedAt = nowIso();
    run.finishedAt = null;
    run.workerFinishedAt = null;
    return run;
  });
}

export async function interruptExecutionRun(actor: Actor, runId: string): Promise<ExecutionRun | null> {
  return mutateData((data) => {
    const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
    if (!run) return null;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return run;
    const now = nowIso();
    run.status = 'cancelled';
    run.generation += 1;
    run.updatedAt = now;
    run.finishedAt = now;
    for (const attempt of data.taskAttempts) {
      if (attempt.executionRunId !== run.id || attempt.status !== 'running') continue;
      attempt.status = 'interrupted';
      attempt.updatedAt = now;
      attempt.finishedAt = now;
      attempt.error = 'interrupted_by_user';
      attempt.durationMs = attempt.startedAt
        ? Math.max(0, Date.parse(now) - Date.parse(attempt.startedAt))
        : null;
    }
    return run;
  });
}

export async function executionRunIsActive(actor: Actor, runId: string, generation: number): Promise<boolean> {
  const data = await readData();
  const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
  return Boolean(run && run.generation === generation && ['created', 'running', 'resuming', 'pause_requested'].includes(run.status));
}

export async function getExecutionRun(actor: Actor, runId: string): Promise<ExecutionRunProjection | null> {
  const data = await readData();
  const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
  if (!run) return null;
  return {
    run,
    attempts: data.taskAttempts
      .filter((item) => item.ownerId === actor.id && item.executionRunId === run.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.attempt - b.attempt),
  };
}

export async function listExecutionRuns(actor: Actor, input: {
  workflowId?: string | undefined;
  missionId?: string | undefined;
  turnId?: string | undefined;
  limit?: number | undefined;
} = {}): Promise<ExecutionRunProjection[]> {
  const data = await readData();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  return data.executionRuns
    .filter((run) => run.ownerId === actor.id)
    .filter((run) => !input.workflowId || run.workflowId === input.workflowId)
    .filter((run) => !input.missionId || run.missionId === input.missionId)
    .filter((run) => !input.turnId || run.turnId === input.turnId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, limit)
    .map((run) => ({
      run,
      attempts: data.taskAttempts
        .filter((attempt) => attempt.ownerId === actor.id && attempt.executionRunId === run.id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.attempt - right.attempt),
    }));
}

function assertWorkflowRevisionCompatible(
  data: RoundtableData,
  ownerId: string,
  workflowRevisionId: string | null,
): void {
  if (!workflowRevisionId || workflowRevisionId.startsWith('builtin:')) return;
  const revision = data.workflowRevisions.find((item) =>
    item.id === workflowRevisionId && item.ownerId === ownerId,
  );
  if (!revision) throw new ExecutionActionError('execution_workflow_revision_not_found', 409);
  const compatibilityError = workflowRevisionCompatibilityError(revision, data);
  if (compatibilityError) throw new ExecutionActionError(compatibilityError, 409);
}
