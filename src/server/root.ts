import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { polishText, suggestTasks } from './actions/ai-actions.js';
import {
  createBreakoutRoom,
  listBreakoutRooms,
  postBreakoutMessage,
} from './actions/breakout-actions.js';
import {
  createChat,
  createMessage,
  deleteChat,
  listChats,
  listMessages,
} from './actions/chat-actions.js';
import {
  exportAgentMemory,
  getAgentMemoryOverview,
  importAgentMemory,
} from './actions/agent-memory-actions.js';
import {
  getUserProfile,
  listWorkbenchPins,
  pinWorkbench,
  unpinWorkbench,
  updateUserProfile,
} from './actions/memory-actions.js';
import {
  archiveOwnedWorkflow,
  getMission,
  listMissions,
  listWorkflowRevisions,
  listWorkflowTemplatesForActor,
  saveWorkflowRevision,
  WorkflowTemplateError,
} from './actions/mission-actions.js';
import {
  exportWorkflowRevisionFile,
  importWorkflowFile,
  preflightWorkflowFile,
  WorkflowPortabilityError,
} from './actions/workflow-portability-actions.js';
import { ExecutionActionError, listExecutionRuns } from './actions/execution-actions.js';
import {
  requestExecutionPause,
  requestTaskRetry,
  resumeExecutionRun,
} from './actions/execution-control-actions.js';
import { ActionError } from './actions/turns/errors.js';
import type { WorkflowTemplate } from './types.js';
import { listArtifactsByChat, listHandoffsByChat } from './actions/read-actions.js';
import { createWorkbench, listWorkbenches } from './actions/workbench-actions.js';
import { createTRPCRouter, protectedProcedure, publicProcedure } from './trpc.js';

const idInput = z.object({ id: z.string().min(1) });
const chatIdInput = z.object({ chatId: z.string().min(1) });
const workbenchIdInput = z.object({ workbenchId: z.string().min(1) });

const workbenchesRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) => listWorkbenches(ctx.user)),
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      workspacePath: z.string().optional(),
      description: z.string().nullable().optional(),
    }))
    .mutation(({ ctx, input }) => createWorkbench(ctx.user, input)),
});

const chatsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) => listChats(ctx.user)),
  create: protectedProcedure
    .input(z.object({ workbenchId: z.string().min(1), title: z.string().min(1) }))
    .mutation(({ ctx, input }) => createChat(ctx.user, input)),
  delete: protectedProcedure
    .input(idInput)
    .mutation(({ ctx, input }) => deleteChat(ctx.user, input.id)),
});

const messagesRouter = createTRPCRouter({
  list: protectedProcedure.input(chatIdInput).query(({ ctx, input }) => listMessages(ctx.user, input.chatId)),
  create: protectedProcedure
    .input(z.object({ chatId: z.string().min(1), content: z.string().min(1) }))
    .mutation(({ ctx, input }) => createMessage(ctx.user, input)),
});

const breakoutsRouter = createTRPCRouter({
  listRooms: protectedProcedure.input(chatIdInput).query(({ ctx, input }) => listBreakoutRooms(ctx.user, input.chatId)),
  createRoom: protectedProcedure
    .input(z.object({
      chatId: z.string().min(1),
      participantAgentIds: z.array(z.string().min(1)).length(2),
    }))
    .mutation(({ ctx, input }) => createBreakoutRoom(ctx.user, input)),
  postMessage: protectedProcedure
    .input(z.object({
      roomId: z.string().min(1),
      content: z.string().min(1),
    }))
    .mutation(({ ctx, input }) => postBreakoutMessage(ctx.user, input)),
});

const agentMemoryRouter = createTRPCRouter({
  overview: protectedProcedure
    .input(z.object({ chatId: z.string().min(1).optional() }))
    .query(({ ctx, input }) => getAgentMemoryOverview(ctx.user, input)),
  export: protectedProcedure
    .input(z.object({ chatId: z.string().min(1), agentId: z.string().min(1).optional() }))
    .query(({ ctx, input }) => exportAgentMemory(ctx.user, input)),
  import: protectedProcedure
    .input(z.object({
      chatId: z.string().min(1),
      files: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).min(1).max(300),
    }))
    .mutation(({ ctx, input }) => importAgentMemory(ctx.user, input)),
});

