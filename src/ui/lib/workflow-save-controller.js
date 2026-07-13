export const WORKFLOW_CONFLICT_MESSAGE = 'This workflow changed elsewhere. Latest version loaded; your edits are still here.';

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
