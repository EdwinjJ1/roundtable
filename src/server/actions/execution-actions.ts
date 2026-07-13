import { id, mutateData, nowIso, readData } from '../store.js';
import type {
  Actor,
  AgentRuntimeKind,
  ExecutionRun,
  PlanTask,
  TaskAttempt,
  TaskAttemptStatus,
} from '../types.js';
import { workflowExecutableContentHash } from './mission-actions.js';

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
    const now = nowIso();
    const run: ExecutionRun = {
      id: id('execution_run'),
      ownerId: actor.id,
      missionId: mission.id,
      turnId: turn.id,
      workflowId: workflowSnapshot.id,
      workflowRevisionId: turn.workflowRevisionId ?? turn.mission?.workflowRevisionId ?? null,
      workflowContentHash,
      workflowSnapshot: structuredClone(workflowSnapshot),
      planSnapshot: structuredClone(turn.plan),
      taskSnapshots: structuredClone(turn.plan.tasks),
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
      || (run.status !== 'created' && run.status !== 'running')
    ) {
      throw new ExecutionActionError('execution_run_fenced', 409);
    }
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

export async function finishTaskAttempt(actor: Actor, input: {
  attemptId: string;
  status: Extract<TaskAttemptStatus, 'completed' | 'failed' | 'cancelled' | 'interrupted'>;
  error?: string | null | undefined;
  expectedGeneration?: number | undefined;
}): Promise<TaskAttempt> {
  return mutateData((data) => {
    const attempt = data.taskAttempts.find((item) => item.id === input.attemptId && item.ownerId === actor.id);
    if (!attempt) throw new ExecutionActionError('task_attempt_not_found', 404);
    const run = data.executionRuns.find((item) => item.id === attempt.executionRunId && item.ownerId === actor.id);
    if (
      input.expectedGeneration !== undefined
      && (!run || run.generation !== input.expectedGeneration || run.status !== 'running')
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
    if (
      expectedGeneration !== undefined
      && (run.generation !== expectedGeneration || (run.status !== 'created' && run.status !== 'running'))
    ) {
      run.workerFinishedAt = nowIso();
      run.updatedAt = run.workerFinishedAt;
      return null;
    }
    const now = nowIso();
    run.status = status;
    run.updatedAt = now;
    run.finishedAt = now;
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
    }
    return run;
  });
}

export async function executionRunIsActive(actor: Actor, runId: string, generation: number): Promise<boolean> {
  const data = await readData();
  const run = data.executionRuns.find((item) => item.id === runId && item.ownerId === actor.id);
  return Boolean(run && run.generation === generation && (run.status === 'created' || run.status === 'running'));
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
