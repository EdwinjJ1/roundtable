import { describe, expect, it } from 'vitest';
import {
  canPauseExecution,
  canResumeExecution,
  canRetryAttempt,
  formatAttemptCost,
  formatAttemptDuration,
  formatAttemptModel,
  formatAttemptRuntime,
  formatAttemptTokens,
  groupAttemptsByTask,
  shortContentHash,
} from '../src/ui/lib/workflow-history-formatters.js';

describe('workflow history formatters', () => {
  it('labels missing attempt evidence as unavailable instead of inventing zeros', () => {
    expect(formatAttemptRuntime(null)).toBe('Runtime unavailable');
    expect(formatAttemptModel(null)).toBe('Model unavailable');
    expect(formatAttemptDuration(null)).toBe('Duration unavailable');
    expect(formatAttemptTokens({ status: 'unavailable', reason: 'provider_did_not_report_tokens' })).toBe('Tokens unavailable');
    expect(formatAttemptCost({ status: 'unavailable', reason: 'provider_did_not_report_cost' })).toBe('Cost unavailable');
  });

  it('preserves explicit zero evidence and formats long durations and hashes compactly', () => {
    expect(formatAttemptDuration(0)).toBe('0 ms');
    expect(formatAttemptDuration(65_000)).toBe('1m 5s');
    expect(formatAttemptTokens({ status: 'available', source: 'provider_reported', completeness: 'complete', input: 0, output: 0, total: 0 }))
      .toBe('0 tokens · provider reported');
    expect(formatAttemptTokens({ status: 'available', source: 'provider_reported', completeness: 'partial', input: 120, output: 30, total: 150 }))
      .toBe('150 tokens · partial provider report');
    expect(formatAttemptCost({ status: 'available', source: 'provider_reported', completeness: 'partial', amount: 0, currency: 'USD' }))
      .toContain('partial provider report');
    expect(shortContentHash('1234567890abcdef')).toBe('1234567890ab');
    expect(canPauseExecution('running')).toBe(true);
    expect(canPauseExecution('completed')).toBe(false);
    expect(canResumeExecution('paused')).toBe(true);
    expect(canRetryAttempt('completed', 'completed')).toBe(true);
    expect(canRetryAttempt('failed', 'failed')).toBe(false);
    expect(canRetryAttempt('running', 'completed')).toBe(false);
  });

  it('groups retry history under its pinned task and orders attempts', () => {
    expect(groupAttemptsByTask(
      [{ id: 'task-build', title: 'Build the page', stageId: 'build' }],
      [
        { id: 'attempt-2', taskId: 'task-build', attempt: 2 },
        { id: 'attempt-1', taskId: 'task-build', attempt: 1 },
      ],
    )).toEqual([{
      task: { id: 'task-build', title: 'Build the page', stageId: 'build' },
      attempts: [
        { id: 'attempt-1', taskId: 'task-build', attempt: 1 },
        { id: 'attempt-2', taskId: 'task-build', attempt: 2 },
      ],
    }]);
  });
});
