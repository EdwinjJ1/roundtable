/*
  Actor-facing surface of the agent memory store, consumed by the tRPC router:
  overview for the Memory panel, portable export/import bundles, and the
  user-confirmed promotion of a project fact into the global store.

  This layer owns auth and workspace resolution only; all file semantics
  (formats, budgets, capacity) live in agent-memory.ts.
*/

import type { Actor } from '../types.js';
import {
  importGlobalFacts,
  loadAgentMemory,
  promoteFactToGlobal,
} from './agent-memory.js';
import type { MemoryFact } from './agent-memory.js';
import { AGENT_ROSTER } from './agent-roster.js';
import { getChat } from './chat-actions.js';
import { workspacePathForChat } from './turns/workspace.js';

export type MemoryFactView = Pick<MemoryFact, 'scope' | 'slug' | 'description' | 'type' | 'lines' | 'bytes' | 'overLimit'>;

export type AgentMemoryOverview = {
  agentId: string;
  displayName: string;
  role: string;
  facts: MemoryFactView[];
  compactionNeeds: string[];
};

export type MemoryBundle = {
  exportedAt: string;
  files: Array<{ path: string; content: string }>;
};

// One call for the whole Memory panel: every roster agent that has memory.
export async function getAgentMemoryOverview(
  actor: Actor,
  input: { chatId?: string | undefined },
): Promise<AgentMemoryOverview[]> {
  const workspace = await resolveWorkspace(actor, input.chatId);
  const overviews = await Promise.all(AGENT_ROSTER.map(async (agent) => {
    const memory = await loadAgentMemory({ workspace, agentId: agent.id, ownerId: actor.id });
    return {
      agentId: agent.id,
      displayName: agent.displayName,
      role: agent.role,
      facts: memory.facts.map(factView),
      compactionNeeds: memory.compactionNeeds,
    };
  }));
  return overviews.filter((overview) => overview.facts.length > 0 || overview.compactionNeeds.length > 0);
}

/*
  Export = the memory folders as a portable JSON bundle of Markdown files.
  Paths are scope/agent/slug.md, so the bundle can be unpacked into another
  Roundtable, another machine, or even a Claude-Code-style memory directory.
*/
export async function exportAgentMemory(
  actor: Actor,
  input: { chatId?: string | undefined; agentId?: string | undefined },
): Promise<MemoryBundle> {
  const agents = input.agentId ? AGENT_ROSTER.filter((agent) => agent.id === input.agentId) : AGENT_ROSTER;
  if (agents.length === 0) throw new Error('unknown_agent');
  const workspace = await resolveWorkspace(actor, input.chatId);
  const perAgent = await Promise.all(agents.map(async (agent) => {
    const memory = await loadAgentMemory({ workspace, agentId: agent.id, ownerId: actor.id });
    return memory.facts.map((fact) => ({
      path: `${fact.scope}/${agent.id}/${fact.slug}.md`,
      content: fact.text,
    }));
  }));
  return {
    exportedAt: new Date().toISOString(),
    files: perAgent.flat(),
  };
}

// Receiving end of a bundle: facts land in the actor's GLOBAL store.
export async function importAgentMemory(
  actor: Actor,
  input: { agentId: string; files: Array<{ slug: string; content: string }> },
): Promise<{ imported: string[]; skipped: string[] }> {
  requireAgent(input.agentId);
  return importGlobalFacts({ ownerId: actor.id, agentId: input.agentId, files: input.files });
}

export async function promoteAgentMemoryFact(
  actor: Actor,
  input: { chatId: string; agentId: string; slug: string },
): Promise<{ status: 'promoted' | 'not_found' | 'store_full' }> {
  requireAgent(input.agentId);
  const workspace = await resolveWorkspace(actor, input.chatId);
  if (!workspace) throw new Error('chat_not_found');
  const status = await promoteFactToGlobal({
    workspace,
    ownerId: actor.id,
    agentId: input.agentId,
    slug: input.slug,
  });
  return { status };
}

function factView(fact: MemoryFact): MemoryFactView {
  return {
    scope: fact.scope,
    slug: fact.slug,
    description: fact.description,
    type: fact.type,
    lines: fact.lines,
    bytes: fact.bytes,
    overLimit: fact.overLimit,
  };
}

function requireAgent(agentId: string): void {
  if (!AGENT_ROSTER.some((agent) => agent.id === agentId)) throw new Error('unknown_agent');
}

// Ownership check + path resolution. No chat → global scope only.
async function resolveWorkspace(actor: Actor, chatId: string | undefined): Promise<string | null> {
  if (!chatId) return null;
  const chat = await getChat(actor, chatId);
  if (!chat) throw new Error('chat_not_found');
  return workspacePathForChat(chatId);
}