const artifactsRouter = createTRPCRouter({
  listByChat: protectedProcedure.input(chatIdInput).query(({ ctx, input }) => listArtifactsByChat(ctx.user, input.chatId)),
});

const handoffsRouter = createTRPCRouter({
  listByChat: protectedProcedure.input(chatIdInput).query(({ ctx, input }) => listHandoffsByChat(ctx.user, input.chatId)),
});

const userProfileRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx }) => getUserProfile(ctx.user)),
  update: protectedProcedure
    .input(z.object({
      defaultBrief: z.string().optional(),
      defaultSkills: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => updateUserProfile(ctx.user, input)),
});

const workbenchPinnedRouter = createTRPCRouter({
  list: protectedProcedure.input(workbenchIdInput).query(({ ctx, input }) => listWorkbenchPins(ctx.user, input.workbenchId)),
  pin: protectedProcedure
    .input(z.object({ workbenchId: z.string().min(1), content: z.string().min(1) }))
    .mutation(({ ctx, input }) => pinWorkbench(ctx.user, input)),
  unpin: protectedProcedure
    .input(z.object({ workbenchId: z.string().min(1), id: z.string().min(1) }))
    .mutation(({ ctx, input }) => unpinWorkbench(ctx.user, input)),
});

// Structural validation of the editable parts happens in saveWorkflowTemplate
// (stage ids unique, seats reference known agents, at least one runnable
// stage); the zod layer only enforces the shape.
const workflowSeatSchema = z.object({
  ref: z.union([
    z.object({ kind: z.literal('user') }),
    z.object({
      kind: z.literal('role'),
      role: z.enum(['planner', 'pm', 'architect', 'implementer', 'reviewer', 'fixer']),
      agentId: z.string().min(1).optional(),
    }),
  ]),
});

const workflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tag: z.string().nullable(),
  desc: z.string(),
  builtin: z.boolean().optional(),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.string().optional(),
  planning: z.object({
    cut: z.enum(['by_role', 'by_capability', 'by_artifact']),
    clarifyThreshold: z.number().min(0).max(1),
    maxClarifyQuestions: z.number().int().min(0).max(10),
  }),
  stages: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    icon: z.string(),
    kind: z.enum(['intake', 'clarify', 'plan', 'work', 'review', 'repair', 'ship']),
    desc: z.string(),
    seats: z.array(workflowSeatSchema),
    fixed: z.boolean().optional(),
    parallelGroup: z.string().optional(),
    gate: z.object({
      kind: z.string(),
      required: z.boolean(),
      label: z.string(),
      description: z.string(),
      actions: z.array(z.string()),
    }),
    requiredInputs: z.array(z.string()),
    expectedOutputs: z.array(z.string()),
    requiredCapabilities: z.array(z.string()),
  })).min(1),
});

