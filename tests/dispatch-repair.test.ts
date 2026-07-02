import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentTask } from '../src/server/actions/agent-runner.js';
import {
  makeFixerTask,
  plannedTaskPatches,
  repairedTargetArtifact,
} from '../src/server/actions/turn-actions.js';
import type { ScheduledTask } from '../src/server/actions/scheduler.js';
import type { Artifact, PlanTask } from '../src/server/types.js';

function task(overrides: Partial<PlanTask> & { id: string }): PlanTask {
  return {
    title: overrides.id,
    assignee: '@agent',
    brief: `${overrides.id} brief`,
    deps: [],
    parallel: false,
    ...overrides,
  };
}

function scheduled(overrides: Partial<ScheduledTask> & { id: string }): ScheduledTask {
  return {
    ...task(overrides),
    status: 'failed',
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('makeFixerTask — repair context deps', () => {
  it('inherits the failed reviewer deps so the fixer sees the reviewed deliverable', () => {
    const failed = scheduled({
      id: 'task_review',
      role: 'reviewer',
      assignee: '@vera',
      owner: 'vera',
      deps: ['task_build'],
    });
    const fixer = makeFixerTask(failed, { message: 'review_found_issues: 1 Critical', review: '# Review' });
    expect(fixer.deps).toContain('task_review');
    expect(fixer.deps).toContain('task_build');
  });

  it('excludes the failed task own repair edge so chained fixers are not blocked', () => {
    const failedFixer = scheduled({
      id: 'fix_task_review_r1',
      role: 'fixer',
      assignee: '@fixer',
      owner: 'fixer',
      deps: ['task_review', 'task_build'],
      producedFor: 'task_review',
      fixRound: 1,
    });
    const fixer = makeFixerTask(failedFixer, { message: 'agent_task_failed' });
    expect(fixer.deps).toContain('fix_task_review_r1');
    expect(fixer.deps).toContain('task_build');
    // task_review is failed (that's why fix round 1 existed): inheriting it as an
    // ordinary dep would mark the round-2 fixer blocked forever.
    expect(fixer.deps).not.toContain('task_review');
  });
});

describe('plannedTaskPatches — concrete titles once the plan exists', () => {
  const tasks: PlanTask[] = [
    task({ id: 'task_planning', role: 'planner', owner: 'orchestrator', assignee: '@planning', title: 'Plan the goal' }),
    task({
      id: 'task_atlas',
      role: 'implementer',
      owner: 'atlas',
      assignee: '@atlas',
      title: 'Build · awaiting plan (Atlas)',
      brief: 'Build · awaiting plan (Atlas). Agent: Atlas. Role: implementer. User request: hotpot site',
      deps: ['task_planning'],
    }),
    task({
      id: 'task_vera',
      role: 'reviewer',
      owner: 'vera',
      assignee: '@vera',
      title: 'Review · awaits the build',
      deps: ['task_atlas'],
    }),
  ];

  it('rewrites downstream placeholder titles and briefs to the concrete goal', () => {
    const patches = plannedTaskPatches(tasks, 'task_planning', 'Build a hotpot restaurant site');
    const atlas = patches.get('task_atlas');
    const vera = patches.get('task_vera');
    expect(atlas).toBeDefined();
    expect(vera).toBeDefined();
    expect(atlas!.title).not.toContain('awaiting plan');
    expect(atlas!.title).toContain('hotpot');
    expect(atlas!.brief).not.toContain('awaiting plan');
    expect(atlas!.brief).toContain('User request: Build a hotpot restaurant site');
    expect(vera!.title).not.toContain('awaits the build');
  });

  it('does not touch the planner itself or unrelated tasks', () => {
    const patches = plannedTaskPatches(tasks, 'task_planning', 'Build a hotpot restaurant site');
    expect(patches.has('task_planning')).toBe(false);
  });
});

describe('repairedTargetArtifact — fix lands in the previewed artifact', () => {
  const original: Artifact = {
    id: 'task_atlas_turn_1',
    chatId: 'chat_1',
    kind: 'preview',
    title: '.roundtable/runs/work/site.html',
    ownerAgentId: 'atlas',
    version: 1,
    uri: 'workspace://.roundtable/runs/work/site.html',
    preview: '<!doctype html><html><body>old</body></html>',
    code: null,
    createdAt: '2026-07-02T00:00:00.000Z',
  };

  it('returns a bumped artifact when the fixer produced a full HTML document', () => {
    const fixed = '<!doctype html>\n<html><body>fixed</body></html>';
    const next = repairedTargetArtifact(original, fixed);
    expect(next).not.toBeNull();
    expect(next!.version).toBe(2);
    expect(next!.preview).toBe(fixed);
    expect(next!.id).toBe(original.id);
    // Immutability: the original object is untouched.
    expect(original.version).toBe(1);
    expect(original.preview).toContain('old');
  });

  it('returns null when the fixer output is prose, not a deliverable', () => {
    expect(repairedTargetArtifact(original, 'I fixed the issues by adjusting the CSS.')).toBeNull();
  });
});

describe('runAgentTask — fixer writes the repaired deliverable in place', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'roundtable-repair-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('honors repairTargetPath so the fix overwrites the original artifact path', async () => {
    const fixer = task({
      id: 'fix_task_review_r1',
      role: 'fixer',
      owner: 'fixer',
      assignee: '@fixer',
      title: 'Apply review fixes (round 1)',
      producedFor: 'task_review',
      fixRound: 1,
      repairTargetPath: '.roundtable/runs/work/site.html',
      repairTargetTaskId: 'task_atlas',
    });
    const result = await runAgentTask({
      adapter: 'local-dispatch',
      workspace: tempDir,
      task: fixer,
      message: 'fix the hotpot site',
    });
    expect(result.path).toBe('.roundtable/runs/work/site.html');
    expect(result.kind).toBe('preview');
  });
});
