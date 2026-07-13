import type { Actor, ExecutionRun } from '../types.js';
import {
  prepareExecutionRunResume,
  rollbackExecutionRunResume,
  requestExecutionRunPause,
  requestExecutionTaskRetry,
} from './execution-actions.js';
import { dispatchTurn } from './turns/dispatch.js';
import type { DispatchResponse } from './turns/responses.js';

export async function requestExecutionPause(actor: Actor, runId: string): Promise<ExecutionRun> {
  return requestExecutionRunPause(actor, runId);
}

export async function requestTaskRetry(actor: Actor, runId: string, taskId: string): Promise<ExecutionRun> {
  return requestExecutionTaskRetry(actor, runId, taskId);
}

export async function resumeExecutionRun(input: {
  actor: Actor;
  runId: string;
  agentAdapter?: string | undefined;
}): Promise<DispatchResponse> {
  const run = await prepareExecutionRunResume(input.actor, input.runId);
  try {
    return await dispatchTurn({
      actor: input.actor,
      turnId: run.turnId,
      executionRunId: run.id,
      agentAdapter: input.agentAdapter,
    });
  } catch (error) {
    await rollbackExecutionRunResume(input.actor, run.id, run.generation).catch(() => null);
    throw error;
  }
}
