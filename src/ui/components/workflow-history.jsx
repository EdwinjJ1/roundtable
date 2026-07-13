import React from 'react';
import { Icon, alpha } from './primitives';
import {
  canPauseExecution,
  canResumeExecution,
  canRetryAttempt,
  formatAttemptCost,
  formatAttemptDuration,
  formatAttemptModel,
  formatAttemptRuntime,
  formatAttemptTokens,
  formatHistoryDate,
  groupAttemptsByTask,
  shortContentHash,
} from '../lib/workflow-history-formatters';

const { useEffect, useRef, useState } = React;

function WorkflowHistory({ workflowId, revisionId, enabled, handlers }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const generationRef = useRef(0);
  const actionKeyRef = useRef(null);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const [state, setState] = useState({ loading: false, revisions: [], runs: [], error: null });
  const [actionKey, setActionKey] = useState(null);

  useEffect(() => {
    if (!enabled || !workflowId || !handlersRef.current?.revisions || !handlersRef.current?.runs) {
      setState({ loading: false, revisions: [], runs: [], error: null });
      return undefined;
    }
    const generation = ++generationRef.current;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    Promise.all([
      handlersRef.current.revisions({ workflowId }),
      handlersRef.current.runs({ workflowId, limit: 8 }),
    ]).then(([revisions, runs]) => {
      if (!active || generation !== generationRef.current) return;
      setState({
        loading: false,
        revisions: Array.isArray(revisions) ? revisions : [],
        runs: Array.isArray(runs) ? runs : [],
        error: null,
      });
    }).catch((error) => {
      if (!active || generation !== generationRef.current) return;
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load workflow history.',
      }));
    });
    return () => {
      active = false;
    };
  }, [enabled, workflowId, revisionId, refreshGeneration]);

  if (!enabled) return null;
  const runControl = async (action, input, key) => {
    if (actionKeyRef.current || !handlersRef.current?.[action]) return;
    actionKeyRef.current = key;
    setActionKey(key);
    setState((current) => ({ ...current, error: null }));
    try {
      await handlersRef.current[action](input);
      setRefreshGeneration((value) => value + 1);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Could not update this execution run.',
      }));
    } finally {
      actionKeyRef.current = null;
      setActionKey(null);
    }
  };
  return (
    <section aria-labelledby="workflow-history-title" style={{ marginTop: 20, border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="layers" size={14} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1 }}>
          <div id="workflow-history-title" style={{ fontSize: 13.5, fontWeight: 750 }}>Versions & run history</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--text-faint)' }}>Immutable definitions and the runs pinned to them.</div>
        </div>
        <button type="button" onClick={() => setRefreshGeneration((value) => value + 1)} disabled={state.loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', font: 'inherit',
            fontSize: 11.5, cursor: state.loading ? 'default' : 'pointer', opacity: state.loading ? 0.55 : 1 }}>
          <Icon name="replay" size={12} /> Refresh
        </button>
      </header>
      {state.error && <div role="alert" style={{ margin: 12, padding: '8px 10px', borderRadius: 'var(--r-sm)',
        color: 'var(--bad)', background: alpha('var(--bad)', 10), fontSize: 12.5 }}>{state.error}</div>}
      {state.loading && state.revisions.length === 0 && state.runs.length === 0
        ? <div role="status" style={{ padding: 16, color: 'var(--text-faint)', fontSize: 12.5 }}>Loading workflow history…</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <RevisionList revisions={state.revisions} currentRevisionId={revisionId} />
            <RunList runs={state.runs} handlers={handlers} actionKey={actionKey} onControl={runControl} />
          </div>}
    </section>
  );
}

function RevisionList({ revisions, currentRevisionId }) {
  return <div style={{ padding: 12, borderRight: '1px solid var(--border)', minWidth: 0 }}>
    <div style={sectionLabel}>Versions · {revisions.length}</div>
    {revisions.length === 0
      ? <Empty text="No saved revisions yet." />
      : <div style={{ display: 'grid', gap: 7 }}>
          {revisions.slice(0, 8).map((revision) => {
            const current = revision.id === currentRevisionId;
            return <div key={revision.id} style={{ padding: '8px 9px', borderRadius: 'var(--r-sm)',
              border: `1px solid ${current ? 'var(--accent)' : 'var(--border)'}`,
              background: current ? alpha('var(--accent)', 7) : 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 750 }}>Revision {revision.revision}</span>
                {current && <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--accent)', fontWeight: 750 }}>CURRENT</span>}
              </div>
              <div className="mono" title={revision.contentHash || ''} style={{ marginTop: 4, fontSize: 10.5, color: 'var(--text-muted)' }}>
                {shortContentHash(revision.contentHash)}
              </div>
              <div style={{ marginTop: 3, fontSize: 10.5, color: 'var(--text-faint)' }}>{formatHistoryDate(revision.createdAt)}</div>
            </div>;
          })}
        </div>}
  </div>;
}

function RunList({ runs, handlers, actionKey, onControl }) {
  return <div style={{ padding: 12, minWidth: 0 }}>
    <div style={sectionLabel}>Recent runs · {runs.length}</div>
    {runs.length === 0
      ? <Empty text="No runs are linked to this workflow yet." />
      : <div style={{ display: 'grid', gap: 8 }}>
          {runs.map(({ run, attempts }) => <RunRow key={run.id} run={run} attempts={attempts || []}
            handlers={handlers} actionKey={actionKey} onControl={onControl} />)}
        </div>}
  </div>;
}

