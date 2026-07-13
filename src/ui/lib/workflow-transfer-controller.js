const INITIAL_STATE = Object.freeze({
  phase: 'idle',
  fileName: null,
  document: null,
  preview: null,
  error: null,
  imported: null,
});

export const MAX_WORKFLOW_FILE_BYTES = 1_000_000;

/**
 * @typedef {{ name: string, version: string, hash: string, contentHash: string | null, canImport: boolean, canRun: boolean, blocking: string[], warnings: string[] }} WorkflowTransferPreview
 * @typedef {{ phase: string, fileName: string | null, document: unknown, preview: WorkflowTransferPreview | null, error: string | null, imported: unknown }} WorkflowTransferState
 * @typedef {{ name: string, size?: number, text: () => Promise<string> }} WorkflowFile
 */

/** @param {(state: WorkflowTransferState) => void} [onStateChange] */
export function createWorkflowTransferController(onStateChange = () => {}) {
  /** @type {WorkflowTransferState} */
  let state = { ...INITIAL_STATE };
  let requestGeneration = 0;

  /** @param {Partial<WorkflowTransferState>} patch */
  const publish = (patch) => {
    state = { ...state, ...patch };
    onStateChange(state);
    return state;
  };

  const reset = () => {
    requestGeneration += 1;
    publish({ ...INITIAL_STATE });
  };

  /** @param {{ file: WorkflowFile, previewImport: (input: { document: unknown }) => Promise<unknown> }} input */
  const previewFile = async ({ file, previewImport }) => {
    const generation = ++requestGeneration;
    if (!isWorkflowFileName(file?.name)) {
      publish({ ...INITIAL_STATE, error: 'Choose a .roundtable.json or .json workflow file.' });
      return { ok: false, code: 'INVALID_FILE_TYPE' };
    }
    if (Number.isFinite(file.size) && file.size > MAX_WORKFLOW_FILE_BYTES) {
      publish({ ...INITIAL_STATE, error: 'This workflow file is larger than the 1 MB import limit.' });
      return { ok: false, code: 'FILE_TOO_LARGE' };
    }

    publish({
      phase: 'previewing',
      fileName: file.name,
      document: null,
      preview: null,
      error: null,
      imported: null,
    });

    try {
      const text = await file.text();
      const document = JSON.parse(text);
      const value = await previewImport({ document });
      if (generation !== requestGeneration) return { ok: false, code: 'STALE' };
      const preview = normalizeWorkflowPreview(value);
      publish({ phase: 'ready', document, preview, error: null });
      return { ok: true, value: preview };
    } catch (error) {
      if (generation !== requestGeneration) return { ok: false, code: 'STALE' };
      const message = error instanceof SyntaxError
        ? 'This file is not valid JSON.'
        : errorMessage(error, 'Could not inspect this workflow file.');
      publish({ phase: 'error', document: null, preview: null, error: message });
      return { ok: false, code: 'ERROR' };
    }
  };

  /** @param {{ importDocument: (input: { document: unknown, confirmedContentHash: string }) => Promise<unknown>, onImported?: (value: unknown) => void | Promise<void> }} input */
  const confirmImport = async ({ importDocument, onImported }) => {
    if (state.phase === 'importing') return { ok: false, code: 'IN_FLIGHT' };
    if (!state.document || !state.preview) return { ok: false, code: 'NO_PREVIEW' };
    if (!state.preview.canImport || state.preview.blocking.length > 0 || !state.preview.contentHash) {
      return { ok: false, code: 'BLOCKED' };
    }

    const generation = requestGeneration;
    publish({ phase: 'importing', error: null });
    try {
      const value = await importDocument({
        document: state.document,
        confirmedContentHash: state.preview.contentHash,
      });
      if (generation !== requestGeneration) return { ok: false, code: 'STALE' };
      publish({ phase: 'imported', imported: value, error: null });
      await onImported?.(value);
      return { ok: true, value };
    } catch (error) {
      if (generation !== requestGeneration) return { ok: false, code: 'STALE' };
      publish({ phase: 'ready', error: errorMessage(error, 'Could not import this workflow.') });
      return { ok: false, code: 'ERROR' };
    }
  };

  /** @param {{ revisionId: string | null | undefined, exportRevision: (input: { revisionId: string }) => Promise<*> }} input */
  const exportRevision = async ({ revisionId, exportRevision: runExport }) => {
    if (!revisionId) return { ok: false, code: 'NO_REVISION' };
    if (state.phase === 'exporting') return { ok: false, code: 'IN_FLIGHT' };
    publish({ phase: 'exporting', error: null, imported: null });
    try {
      const response = await runExport({ revisionId });
      const document = response?.document ?? response?.file;
      if (document == null) throw new Error('workflow_export_missing_document');
      const value = {
        document,
        fileName: safeWorkflowFileName(response?.fileName),
      };
      publish({ phase: state.preview ? 'ready' : 'idle', error: null });
      return { ok: true, value };
    } catch (error) {
      publish({ phase: state.preview ? 'ready' : 'idle', error: errorMessage(error, 'Could not export this workflow.') });
      return { ok: false, code: 'ERROR' };
    }
  };

  return {
    get state() { return state; },
    reset,
    previewFile,
    confirmImport,
    exportRevision,
  };
}

/** @param {*} value @returns {WorkflowTransferPreview} */
export function normalizeWorkflowPreview(value) {
  const compatibility = value?.compatibility ?? value ?? {};
  const provenance = value?.provenance ?? value?.document?.provenance ?? {};
  const workflow = value?.workflow ?? value?.document?.workflow ?? {};
  const checks = Array.isArray(value?.checks) ? value.checks : [];
  const blockingChecks = checks.filter((check) => check?.status === 'blocking');
  const warningChecks = checks.filter((check) => check?.status === 'warning' || check?.status === 'unavailable');
  const contentHash = value?.contentHash ?? value?.hash ?? provenance.contentHash ?? null;
  return {
    name: String(value?.name ?? workflow.name ?? 'Untitled workflow'),
    version: String(value?.version ?? provenance.revision ?? workflow.version ?? '—'),
    hash: String(contentHash ?? '—'),
    contentHash: contentHash == null ? null : String(contentHash),
    canImport: value?.canImport ?? blockingChecks.length === 0,
    canRun: value?.canRun ?? !checks.some((check) => check?.status === 'blocking' || check?.status === 'unavailable'),
    blocking: normalizeIssues(blockingChecks.length ? blockingChecks : (compatibility.blocking ?? value?.blocking)),
    warnings: normalizeIssues(warningChecks.length ? warningChecks : (compatibility.warnings ?? value?.warnings)),
  };
}

/** @param {unknown} input */
export function safeWorkflowFileName(input) {
  const basename = String(input || 'workflow.roundtable.json').split(/[\\/]/).pop();
  const cleaned = basename
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 160) || 'workflow';
  if (cleaned.toLowerCase().endsWith('.roundtable.json')) return cleaned;
  return `${cleaned.replace(/\.json$/i, '')}.roundtable.json`;
}

/** @param {unknown} name */
export function isWorkflowFileName(name) {
  return /(?:\.roundtable)?\.json$/i.test(String(name || ''));
}

/** @param {unknown} value */
function normalizeIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.map((issue) => {
    if (typeof issue === 'string') return issue;
    return String(issue?.message ?? issue?.label ?? issue?.code ?? 'Compatibility issue');
  });
}

/** @param {unknown} error @param {string} fallback */
function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}
