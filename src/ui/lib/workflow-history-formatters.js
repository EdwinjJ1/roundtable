export function formatHistoryDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function formatAttemptDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'Duration unavailable';
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

export function formatAttemptTokens(tokens) {
  if (!tokens || tokens.status !== 'available' || !Number.isFinite(tokens.total)) return 'Tokens unavailable';
  return `${new Intl.NumberFormat().format(tokens.total)} tokens · ${formatEvidenceProvenance(tokens)}`;
}

export function formatAttemptCost(cost) {
  if (!cost || cost.status !== 'available' || !Number.isFinite(cost.amount) || !cost.currency) return 'Cost unavailable';
  try {
    const amount = new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cost.currency, maximumFractionDigits: 6,
    }).format(cost.amount);
    return `${amount} · ${formatEvidenceProvenance(cost)}`;
  } catch {
    return `${cost.amount} ${cost.currency} · ${formatEvidenceProvenance(cost)}`;
  }
}

function formatEvidenceProvenance(evidence) {
  return evidence.completeness === 'complete' ? 'provider reported' : 'partial provider report';
}

export function formatAttemptRuntime(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'Runtime unavailable';
}

export function formatAttemptModel(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'Model unavailable';
}

export function shortContentHash(value) {
  const hash = typeof value === 'string' ? value.trim() : '';
  return hash ? hash.slice(0, 12) : 'Hash unavailable';
}

export function groupAttemptsByTask(taskSnapshots, attempts) {
  const taskById = new Map((taskSnapshots || []).map((task) => [task.id, task]));
  const groups = new Map();
  for (const attempt of attempts || []) {
    if (!groups.has(attempt.taskId)) {
      groups.set(attempt.taskId, {
        task: taskById.get(attempt.taskId)
          ?? { id: attempt.taskId, title: `Task ${attempt.taskId}`, stageId: null },
        attempts: [],
      });
    }
    groups.get(attempt.taskId).attempts.push(attempt);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    attempts: group.attempts.sort((left, right) => left.attempt - right.attempt),
  }));
}

export function canPauseExecution(status) {
  return status === 'created' || status === 'running' || status === 'resuming';
}

export function canResumeExecution(status) {
  return status === 'paused';
}

export function canRetryAttempt(runStatus, attemptStatus) {
  return (runStatus === 'paused' || runStatus === 'completed')
    && (attemptStatus === 'completed' || attemptStatus === 'failed');
}
