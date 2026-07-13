/* ============================================================================
   Roundtable — workflow.jsx
   The packaged, customizable WORKFLOW as a first-class surface (seats model;
   specs/090-workflows.md, ADR-009). Novices start from a proven workflow; power
   users reshape every stage. Configure objects — never draw a DAG.
   ============================================================================ */
import React from 'react';
import { RT } from '../lib/rt';
import {
  createServerWorkflowDraft,
  createWorkflowEditSession,
  createWorkflowSaveController,
  workflowEditSessionSnapshot,
} from '../lib/workflow-save-controller';
import { WorkflowTransfer } from './workflow-transfer';
import { WorkflowHistory } from './workflow-history';
import { Avatar, Icon, alpha, tint } from './primitives';
const { useState: useStateW, useEffect: useEffectW } = React;

const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit',
  fontSize: 12.5, fontWeight: 500, cursor: 'pointer' };

const ICON_OPTS = ['clip', 'layers', 'code', 'eye', 'rocket', 'search', 'edit', 'wrench', 'sparkle', 'door'];
const GATES = [
  { kind: 'none', label: 'No gate', icon: 'dot', hint: 'Flows straight through.' },
  { kind: 'reviewer_signoff', label: 'Reviewer sign-off', icon: 'eye', hint: 'A reviewer must approve before the run continues.' },
  { kind: 'user_approval', label: 'Your approval', icon: 'check', hint: 'Pauses for you to approve before continuing.' },
];
const roleColor = (role) => RT.ROLE_COLORS[role] || 'var(--text-muted)';
const clone = (x) => JSON.parse(JSON.stringify(x));

function activeWorkflow() {
  const id = RT.WORKBENCH.workflowId;
  return (RT.workflows || []).find((w) => w.id === id)
    || RT.BUILTIN_WORKFLOWS.find((w) => w.id === id)
    || RT.BUILTIN_WORKFLOWS[0];
}

function Toggle({ on, onClick, label }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none',
      border: 'none', cursor: 'pointer', font: 'inherit', padding: 0, color: 'var(--text-muted)' }}>
      <span style={{ width: 30, height: 18, borderRadius: 999, padding: 2, background: on ? 'var(--accent)' : 'var(--surface-3)',
        transition: 'background .15s', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
        <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(60,60,90,.28)' }} />
      </span>
      <span style={{ fontSize: 11.5 }}>{label}</span>
    </button>
  );
}

const seatChip = (c) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 4px',
  borderRadius: 999, background: 'var(--surface-2)', border: `1px solid ${alpha(c, 35)}` });
const removeX = { position: 'absolute', top: -5, right: -5, width: 15, height: 15, borderRadius: '50%', border: 'none',
  background: 'var(--bad)', color: '#fff', cursor: 'pointer', display: 'none', placeItems: 'center', padding: 0 };

