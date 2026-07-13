export const WORKFLOW_CONFLICT_MESSAGE = 'A newer workflow revision exists. Your edits are still here; load the latest revision before saving again.';

/**
 * Pin an editor to the exact immutable revision it loaded. Query refetches may
 * reveal a newer remote revision, but they never advance this session's CAS or
 * export target until the user explicitly loads it.
 * @param {*} workflow
 * @param {((state: ReturnType<typeof workflowEditSessionSnapshot>) => void)=} onChange
 */
export function createWorkflowEditSession(workflow, onChange = () => {}) {
  let state = workflowEditSessionSnapshot(workflow);
  const publish = (next) => {
    state = next;
    onChange(state);
    return state;
  };
  const load = (nextWorkflow) => publish(workflowEditSessionSnapshot(nextWorkflow));
  const markDirty = () => state.dirty ? state : publish({ ...state, dirty: true });
  const observeRemote = (remoteWorkflow) => {
    if (!remoteWorkflow || remoteWorkflow.id !== state.workflowId) return state;
    const remote = revisionIdentity(remoteWorkflow);
    const changed = remote.expectedRevision > state.expectedRevision
      || (remote.expectedRevision === state.expectedRevision && remote.loadedRevisionId !== state.loadedRevisionId);
    if (
      changed === state.remoteChanged
      && remote.expectedRevision === state.remoteExpectedRevision
      && remote.loadedRevisionId === state.remoteRevisionId
    ) return state;
    return publish({
      ...state,
      remoteChanged: changed,
      remoteExpectedRevision: changed ? remote.expectedRevision : null,
      remoteRevisionId: changed ? remote.loadedRevisionId : null,
      remoteWorkflow: changed ? cloneWorkflow(remoteWorkflow) : null,
    });
  };
  const commitSaved = (result) => {
    const revision = result?.revision;
    if (!revision?.id || !Number.isInteger(revision.revision)) return state;
    const loadedWorkflow = {
      ...cloneWorkflow(revision.template ?? state.loadedWorkflow),
      expectedRevision: revision.revision,
      workflowRevisionId: revision.id,
    };
    return load(loadedWorkflow);
  };
  return {
    get state() { return state; },
    load,
    markDirty,
    observeRemote,
    commitSaved,
  };
}

/** @param {*} workflow */
export function workflowEditSessionSnapshot(workflow) {
  const identity = revisionIdentity(workflow);
  return {
    workflowId: workflow?.id ?? null,
    loadedWorkflow: cloneWorkflow(workflow),
    loadedRevisionId: identity.loadedRevisionId,
    expectedRevision: identity.expectedRevision,
    dirty: false,
    remoteChanged: false,
    remoteExpectedRevision: null,
    remoteRevisionId: null,
    remoteWorkflow: null,
  };
}

function revisionIdentity(workflow) {
  return {
    loadedRevisionId: typeof workflow?.workflowRevisionId === 'string' ? workflow.workflowRevisionId : null,
    expectedRevision: Number.isInteger(workflow?.expectedRevision) ? workflow.expectedRevision : 0,
  };
}

function cloneWorkflow(workflow) {
  if (workflow == null) return workflow;
  return JSON.parse(JSON.stringify(workflow));
}

/**
 * @typedef {Object} WorkflowSaveArgs
 * @property {*} payload
 * @property {(payload: *) => Promise<*>} save
 * @property {((value: *) => void)=} onSaved
 * @property {(() => void | Promise<void>)=} onConflict
 * @property {((message: string) => void)=} onError
 */

export function createWorkflowSaveController() {
  let inFlight = false;
  return {
    get inFlight() { return inFlight; },
    /** @param {WorkflowSaveArgs} args */
    async run(args) {
      const { payload, save, onSaved, onConflict, onError } = args;
      if (inFlight) return { ok: false, code: 'IN_FLIGHT' };
      inFlight = true;
      try {
        const value = await save(payload);
        onSaved?.(value);
        return { ok: true, value };
      } catch (error) {
        if (isWorkflowConflict(error)) {
          try {
            await onConflict?.();
          } catch {
            onError?.('This workflow changed elsewhere, but the latest version could not be refreshed. Your edits are still here.');
            return { ok: false, code: 'ERROR' };
          }
          onError?.(WORKFLOW_CONFLICT_MESSAGE);
          return { ok: false, code: 'CONFLICT' };
        }
        onError?.(error instanceof Error ? error.message : 'Could not save this workflow.');
        return { ok: false, code: 'ERROR' };
      } finally {
        inFlight = false;
      }
    },
  };
}

export function isWorkflowConflict(error) {
  return error?.data?.code === 'CONFLICT'
    || error?.shape?.data?.code === 'CONFLICT'
    || error?.message === 'workflow_revision_conflict';
}

/** @returns {import('../../server/types').WorkflowTemplate} */
export function createServerWorkflowDraft(timestamp = Date.now()) {
  const id = `wf-user-${timestamp}`;
  const gate = (kind, label, description, actions = []) => ({
    kind,
    required: kind !== 'none',
    label,
    description,
    actions,
  });
  return {
    id,
    name: 'Untitled workflow',
    tag: 'Yours',
    desc: 'A reusable workflow created in Roundtable.',
    builtin: false,
    version: 0,
    updatedAt: new Date(timestamp).toISOString(),
    planning: { cut: 'by_role', clarifyThreshold: 0.6, maxClarifyQuestions: 3 },
    stages: [
      {
        id: 'intake', name: 'Intake', icon: 'clip', kind: 'intake',
        desc: 'Capture the goal in plain language.',
        seats: [{ ref: { kind: 'user' } }], fixed: true,
        gate: gate('none', 'Goal captured', 'The workflow has an initial goal.'),
        requiredInputs: ['goal'], expectedOutputs: ['intake'], requiredCapabilities: [],
      },
      {
        id: `build-${timestamp}`, name: 'Build', icon: 'code', kind: 'work',
        desc: 'Implement the approved request.',
        seats: [{ ref: { kind: 'role', role: 'implementer', agentId: 'atlas' } }],
        gate: gate('none', 'Build ready', 'The implementer can execute the task.'),
        requiredInputs: ['goal'], expectedOutputs: ['working artifact'],
        requiredCapabilities: ['frontend.implementation'],
      },
      {
        id: `ship-${timestamp}`, name: 'Ship', icon: 'rocket', kind: 'ship',
        desc: 'Present the result for acceptance.',
        seats: [{ ref: { kind: 'user' } }],
        gate: gate('final_delivery_acceptance', 'Accept delivery', 'The user accepts or requests changes.', ['accept_delivery']),
        requiredInputs: ['working artifact'], expectedOutputs: ['accepted delivery'], requiredCapabilities: [],
      },
    ],
  };
}
