import { nowIso } from '../../store.js';
import type { Artifact, DispatchRecord, Intake, LocalTurn, Plan, PlanTask, WorkingStyleSnapshot } from '../../types.js';
import { emptyWorkingStyle } from '../skill-actions.js';
import { unresolvedFailureRecords } from './fix-loop.js';
import { formatWorkingStyleForPrompt } from './planning.js';

export function baseArtifacts(
  turnId: string,
  chatId: string,
  message: string,
  intake: Intake,
  plan: Plan,
  workingStyle: WorkingStyleSnapshot = emptyWorkingStyle(),
): Artifact[] {
  const createdAt = nowIso();
  const workingStyleText = formatWorkingStyleForPrompt(workingStyle);
  return [
    {
      id: `intake_${turnId}`,
      chatId,
      kind: 'markdown',
      title: `intake/${turnId}.md`,
      ownerAgentId: 'orchestrator',
      version: 1,
      uri: `turn://${turnId}/intake`,
      preview: [
        '# Intake',
        '',
        message,
        '',
        `Intent: ${intake.intentType}`,
        `Risk: ${intake.risk}`,
        workingStyleText ? `\n## Working style\n\n${workingStyleText}` : '',
      ].filter(Boolean).join('\n'),
      code: null,
      createdAt,
    },
    {
      id: `plan_${turnId}`,
      chatId,
      kind: 'code',
      title: `plans/${turnId}.json`,
      ownerAgentId: 'orchestrator',
      version: 1,
      uri: `turn://${turnId}/plan`,
      preview: JSON.stringify(plan, null, 2),
      code: JSON.stringify(plan, null, 2),
      createdAt,
    },
  ];
}

export function artifactFromRun(
  turn: LocalTurn,
  task: PlanTask,
  result: { text: string; path: string; kind: Artifact['kind'] },
): Artifact {
  return {
    id: `${task.id}_${turn.id}`,
    chatId: turn.localChatId ?? `local-${turn.id}`,
    kind: result.kind,
    title: result.path,
    ownerAgentId: task.owner ?? task.assignee.replace('@', ''),
    version: 1,
    uri: `workspace://${result.path}`,
    preview: result.text,
    code: result.kind === 'code' ? result.text : null,
    createdAt: nowIso(),
  };
}

export function finalReportArtifact(
  turn: LocalTurn,
  artifacts: Artifact[],
  records: DispatchRecord[],
): Artifact {
  const reviewerArtifacts = artifacts.filter((artifact) =>
    artifact.ownerAgentId === 'vera' || artifact.ownerAgentId === 'reviewer',
  );
  const failedRecords = unresolvedFailureRecords(records);
  const testsObserved = artifacts.some((artifact) => /test|spec|review|verify/i.test(`${artifact.title}\n${artifact.preview ?? ''}`));
  const report = [
    `# Final Delivery Report`,
    '',
    `Goal: ${turn.message}`,
    '',
    `Recommendation: accept`,
    `Reviewer confidence: ${failedRecords.length > 0 ? 'blocked' : reviewerArtifacts.length > 0 ? 'pass' : 'warning'}`,
    '',
    `## What changed`,
    '',
    ...artifacts.map((artifact) => `- ${artifact.title} (${artifact.kind}) by ${artifact.ownerAgentId}`),
    '',
    `## Review`,
    '',
    reviewerArtifacts.length > 0
      ? reviewerArtifacts.map((artifact) => `- Reviewed in ${artifact.title}`).join('\n')
      : '- No dedicated reviewer artifact was produced.',
    '',
    `## Tests`,
    '',
    testsObserved
      ? '- Test or verification evidence was mentioned in generated artifacts.'
      : '- No explicit test command output was captured; treat this as a remaining verification gap.',
    '',
    `## Risks`,
    '',
    failedRecords.length > 0
      ? failedRecords.map((record) => `- ${record.taskId}: ${record.error ?? record.status}`).join('\n')
      : '- No blocking task failures recorded.',
  ].join('\n');
  return {
    id: `final_report_${turn.id}`,
    chatId: turn.localChatId ?? `local-${turn.id}`,
    kind: 'markdown',
    title: `reports/${turn.id}-final-delivery.md`,
    ownerAgentId: 'orchestrator',
    version: 1,
    uri: `turn://${turn.id}/final-report`,
    preview: report,
    code: null,
    createdAt: nowIso(),
  };
}

export function reviewerSummaryArtifact(
  turn: LocalTurn,
  artifacts: Artifact[],
  records: DispatchRecord[],
): Artifact {
  const failedRecords = unresolvedFailureRecords(records);
  const reviewerArtifacts = artifacts.filter((artifact) =>
    artifact.ownerAgentId === 'vera' || artifact.ownerAgentId === 'reviewer',
  );
  const testsObserved = artifacts.some((artifact) => /test|spec|review|verify/i.test(`${artifact.title}\n${artifact.preview ?? ''}`));
  const summary = {
    goal: turn.message,
    confidence: failedRecords.length > 0 ? 'blocked' : reviewerArtifacts.length > 0 ? 'pass' : 'warning',
    recommendation: failedRecords.length > 0 ? 'repair' : 'accept',
    testsObserved,
    risks: failedRecords.map((record) => `${record.taskId}: ${record.error ?? record.status}`),
  };
  return {
    id: `review_summary_${turn.id}`,
    chatId: turn.localChatId ?? `local-${turn.id}`,
    kind: 'spec',
    title: `reports/${turn.id}-review-summary.json`,
    ownerAgentId: 'vera',
    version: 1,
    uri: `turn://${turn.id}/review-summary`,
    preview: JSON.stringify(summary, null, 2),
    code: JSON.stringify(summary, null, 2),
    createdAt: nowIso(),
  };
}

export function upsertArtifacts(target: Artifact[], artifacts: Artifact[]): void {
  for (const artifact of artifacts) {
    const index = target.findIndex((item) => item.id === artifact.id && item.chatId === artifact.chatId);
    if (index === -1) target.push(artifact);
    else target[index] = artifact;
  }
}