/* ---- SeatChips : the roster for a stage (roles, optionally bound to agents) - */
function SeatChips({ seats, agents, editable, onRemove, onAdd, addLabel }) {
  const [menu, setMenu] = useStateW(false);
  const members = (RT.WORKBENCH.members || []).map((id) => agents[id]).filter(Boolean);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', position: 'relative' }}>
      {(seats || []).map((s, i) => {
        if (s.ref.kind === 'user') {
          return (
            <span key={i} className="rt-member" style={{ ...seatChip('var(--pm)'), position: 'relative' }}>
              <Avatar agent={{ id: 'you-user', displayName: 'You', color: '#8076a0' }} size={18} ring={false} />
              <span style={{ fontSize: 11.5 }}>You</span>
              {editable && onRemove && <button onClick={() => onRemove(i)} className="rt-member-x" style={removeX}><Icon name="x" size={9} /></button>}
            </span>
          );
        }
        const role = s.ref.role;
        const a = s.ref.agentId ? agents[s.ref.agentId] : null;
        const c = a ? a.color : roleColor(role);
        return (
          <span key={i} className="rt-member" style={{ ...seatChip(c), position: 'relative' }}>
            {a ? <Avatar agent={a} size={18} ring={false} /> : <span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />}
            <span style={{ fontSize: 11.5, fontWeight: 500 }}>{a ? a.displayName : `@${role}`}</span>
            {a && <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>@{role}</span>}
            {editable && onRemove && <button onClick={() => onRemove(i)} className="rt-member-x" style={removeX}><Icon name="x" size={9} /></button>}
          </span>
        );
      })}
      {editable && onAdd && (
        <>
          <button onClick={() => setMenu((o) => !o)} type="button" aria-expanded={menu} aria-label="Add a role or person"
            style={{ minWidth: 24, height: 28, padding: addLabel ? '0 9px' : 0, borderRadius: addLabel ? 'var(--r-sm)' : '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              border: '1.5px dashed var(--border-strong)', background: 'var(--surface-2)',
              color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 11.5, fontWeight: 600 }}>
            <Icon name="plus" size={12} />{addLabel && <span>{addLabel}</span>}
          </button>
          {menu && (
            <div className="rt-zoom" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 6, width: 220,
              background: 'var(--surface)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)',
              overflow: 'hidden', padding: 4 }}>
              <div style={menuLabel}>Add someone</div>
              {members.map((a) => (
                <button key={a.agentId} onClick={() => { onAdd({ ref: { kind: 'role', role: a.role, agentId: a.agentId } }); setMenu(false); }} style={menuRow}>
                  <Avatar agent={a} size={18} ring={false} /><span>{a.displayName}</span>
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-faint)' }}>@{a.role}</span>
                </button>
              ))}
              <button onClick={() => { onAdd({ ref: { kind: 'user' } }); setMenu(false); }} style={{ ...menuRow, borderTop: '1px solid var(--border)', marginTop: 2 }}>
                <Avatar agent={{ id: 'you-user', displayName: 'You', color: '#8076a0' }} size={18} ring={false} /><span>You</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
const menuLabel = { fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)', padding: '7px 8px 3px' };
const menuRow = { width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--r-sm)',
  border: 'none', background: 'transparent', color: 'var(--text)', font: 'inherit', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' };

/* ---- StageCard : compact summary; opens the StageDrawer to configure -------- */
function StageCard({ stage, idx, agents, onEdit, onMove, onRemove, onConfigure, canLeft, canRight }) {
  const moveBtn = (enabled) => ({ width: 22, height: 24, borderRadius: 7, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text-muted)', cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.35, display: 'grid', placeItems: 'center', padding: 0 });
  const editFocus = (e) => (e.currentTarget.style.borderColor = 'var(--border)');
  const editBlur = (e) => (e.currentTarget.style.borderColor = 'transparent');
  const parallel = !!stage.parallelGroup;
  const gate = stage.gate && stage.gate.kind !== 'none' ? GATES.find((g) => g.kind === stage.gate.kind) : null;
  return (
    <div style={{ width: 234, flexShrink: 0, background: 'var(--surface)', borderRadius: 'var(--r-card)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', position: 'relative' }}>
      {parallel && <div style={{ position: 'absolute', inset: 0, borderRadius: 'var(--r-card)', pointerEvents: 'none',
        boxShadow: `0 8px 0 -4px var(--surface), 0 9px 0 -4px var(--border), 0 16px 0 -8px var(--surface), 0 17px 0 -8px var(--border)` }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 13px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          background: tint('var(--accent)', 13), color: 'var(--accent)' }}><Icon name={stage.icon} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input value={stage.name} onChange={(e) => onEdit('name', e.target.value)} title="Rename stage" spellCheck={false}
            onFocus={editFocus} onBlur={editBlur}
            style={{ width: '100%', font: 'inherit', fontSize: 13.5, fontWeight: 600, color: 'var(--text)', background: 'transparent',
              border: '1px solid transparent', borderRadius: 6, outline: 'none', padding: '1px 4px', margin: '-1px -4px' }} />
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 3 }}>
            stage {idx + 1}{parallel ? ' · parallel' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          <button onClick={() => canLeft && onMove(-1)} disabled={!canLeft} title="Move earlier" style={moveBtn(canLeft)}>
            <Icon name="chevron" size={11} style={{ transform: 'rotate(180deg)' }} /></button>
          <button onClick={() => canRight && onMove(1)} disabled={!canRight} title="Move later" style={moveBtn(canRight)}>
            <Icon name="chevron" size={11} /></button>
          {!stage.fixed && onRemove && <button onClick={onRemove} title="Remove stage" style={{ width: 24, height: 24, borderRadius: 7,
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-faint)', cursor: 'pointer',
            display: 'grid', placeItems: 'center', padding: 0 }}><Icon name="x" size={12} /></button>}
        </div>
      </div>
      <div style={{ padding: '12px 13px' }}>
        <div style={cardQuestionLabel}>What happens</div>
        <textarea value={stage.desc} onChange={(e) => onEdit('desc', e.target.value)} rows={2}
          aria-label={`What happens in ${stage.name}`} placeholder="Describe the work this step should do." spellCheck={false}
          onFocus={editFocus} onBlur={editBlur}
          style={{ width: '100%', font: 'inherit', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 11,
            minHeight: 38, resize: 'vertical', background: 'transparent', border: '1px solid transparent', borderRadius: 6,
            outline: 'none', padding: '4px', boxSizing: 'border-box' }} />
        <div style={cardQuestionLabel}>Expected result</div>
        <div style={{ minHeight: 30, marginBottom: 12, fontSize: 11.5, lineHeight: 1.45,
          color: stage.expectedOutputs?.length ? 'var(--text-muted)' : 'var(--warn)' }}>
          {stage.expectedOutputs?.[0] || 'Not defined yet'}
        </div>
        <div style={cardQuestionLabel}>Responsible</div>
        {stage.seats?.length
          ? <SeatChips seats={stage.seats} agents={agents} editable={false} />
          : <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>No role assigned yet</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
          {gate && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, color: 'var(--accent)',
            background: tint('var(--accent)', 12), padding: '2px 8px', borderRadius: 4 }}><Icon name={gate.icon} size={11} /> {gate.label}</span>}
          {!gate && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Continues automatically</span>}
          {!stage.fixed && <button onClick={onConfigure} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
            border: 'none', background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: 0 }}>
            <Icon name="edit" size={12} /> Configure</button>}
        </div>
      </div>
    </div>
  );
}
const cardQuestionLabel = { fontSize: 10, fontWeight: 650, letterSpacing: '.05em', textTransform: 'uppercase',
  color: 'var(--text-faint)', marginBottom: 5 };