const missionsRouter = createTRPCRouter({
  templates: protectedProcedure.query(({ ctx }) => listWorkflowTemplatesForActor(ctx.user)),
  saveTemplate: protectedProcedure
    .input(z.object({
      template: workflowTemplateSchema,
      expectedRevision: z.number().int().nonnegative(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await saveWorkflowRevision(ctx.user, {
          expectedRevision: input.expectedRevision,
          template: {
            builtin: false,
            version: 0,
            updatedAt: '',
            ...input.template,
          } as WorkflowTemplate,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'workflow_revision_conflict') {
          throw new TRPCError({ code: 'CONFLICT', message: error.message, cause: error });
        }
        throw error;
      }
    }),
  deleteTemplate: protectedProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await archiveOwnedWorkflow(ctx.user, input.id);
      return { ok: true };
    }),
  exportRevision: protectedProcedure
    .input(z.object({ revisionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const exported = await callWorkflowPortability(() => exportWorkflowRevisionFile(ctx.user, input.revisionId));
      return { fileName: exported.fileName, document: exported.file };
    }),
  previewImport: protectedProcedure
    .input(z.object({ document: z.unknown() }))
    .mutation(({ ctx, input }) => callWorkflowPortability(() => preflightWorkflowFile(ctx.user, input.document))),
  importDocument: protectedProcedure
    .input(z.object({
      document: z.unknown(),
      confirmedContentHash: z.string().min(1).max(128),
    }))
    .mutation(({ ctx, input }) => callWorkflowPortability(() => importWorkflowFile(ctx.user, {
      input: input.document,
      confirmedContentHash: input.confirmedContentHash,
    }))),
  revisions: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .query(({ ctx, input }) => listWorkflowRevisions(ctx.user, input.workflowId)),
  runs: protectedProcedure
    .input(z.object({
      workflowId: z.string().min(1).optional(),
      missionId: z.string().min(1).optional(),
      turnId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }).optional())
    .query(async ({ ctx, input }) => (await listExecutionRuns(ctx.user, input ?? {})).map(({ run, attempts }) => ({
      run: {
        id: run.id,
        status: run.status,
        workflowRevisionId: run.workflowRevisionId,
        staleTaskIds: run.staleTaskIds,
        taskSnapshots: run.taskSnapshots.map((task) => ({
          id: task.id,
          title: task.title,
          stageId: task.stageId ?? null,
        })),
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      },
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        taskId: attempt.taskId,
        attempt: attempt.attempt,
        status: attempt.status,
        runtime: attempt.runtime,
        model: attempt.model,
        tokens: attempt.tokens,
        cost: attempt.cost,
        durationMs: attempt.durationMs,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        error: attempt.error,
      })),
    }))),
  list: protectedProcedure
    .input(z.object({ chatId: z.string().min(1).optional() }).optional())
    .query(({ ctx, input }) => listMissions(ctx.user, input?.chatId)),
  get: protectedProcedure
    .input(idInput)
    .query(({ ctx, input }) => getMission(ctx.user, input.id)),
});

async function callWorkflowPortability<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof WorkflowPortabilityError) && !(error instanceof WorkflowTemplateError)) throw error;
    const code = error.status === 404 ? 'NOT_FOUND' : error.status === 409 ? 'CONFLICT' : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.message, cause: error });
  }
}

const aiRouter = createTRPCRouter({
  // Public: the local (unauthenticated) build flow uses Polish too, so it must
  // not require a session. It only rewrites the text the caller sends.
  polish: publicProcedure
    .input(z.object({ text: z.string() }))
    .mutation(({ input }) => polishText(input)),
  suggestTasks: publicProcedure
    .input(z.object({ context: z.string().optional() }).optional())
    .query(({ ctx, input }) => suggestTasks(ctx.user, input?.context)),
});

const executionRouter = createTRPCRouter({
  pause: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(({ ctx, input }) => callExecutionControl(() => requestExecutionPause(ctx.user, input.runId))),
  resume: protectedProcedure
    .input(z.object({ runId: z.string().min(1), agentAdapter: z.string().min(1).optional() }))
    .mutation(({ ctx, input }) => callExecutionControl(() => resumeExecutionRun({
      actor: ctx.user,
      runId: input.runId,
      agentAdapter: input.agentAdapter,
    }))),
  retryTask: protectedProcedure
    .input(z.object({ runId: z.string().min(1), taskId: z.string().min(1) }))
    .mutation(({ ctx, input }) => callExecutionControl(() => requestTaskRetry(ctx.user, input.runId, input.taskId))),
});

async function callExecutionControl<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof ExecutionActionError) && !(error instanceof ActionError)) throw error;
    const status = error.status;
    const code = status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'BAD_REQUEST';
    throw new TRPCError({
      code,
      message: error instanceof Error ? error.message : 'execution_control_failed',
      cause: error,
    });
  }
}

export const appRouter = createTRPCRouter({
  agentMemory: agentMemoryRouter,
  ai: aiRouter,
  artifacts: artifactsRouter,
  breakouts: breakoutsRouter,
  chats: chatsRouter,
  execution: executionRouter,
  handoffs: handoffsRouter,
  messages: messagesRouter,
  missions: missionsRouter,
  userProfile: userProfileRouter,
  workbenches: workbenchesRouter,
  workbenchPinned: workbenchPinnedRouter,
});

export type AppRouter = typeof appRouter;
