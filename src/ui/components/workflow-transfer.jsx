import React from 'react';
import { createWorkflowTransferController } from '../lib/workflow-transfer-controller';
import { Icon, alpha } from './primitives';

const { useRef, useState } = React;

const buttonStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit',
  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};

function WorkflowTransfer({ revisionId, handlers, onImported }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => ({ phase: 'idle', preview: null, error: null }));
  const inputRef = useRef(null);
  const controllerRef = useRef(null);
  if (!controllerRef.current) controllerRef.current = createWorkflowTransferController(setState);
  if (!handlers?.previewImport || !handlers?.importDocument) return null;

  const chooseFile = () => inputRef.current?.click();
  const inspectFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setOpen(true);
    await controllerRef.current.previewFile({ file, previewImport: handlers.previewImport });
  };
  const confirmImport = () => controllerRef.current.confirmImport({
    importDocument: handlers.importDocument,
    onImported,
  });
  const close = () => {
    controllerRef.current.reset();
    setOpen(false);
  };
  const exportCurrent = async () => {
    const result = await controllerRef.current.exportRevision({
      revisionId,
      exportRevision: handlers.exportRevision,
    });
    if (!result.ok) return;
    downloadWorkflowDocument(result.value);
  };

  const blocked = Boolean(state.preview && (!state.preview.canImport || state.preview.blocking.length > 0));
  const busy = state.phase === 'previewing' || state.phase === 'importing' || state.phase === 'exporting';
  return (
    <>
      <input ref={inputRef} type="file" accept=".roundtable.json,.json,application/json" onChange={inspectFile} hidden />
      <button type="button" onClick={chooseFile} style={buttonStyle}>
        <Icon name="clip" size={14} /> Import
      </button>
      {handlers.exportRevision && (
        <button type="button" onClick={exportCurrent} disabled={!revisionId || busy}
          title={revisionId ? 'Export this immutable workflow revision' : 'Save this workflow before exporting it'}
          style={{ ...buttonStyle, opacity: !revisionId || busy ? 0.5 : 1, cursor: !revisionId || busy ? 'default' : 'pointer' }}>
          <Icon name="door" size={14} /> {state.phase === 'exporting' ? 'Exporting…' : 'Export'}
        </button>
      )}
      {!open && state.error && <span role="alert" style={{ color: 'var(--bad)', fontSize: 12 }}>{state.error}</span>}
      {open && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 145, display: 'grid', placeItems: 'center',
          padding: 20, background: alpha('#1b1826', 38) }}>
          <section role="dialog" aria-modal="true" aria-label="Import workflow" onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(620px, 100%)', maxHeight: 'min(720px, 90vh)', overflowY: 'auto', borderRadius: 'var(--r-card)',
              border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-pop)' }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 17px', borderBottom: '1px solid var(--border)' }}>
              <Icon name="clip" size={16} style={{ color: 'var(--accent)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Import workflow</div>
                <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-faint)' }}>Review compatibility before adding it to your gallery.</div>
              </div>
              <button type="button" onClick={close} aria-label="Close import preview" style={{ ...buttonStyle, padding: 6 }}>
                <Icon name="x" size={14} />
              </button>
            </header>
            <div style={{ padding: 17, display: 'grid', gap: 14 }}>
              {state.phase === 'previewing' && <div role="status" style={{ color: 'var(--text-muted)', fontSize: 13 }}>Checking workflow compatibility…</div>}
              {state.error && <div role="alert" style={{ padding: '9px 11px', borderRadius: 'var(--r-sm)',
                color: 'var(--bad)', background: alpha('var(--bad)', 10), fontSize: 12.5 }}>{state.error}</div>}
              {state.preview && <WorkflowImportPreview preview={state.preview} fileName={state.fileName} />}
              {state.phase === 'imported' && <div role="status" style={{ padding: '9px 11px', borderRadius: 'var(--r-sm)',
                color: 'var(--ok)', background: alpha('var(--ok)', 10), fontSize: 12.5 }}>
                Imported to your workflow gallery. Your current unsaved edits were left untouched.
              </div>}
            </div>
            <footer style={{ display: 'flex', justifyContent: 'space-between', gap: 9, padding: '13px 17px',
              borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <button type="button" onClick={chooseFile} disabled={busy} style={buttonStyle}>Choose another file</button>
              <div style={{ display: 'flex', gap: 9 }}>
                <button type="button" onClick={close} style={buttonStyle}>{state.phase === 'imported' ? 'Done' : 'Cancel'}</button>
                {state.phase !== 'imported' && (
                  <button type="button" onClick={confirmImport} disabled={!state.preview || blocked || busy}
                    style={{ ...buttonStyle, border: 'none', background: 'var(--accent)', color: '#fff',
                      opacity: !state.preview || blocked || busy ? 0.5 : 1,
                      cursor: !state.preview || blocked || busy ? 'default' : 'pointer' }}>
                    {state.phase === 'importing' ? 'Importing…' : blocked ? 'Resolve blockers first' : 'Import workflow'}
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function WorkflowImportPreview({ preview, fileName }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 9 }}>
        <Meta label="Name" value={preview.name} />
        <Meta label="Version" value={preview.version} />
        <Meta label="Content hash" value={preview.hash} mono />
      </div>
      <div className="mono" title={fileName} style={{ fontSize: 10.5, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fileName}</div>
      {!preview.canRun && preview.canImport && (
        <div style={{ padding: '8px 10px', borderRadius: 'var(--r-sm)', color: 'var(--warn)', background: alpha('var(--warn)', 10), fontSize: 12.5 }}>
          This workflow can be imported, but it cannot run in the current environment until unavailable requirements are resolved.
        </div>
      )}
      <IssueList title="Blocking issues" issues={preview.blocking} color="var(--bad)" empty="No blockers found." />
      <IssueList title="Warnings" issues={preview.warnings} color="var(--warn)" empty="No compatibility warnings." />
    </>
  );
}

function Meta({ label, value, mono }) {
  return <div style={{ padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', minWidth: 0 }}>
    <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginBottom: 4 }}>{label}</div>
    <div className={mono ? 'mono' : undefined} title={String(value)} style={{ fontSize: 12.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
  </div>;
}

function IssueList({ title, issues, color, empty }) {
  return <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
    <div style={{ padding: '8px 10px', background: 'var(--surface-2)', color, fontSize: 12, fontWeight: 700 }}>{title} · {issues.length}</div>
    <div style={{ padding: '8px 10px', display: 'grid', gap: 6 }}>
      {issues.length === 0
        ? <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{empty}</span>
        : issues.map((issue, index) => <div key={`${issue}-${index}`} style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>• {issue}</div>)}
    </div>
  </div>;
}

function downloadWorkflowDocument({ document, fileName }) {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export { WorkflowTransfer };