function DrawerQuestion({ number, title, hint, children }) {
  return <section style={{ marginBottom: 22 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 10 }}>
      <span aria-hidden="true" style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', flexShrink: 0,
        borderRadius: '50%', background: tint('var(--accent)', 13), color: 'var(--accent)', fontSize: 10.5, fontWeight: 750 }}>{number}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        <div style={{ marginTop: 2, fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-muted)' }}>{hint}</div>
      </div>
    </div>
    <div style={{ paddingLeft: 31 }}>{children}</div>
  </section>;
}

/* ---- StageDrawer : the per-stage deep editor (slide-over) ------------------- */
function StageDrawer({ stage, agents, onPatch, onClose }) {
  const setGate = (kind) => {
    if (kind === 'none') return onPatch({ gate: { kind: 'none' } });
    if (kind === 'user_approval') return onPatch({ gate: { kind: 'user_approval' } });
    onPatch({ gate: { kind: 'reviewer_signoff', reviewer: { kind: 'role', role: 'reviewer' }, blockOn: 'open_comments' } });
  };
  const addSeat = (seat) => onPatch({ seats: [...(stage.seats || []), seat] });
  const removeSeat = (i) => onPatch({ seats: stage.seats.filter((_, j) => j !== i) });
  const toggleParallel = () => {
    const next = { ...stage };
    if (stage.parallelGroup) delete next.parallelGroup; else next.parallelGroup = stage.id;
    onPatch(next, true);
  };
  const setExpectedOutputs = (value) => onPatch({ expectedOutputs: value.split('\n').map((line) => line.trim()).filter(Boolean) });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 130, background: alpha('#1b1826', 32), display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="rt-zoom" role="dialog" aria-modal="true" aria-label={`Set up ${stage.name}`}
        style={{ width: 'min(430px, 100%)', height: '100%', background: 'var(--surface)',
        borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 9, background: tint('var(--accent)', 13), color: 'var(--accent)' }}><Icon name={stage.icon} size={16} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Set up “{stage.name}”</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--text-muted)' }}>Define one clear, reviewable step.</div>
          </div>
          <button onClick={onClose} type="button" aria-label="Close step setup" style={{ ...ghostBtn, padding: 6 }}><Icon name="x" size={15} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <DrawerQuestion number="1" title="What happens in this step?"
            hint="Write the instruction the assigned role should follow. Be specific enough to run it again.">
            <label htmlFor={`stage-instructions-${stage.id}`} style={fieldLabel}>Instructions</label>
            <textarea id={`stage-instructions-${stage.id}`} value={stage.desc} onChange={(e) => onPatch({ desc: e.target.value })}
              rows={4} spellCheck={false} placeholder="Example: Review the implementation for accessibility and list any blocking issues."
              style={drawerTextarea} />
          </DrawerQuestion>

          <DrawerQuestion number="2" title="What should this step produce?"
            hint="Describe the result the next step can inspect or use. Add one result per line.">
            <label htmlFor={`stage-output-${stage.id}`} style={fieldLabel}>Expected result</label>
            <textarea id={`stage-output-${stage.id}`} value={(stage.expectedOutputs || []).join('\n')}
              onChange={(e) => setExpectedOutputs(e.target.value)} rows={3} spellCheck={false}
              placeholder="Example: A review report with pass/fail status and actionable findings."
              style={drawerTextarea} />
          </DrawerQuestion>

          <DrawerQuestion number="3" title="Who is responsible?"
            hint="Assign a role or person who has the right capability for this work.">
            <SeatChips seats={stage.seats} agents={agents} editable onRemove={removeSeat} onAdd={addSeat} addLabel="Add role or person" />
            {!stage.seats?.length && <div role="status" style={{ marginTop: 8, padding: '7px 9px', borderRadius: 'var(--r-sm)',
              color: 'var(--warn)', background: alpha('var(--warn)', 9), fontSize: 11.5 }}>No one is assigned. Choose an owner before using this workflow.</div>}
          </DrawerQuestion>

          <DrawerQuestion number="4" title="When can the workflow continue?"
            hint="Choose whether this step flows through automatically or waits for approval.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {GATES.map((g) => {
              const on = (stage.gate?.kind || 'none') === g.kind;
              return (
                <button key={g.kind} type="button" aria-pressed={on} onClick={() => setGate(g.kind)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                  padding: '10px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', font: 'inherit',
                  border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? tint('var(--accent)', 8) : 'var(--surface)' }}>
                  <span style={{ marginTop: 1, display: 'grid', placeItems: 'center', width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`, background: on ? 'var(--accent)' : 'transparent' }}>
                    {on && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}</span>
                  <span><span style={{ fontSize: 13, fontWeight: 500 }}>{g.label}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{g.hint}</span></span>
                </button>
              );
            })}
            </div>
          </DrawerQuestion>

          <details style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 650 }}>Advanced settings</summary>
            <div style={{ marginTop: 14 }}>
              <div style={drawerLabel}>Step icon</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                {ICON_OPTS.map((ic) => (
                  <button key={ic} type="button" onClick={() => onPatch({ icon: ic })} aria-label={`Use ${ic} icon`} aria-pressed={stage.icon === ic}
                    style={{ width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer',
                      border: `1px solid ${stage.icon === ic ? 'var(--accent)' : 'var(--border)'}`,
                      background: stage.icon === ic ? tint('var(--accent)', 12) : 'var(--surface)', color: stage.icon === ic ? 'var(--accent)' : 'var(--text-muted)' }}>
                    <Icon name={ic} size={15} /></button>
                ))}
              </div>
              <Toggle on={!!stage.parallelGroup} onClick={toggleParallel} label="Run assigned roles in parallel" />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
const drawerLabel = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 };
const fieldLabel = { display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 650, color: 'var(--text-muted)' };
const drawerTextarea = { width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', lineHeight: 1.5, resize: 'vertical',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', outline: 'none', padding: '9px 11px', boxSizing: 'border-box' };

function AddStageButton({ onClick }) {
  return (
    <button onClick={onClick} type="button" aria-label="Add a step here" title="Add a step here" style={{ flexShrink: 0, alignSelf: 'center', width: 30, height: 30, borderRadius: '50%',
      border: '1.5px dashed var(--border-strong)', background: 'var(--surface)', color: 'var(--text-faint)', cursor: 'pointer',
      display: 'grid', placeItems: 'center', margin: '0 -7px', zIndex: 2 }}><Icon name="plus" size={14} /></button>
  );
}

function WfRow({ w, active, onPick }) {
  return (
    <button onClick={onPick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 9px', borderRadius: 'var(--r-sm)',
      border: 'none', background: active ? 'var(--surface-2)' : 'transparent', color: 'var(--text)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: tint('var(--accent)', 12), color: 'var(--accent)' }}>
        <Icon name={(w.stages[1] || w.stages[0])?.icon || 'layers'} size={14} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-faint)' }}>{w.stages.length} stages{w.tag ? ` · ${w.tag}` : ''}</span>
      </span>
      {active && <Icon name="check" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
    </button>
  );
}

// Fill the editable client stage up to the full server WorkflowTemplate stage
// shape (the editor only touches name/icon/desc/seats/order/gate/parallel).
function toServerStage(stage) {
  const gate = stage.gate && typeof stage.gate === 'object' ? stage.gate : { kind: 'none' };
  return {
    id: stage.id,
    name: stage.name || 'Stage',
    icon: stage.icon || 'dot',
    kind: stage.kind || 'work',
    desc: stage.desc || '',
    seats: (stage.seats || []).filter((s) => s?.ref?.kind),
    ...(stage.fixed ? { fixed: true } : {}),
    ...(stage.parallelGroup ? { parallelGroup: stage.parallelGroup } : {}),
    gate: {
      kind: gate.kind || 'none',
      required: gate.required ?? gate.kind !== 'none',
      label: gate.label || (GATES.find((g) => g.kind === gate.kind)?.label ?? 'Gate'),
      description: gate.description || (GATES.find((g) => g.kind === gate.kind)?.hint ?? ''),
      actions: Array.isArray(gate.actions) ? gate.actions : [],
    },
    requiredInputs: Array.isArray(stage.requiredInputs) ? stage.requiredInputs : [],
    expectedOutputs: Array.isArray(stage.expectedOutputs) ? stage.expectedOutputs : [],
    requiredCapabilities: Array.isArray(stage.requiredCapabilities) ? stage.requiredCapabilities : [],
  };
}

function toServerTemplate(base, name, stages) {
  return {
    id: base.id,
    name: name.trim() || 'Untitled workflow',
    tag: base.tag ?? null,
    desc: base.desc || '',
    version: base.version || 1,
    planning: base.planning || { cut: 'by_capability', clarifyThreshold: 0.6, maxClarifyQuestions: 3 },
    stages: stages.map(toServerStage),
  };
}

function WorkflowView({ agents, onOpenTemplates, serverTemplates, onSaveTemplate, onDeleteTemplate, onRefreshTemplates, workflowTransfer, workflowHistory }) {
  // Server mode: the editor reads/writes the SAME templates the orchestrator
  // plans from — edits change what actually runs. localStorage mode remains
  // for the logged-out demo scene only.
  const serverMode = Array.isArray(serverTemplates) && serverTemplates.length > 0;
  const allWf = () => (serverMode ? serverTemplates : RT.BUILTIN_WORKFLOWS.concat(RT.workflows || []));
  const [wfId, setWfId] = useStateW(serverMode ? serverTemplates[0].id : RT.WORKBENCH.workflowId);
  const [picker, setPicker] = useStateW(false);
  const base = allWf().find((w) => w.id === wfId) || allWf()[0];
  const [wfName, setWfName] = useStateW(base.name);
  const [stages, setStages] = useStateW(() => clone(base.stages));
  const [drawer, setDrawer] = useStateW(null);
  const [saved, setSaved] = useStateW(false);
  const [saving, setSaving] = useStateW(false);
  const [saveError, setSaveError] = useStateW(null);
  const [pendingServerWorkflowId, setPendingServerWorkflowId] = useStateW(null);
  const [editSession, setEditSession] = useStateW(() => workflowEditSessionSnapshot(base));
  const editSessionController = React.useRef(null);
  if (!editSessionController.current) editSessionController.current = createWorkflowEditSession(base, setEditSession);
  const saveController = React.useRef(null);
  if (!saveController.current) saveController.current = createWorkflowSaveController();
  const persist = () => { try { localStorage.setItem('rt.workflows', JSON.stringify(RT.workflows)); } catch { /* ignore */ } };
  const switchWorkflow = (id) => {
    const w = allWf().find((x) => x.id === id) || base;
    setWfId(id); if (!serverMode) RT.WORKBENCH.workflowId = id;
    setWfName(w.name); setStages(clone(w.stages)); setDrawer(null); setPicker(false);
    editSessionController.current.load(w);
  };
  const newWorkflow = async () => {
    const wf = serverMode ? createServerWorkflowDraft() : { id: 'wf-user-' + Date.now(), name: 'Untitled workflow', tag: 'Yours', builtin: false, origin: { kind: 'new' },
      planning: { cut: 'by_role', clarifyThreshold: 0.6, maxClarifyQuestions: 3 }, version: 1, updatedAt: new Date().toISOString(),
      stages: [
        { id: 'intake', name: 'Intake', icon: 'clip', kind: 'intake', desc: 'Capture the goal, constraints, and definition of done.',
          expectedOutputs: ['A clear brief ready for planning.'], seats: [{ ref: { kind: 'user' } }], fixed: true, gate: { kind: 'none' } },
        { id: 's-build-' + Date.now(), name: 'Build', icon: 'code', kind: 'work', desc: 'Create the requested deliverable from the approved brief.',
          expectedOutputs: ['A working deliverable ready for review.'], seats: [], gate: { kind: 'none' } },
        { id: 's-ship-' + Date.now(), name: 'Ship', icon: 'rocket', kind: 'ship', desc: 'Prepare the reviewed result for delivery.',
          expectedOutputs: ['An approved delivery package.'], seats: [], gate: { kind: 'user_approval' } },
      ] };
    const id = wf.id;
    if (serverMode) {
      if (!onSaveTemplate || saveController.current.inFlight) return;
      setSaving(true); setSaveError(null);
      try {
        await saveController.current.run({
          payload: { template: wf, expectedRevision: 0 },
          save: onSaveTemplate,
          onSaved: (result) => {
            const revision = result?.revision;
            const loaded = revision?.id
              ? { ...clone(revision.template), expectedRevision: revision.revision, workflowRevisionId: revision.id }
              : wf;
            setPendingServerWorkflowId(id);
            setWfId(id); setWfName(loaded.name); setStages(clone(loaded.stages)); setDrawer(null); setPicker(false);
            editSessionController.current.load(loaded);
            setSaved(true); setTimeout(() => setSaved(false), 2600);
          },
          onConflict: onRefreshTemplates,
          onError: setSaveError,
        });
      } finally {
        setSaving(false);
      }
      return;
    }
    RT.workflows = [...(RT.workflows || []), wf]; persist(); switchWorkflow(id);
  };
  useEffectW(() => {
    if (serverMode) return;
    try { const raw = localStorage.getItem('rt.workflows'); if (raw) RT.workflows = JSON.parse(raw); } catch { /* ignore */ }
  }, [serverMode]);
  // Server templates load async: when they arrive and the selected id is a
  // client-only workflow, snap the editor onto the first real template.
  useEffectW(() => {
    if (!serverMode) return;
    const remote = serverTemplates.find((w) => w.id === wfId);
    if (remote) {
      editSessionController.current.observeRemote(remote);
      if (pendingServerWorkflowId === wfId) setPendingServerWorkflowId(null);
      return;
    }
    if (pendingServerWorkflowId === wfId) return;
    const first = serverTemplates[0];
    setWfId(first.id); setWfName(first.name); setStages(clone(first.stages)); setDrawer(null);
    editSessionController.current.load(first);
  }, [serverMode, serverTemplates, wfId, pendingServerWorkflowId]);

  const patchStage = (i, patch, replace) => {
    editSessionController.current.markDirty();
    setStages((ss) => ss.map((s, j) => (j === i ? (replace ? patch : { ...s, ...patch }) : s)));
  };
  const editStage = (i, field, val) => patchStage(i, { [field]: val });
  const moveStage = (i, dir) => {
    editSessionController.current.markDirty();
    setStages((ss) => {
      const j = i + dir; if (j < 0 || j >= ss.length) return ss;
      const n = [...ss]; const [m] = n.splice(i, 1); n.splice(j, 0, m); return n;
    });
  };
  const removeStage = (i) => {
    editSessionController.current.markDirty();
    setStages((ss) => ss.filter((_, j) => j !== i));
  };
  const addStage = (i) => {
    editSessionController.current.markDirty();
    setStages((ss) => {
      const n = [...ss];
      n.splice(i, 0, { id: 'custom-' + Date.now(), name: 'New step', icon: 'dot', kind: 'work', desc: '', expectedOutputs: [], seats: [], gate: { kind: 'none' } });
      return n;
    });
    setDrawer(i);
  };

  const loadRemoteRevision = () => {
    const remote = editSession.remoteWorkflow;
    if (!remote) return;
    if (editSession.dirty && !window.confirm('Load the latest revision? Your unsaved workflow edits will be replaced.')) return;
    setWfName(remote.name); setStages(clone(remote.stages)); setDrawer(null); setSaveError(null);
    editSessionController.current.load(remote);
  };

  const saveWorkflow = async () => {
    if (serverMode) {
      // Same-id save = override: editing a builtin (reorder stages, change
      // seats) changes what the orchestrator runs for every future mission
      // that resolves this template — including keyword auto-select.
      if (!onSaveTemplate || saveController.current.inFlight) return;
      setSaving(true); setSaveError(null);
      try {
        const pinned = editSessionController.current.state;
        await saveController.current.run({
          payload: {
            template: toServerTemplate(pinned.loadedWorkflow, wfName, stages),
            expectedRevision: pinned.expectedRevision,
          },
          save: onSaveTemplate,
          onSaved: (result) => {
            editSessionController.current.commitSaved(result);
            setSaved(true); setTimeout(() => setSaved(false), 2600);
          },
          onConflict: onRefreshTemplates,
          onError: setSaveError,
        });
      } finally {
        setSaving(false);
      }
      return;
    }
    const isUser = !base.builtin;
    const id = isUser ? base.id : 'wf-user-' + Date.now();
    const wf = { ...clone(base), id, name: wfName.trim() || 'Untitled workflow', tag: 'Yours', builtin: false,
      origin: isUser ? base.origin : { kind: 'fork', from: base.id }, version: (base.version || 1) + 1,
      updatedAt: new Date().toISOString(), stages: clone(stages) };
    RT.workflows = [...(RT.workflows || []).filter((w) => w.id !== id), wf];
    RT.WORKBENCH.workflowId = id; setWfId(id); persist();
    editSessionController.current.load(wf);
    setSaved(true); setTimeout(() => setSaved(false), 2600);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 60px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h2 style={{ margin: '0 0 5px', fontSize: 21, fontWeight: 600, letterSpacing: '-.01em' }}>Workflow</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 620 }}>
              A workflow is a <b>repeatable recipe for your AI team</b>. It runs from left to right, one clear step at a time.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button onClick={newWorkflow} disabled={saving} type="button" style={{ ...ghostBtn, background: 'var(--accent)', color: '#fff',
              border: 'none', fontWeight: 700, opacity: saving ? 0.65 : 1 }}>
              <Icon name="plus" size={14} /> New workflow
            </button>
            <button onClick={onOpenTemplates} type="button" style={ghostBtn}><Icon name="layers" size={14} /> Start from template</button>
            <WorkflowTransfer
              revisionId={editSession.loadedWorkflow?.builtin ? null : editSession.loadedRevisionId}
              handlers={workflowTransfer}
              onImported={onRefreshTemplates}
            />
            <a href="/agents" style={{ ...ghostBtn, textDecoration: 'none' }}><Icon name="code" size={14} /> Agent CLIs</a>
            <button onClick={saveWorkflow} disabled={saving} style={{ ...ghostBtn, background: saved ? 'var(--ok)' : 'var(--surface)',
              color: saved ? '#fff' : 'var(--text)', border: saved ? 'none' : '1px solid var(--border)', fontWeight: 650, opacity: saving ? 0.65 : 1 }}>
              <Icon name="check" size={14} /> {saving ? 'Saving…' : saved ? 'Saved' : base.builtin && !serverMode ? 'Save as my workflow' : 'Save changes'}</button>
          </div>
        </div>

        <div role="note" aria-label="How workflows work" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 1, margin: '14px 0', overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', background: 'var(--border)' }}>
          <div style={{ padding: '11px 13px', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Each card is one step</div>
            <div style={{ marginTop: 3, fontSize: 11.5, lineHeight: 1.4, color: 'var(--text-muted)' }}>Keep it small enough for one owner and one reviewable result.</div>
          </div>
          {[
            ['1', 'What happens?', 'Give the role a clear instruction.'],
            ['2', 'What should it produce?', 'Define the result the next step receives.'],
            ['3', 'Who is responsible?', 'Assign the right role or person.'],
          ].map(([number, title, hint]) => <div key={number} style={{ display: 'flex', gap: 8, padding: '11px 12px', background: 'var(--surface)' }}>
            <span style={{ width: 20, height: 20, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '50%',
              background: tint('var(--accent)', 13), color: 'var(--accent)', fontSize: 10, fontWeight: 750 }}>{number}</span>
            <div><div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
              <div style={{ marginTop: 2, fontSize: 10.5, lineHeight: 1.35, color: 'var(--text-muted)' }}>{hint}</div></div>
          </div>)}
        </div>

        {saveError && <div role="alert" style={{ marginTop: 10, color: 'var(--bad)', fontSize: 12.5 }}>{saveError}</div>}
        {editSession.remoteChanged && (
          <div role="status" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '9px 11px', borderRadius: 'var(--r-sm)', color: 'var(--warn)', background: alpha('var(--warn)', 10), fontSize: 12.5 }}>
            <Icon name="replay" size={13} />
            <span style={{ flex: 1, minWidth: 220 }}>
              Revision {editSession.remoteExpectedRevision} is available. This editor remains pinned to Revision {editSession.expectedRevision}
              {editSession.dirty ? ' with unsaved edits.' : '.'}
            </span>
            <button type="button" onClick={loadRemoteRevision} style={{ ...ghostBtn, padding: '5px 9px', color: 'var(--warn)' }}>Load latest</button>
          </div>
        )}
        <div style={{ position: 'relative', margin: '14px 0 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px 9px 14px',
            borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            <input value={wfName} onChange={(e) => { editSessionController.current.markDirty(); setWfName(e.target.value); }} title="Rename this workflow" spellCheck={false}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'transparent')}
              style={{ font: 'inherit', fontSize: 13.5, fontWeight: 600, color: 'var(--text)', background: 'transparent', border: '1px solid transparent',
                borderRadius: 6, outline: 'none', padding: '2px 6px', margin: '-2px 0', minWidth: 90, maxWidth: 260 }} />
            {base.tag && <span style={{ fontSize: 10.5, color: 'var(--accent)', background: tint('var(--accent)', 12), padding: '1px 7px', borderRadius: 4 }}>{base.tag}</span>}
            <button onClick={() => setPicker((o) => !o)} type="button" aria-expanded={picker} title="Switch workflow"
              style={{ ...ghostBtn, padding: '5px 10px', gap: 5 }}>
              <Icon name="chevdown" size={12} /> Switch workflow</button>
            <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>This is the active recipe for your next Mission.</span>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--run)' }} /> running now at the table</span>
          </div>
          {picker && (
            <div className="rt-zoom" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 6, width: 340,
              background: 'var(--surface)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden', padding: 4 }}>
              {serverMode ? (
                <>
                  <div style={menuLabel}>Workflows · what missions actually run</div>
                  {serverTemplates.map((w) => (
                    <WfRow key={w.id} w={w} active={w.id === wfId} onPick={() => switchWorkflow(w.id)} />
                  ))}
                  {serverTemplates.some((w) => !w.builtin) && onDeleteTemplate && (
                    <button
                      onClick={() => { onDeleteTemplate(wfId); setPicker(false); }}
                      title="Remove your edits — a built-in id falls back to its default definition"
                      style={{ ...menuRow, borderTop: '1px solid var(--border)', marginTop: 2, color: 'var(--bad)', fontWeight: 500 }}>
                      <Icon name="x" size={14} /> Reset current to default
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={menuLabel}>Built-in</div>
                  {RT.BUILTIN_WORKFLOWS.map((w) => <WfRow key={w.id} w={w} active={w.id === wfId} onPick={() => switchWorkflow(w.id)} />)}
                  {(RT.workflows || []).length > 0 && <div style={menuLabel}>Your workflows</div>}
                  {(RT.workflows || []).map((w) => <WfRow key={w.id} w={w} active={w.id === wfId} onPick={() => switchWorkflow(w.id)} />)}
                </>
              )}
              <button onClick={newWorkflow} disabled={saving} style={{ ...menuRow, borderTop: '1px solid var(--border)', marginTop: 2, color: 'var(--accent)', fontWeight: 500 }}>
                <Icon name="plus" size={14} /> New workflow</button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', paddingBottom: 18 }}>
          {stages.map((s, i) => (
            <React.Fragment key={s.id}>
              {i > 0 && <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ width: 26, height: 2, background: 'var(--border-strong)' }} />
                <AddStageButton onClick={() => addStage(i)} />
                <div style={{ width: 26, height: 2, background: 'var(--border-strong)' }} />
                <Icon name="chevron" size={15} style={{ color: 'var(--text-faint)', marginLeft: -6 }} />
              </div>}
              <StageCard stage={s} idx={i} agents={agents}
                onEdit={(field, val) => editStage(i, field, val)} onMove={(dir) => moveStage(i, dir)}
                onRemove={() => removeStage(i)} onConfigure={() => setDrawer(i)}
                canLeft={i > 0} canRight={i < stages.length - 1} />
            </React.Fragment>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ width: 32, height: 2, background: 'var(--border-strong)' }} />
            <button type="button" onClick={() => addStage(stages.length)} style={{ ...ghostBtn, flexShrink: 0, marginLeft: 8,
              padding: '8px 12px', color: 'var(--accent)', borderStyle: 'dashed', fontWeight: 700 }}>
              <Icon name="plus" size={13} /> Add step
            </button>
          </div>
        </div>

        <WorkflowHistory
          workflowId={editSession.workflowId}
          revisionId={editSession.loadedRevisionId}
          enabled={serverMode && !editSession.loadedWorkflow?.builtin && Boolean(workflowHistory)}
          handlers={workflowHistory}
        />

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="sparkle" size={13} />
          {serverMode
            ? 'Saving updates the real orchestrator template: stage order and seats here ARE the task chain your next mission runs.'
            : 'Every task this workbench runs follows these stages — change them once, and the whole team adapts.'}
        </div>
      </div>
      {drawer != null && stages[drawer] && (
        <StageDrawer stage={stages[drawer]} agents={agents}
          onPatch={(patch, replace) => patchStage(drawer, patch, replace)} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}

export { WorkflowView };

/* ---- WorkflowStrip : live progress, shown on the Roundtable page ----------
   Still reads the legacy scripted clock until run-state binding (spec 090 §9.4). */
function currentStageIndex(clock) {
  if (clock < 700) return 0;
  if (clock < 3600) return 1;
  if (clock < 18000) return 2;
  if (clock < 22400) return 3;
  return 4;
}
// Map a live workflowRun onto per-stage {done,active} flags so the strip can
// render real progress. Returns null when no run is bound (caller falls back to
// the scripted clock for the logged-out demo).
function liveStageFlags(workflow, workflowRun) {
  if (!workflow || !workflowRun) return null;
  return workflow.stages.map((s) => {
    const status = workflowRun.stageStates?.[s.id]?.status || 'pending';
    return {
      done: status === 'done' || status === 'completed',
      active: !s.fixed && (workflowRun.activeStageId === s.id || status === 'active' || status === 'running'),
      visible: s.kind !== 'repair' || status !== 'pending',
    };
  });
}

function WorkflowStrip({ clock, onOpen, workflow, workflowRun }) {
  const live = liveStageFlags(workflow, workflowRun);
  const wf = live ? workflow : activeWorkflow();
  const stages = wf.stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage, index }) => !live || live[index]?.visible || stage.kind !== 'repair');
  const cur = currentStageIndex(clock);
  return (
    <div className="rt-workflow-strip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%',
      padding: '6px 8px 6px 12px', borderRadius: 999, overflow: 'hidden',
      background: 'color-mix(in oklab, var(--surface) 88%, transparent)', backdropFilter: 'blur(8px)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)', flexShrink: 0 }}>Workflow</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', flexShrink: 0, marginRight: 4,
        maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }} title={wf.name}>{wf.name}</span>
      {stages.map(({ stage: s, index }, i) => {
        const done = live ? live[index].done : index < cur;
        const active = live ? live[index].active : index === cur;
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <span className="rt-workflow-connector" style={{ width: 12, height: 1.5, flexShrink: 0,
              background: done || active ? 'var(--accent)' : 'var(--border-strong)' }} />}
            <span className={`rt-workflow-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`} title={s.desc}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, padding: '4px 9px', borderRadius: 999,
              background: active ? 'var(--accent)' : done ? tint('var(--accent)', 14) : 'transparent',
              color: active ? '#fff' : done ? 'var(--accent)' : 'var(--text-faint)', fontSize: 11.5, fontWeight: active ? 600 : 500 }}>
              {done ? <Icon name="check" size={12} /> : <Icon name={s.icon} size={12} />}
              {(active || done) && <span className="rt-workflow-label">{s.name}</span>}
            </span>
          </React.Fragment>
        );
      })}
      <button onClick={onOpen} title="Open workflow" style={{ marginLeft: 4, display: 'grid', placeItems: 'center', width: 24, height: 24,
        flexShrink: 0, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <Icon name="expand" size={12} />
      </button>
    </div>
  );
}

export { WorkflowStrip, currentStageIndex };