function RunRow({ run, attempts, handlers, actionKey, onControl }) {
  const statusColor = run.status === 'completed' ? 'var(--ok)'
    : run.status === 'failed' || run.status === 'cancelled' ? 'var(--bad)'
      : run.status === 'paused' || run.status === 'pause_requested' ? 'var(--warn)' : 'var(--run)';
  const busy = Boolean(actionKey);
  const taskGroups = groupAttemptsByTask(run.taskSnapshots, attempts);
  return <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', flexWrap: 'wrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
      <span style={{ color: statusColor, fontSize: 11.5, fontWeight: 750, textTransform: 'capitalize' }}>{run.status}</span>
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{formatHistoryDate(run.startedAt || run.createdAt)}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {handlers?.pause && canPauseExecution(run.status) && (
          <ControlButton label={actionKey === `pause:${run.id}` ? 'Pausing…' : 'Pause'} disabled={busy}
            onClick={() => onControl('pause', { runId: run.id }, `pause:${run.id}`)} />
        )}
        {handlers?.resume && canResumeExecution(run.status) && (
          <ControlButton label={actionKey === `resume:${run.id}` ? 'Resuming…' : 'Resume'} disabled={busy}
            primary onClick={() => onControl('resume', { runId: run.id }, `resume:${run.id}`)} />
        )}
      </div>
    </div>
    <details>
      <summary style={{ padding: '6px 9px', cursor: 'pointer', borderTop: '1px solid var(--border)',
        color: 'var(--text-muted)', fontSize: 10.5 }}>
        {attempts.length} attempt{attempts.length === 1 ? '' : 's'} · Show details
      </summary>
      <div style={{ borderTop: '1px solid var(--border)', padding: '6px 9px 9px', display: 'grid', gap: 6 }}>
        {taskGroups.length === 0
          ? <Empty text="No task attempts were recorded." />
          : taskGroups.map((group) => <TaskAttemptGroup key={group.task.id} group={group} run={run}
            canRetry={Boolean(handlers?.retryTask)} actionKey={actionKey} onControl={onControl} />)}
      </div>
    </details>
  </div>;
}

function TaskAttemptGroup({ group, run, canRetry, actionKey, onControl }) {
  const latestAttempt = group.attempts[group.attempts.length - 1];
  return <section style={{ borderRadius: 7, border: '1px solid var(--border)', overflow: 'hidden' }}>
    <div style={{ padding: '6px 7px', background: 'var(--surface-2)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{group.task.title}</div>
      <div className="mono" style={{ marginTop: 2, fontSize: 9.5, color: 'var(--text-faint)' }}>
        {group.task.stageId || 'stage unavailable'} · {group.task.id}
      </div>
    </div>
    <div style={{ display: 'grid', gap: 1 }}>
      {group.attempts.map((attempt) => <AttemptRow key={attempt.id} attempt={attempt} run={run}
        canRetry={canRetry && attempt.id === latestAttempt?.id} actionKey={actionKey} onControl={onControl} />)}
    </div>
  </section>;
}

function AttemptRow({ attempt, run, canRetry, actionKey, onControl }) {
  const retryKey = `retry:${run.id}:${attempt.taskId}`;
  const retryable = canRetry && canRetryAttempt(run.status, attempt.status);
  return <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '6px 7px', borderRadius: 7, background: 'var(--surface)' }}>
    <div style={{ minWidth: 110, flex: '.8 1 110px' }}>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text)' }}>{formatAttemptRuntime(attempt.runtime)}</div>
      <div style={{ fontSize: 9.5, color: 'var(--text-faint)', marginTop: 2 }}>attempt {attempt.attempt} · {attempt.status}</div>
    </div>
    <div className="mono" title={attempt.model || ''} style={{ minWidth: 120, flex: '1 1 140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5, color: 'var(--text-muted)' }}>
      {formatAttemptModel(attempt.model)}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Metric value={formatAttemptDuration(attempt.durationMs)} />
      <Metric value={formatAttemptTokens(attempt.tokens)} />
      <Metric value={formatAttemptCost(attempt.cost)} />
    </div>
    {retryable && <ControlButton label={actionKey === retryKey ? 'Retrying…' : 'Retry step'} disabled={Boolean(actionKey)}
      onClick={() => onControl('retryTask', { runId: run.id, taskId: attempt.taskId }, retryKey)} />}
  </div>;
}

function ControlButton({ label, onClick, disabled, primary }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{ padding: '4px 7px', borderRadius: 6,
    border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--accent)' : 'var(--surface)',
    color: primary ? '#fff' : 'var(--text-muted)', font: 'inherit', fontSize: 10.5, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}>{label}</button>;
}

function Metric({ value }) {
  const unavailable = /unavailable/i.test(value);
  return <span style={{ fontSize: 10.5, color: unavailable ? 'var(--text-faint)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{value}</span>;
}

function Empty({ text }) {
  return <div style={{ padding: '9px 2px', color: 'var(--text-faint)', fontSize: 11.5 }}>{text}</div>;
}

const sectionLabel = { marginBottom: 8, fontSize: 10.5, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' };

export { WorkflowHistory };
