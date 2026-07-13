import { describe, expect, it, vi } from 'vitest';
import {
  createWorkflowTransferController,
  MAX_WORKFLOW_FILE_BYTES,
  safeWorkflowFileName,
} from '../src/ui/lib/workflow-transfer-controller.js';

const workflowFile = (name: string, document: unknown) => ({
  name,
  text: async () => JSON.stringify(document),
});

describe('workflow transfer UI controller', () => {
  it('rejects non-JSON files before previewing them', async () => {
    const previewImport = vi.fn();
    const controller = createWorkflowTransferController();

    const result = await controller.previewFile({
      file: workflowFile('workflow.txt', {}),
      previewImport,
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_FILE_TYPE' });
    expect(previewImport).not.toHaveBeenCalled();
    expect(controller.state.error).toContain('.roundtable.json');
  });

  it('rejects an oversized workflow before reading or previewing its contents', async () => {
    const text = vi.fn(async () => '{}');
    const previewImport = vi.fn();
    const controller = createWorkflowTransferController();

    const result = await controller.previewFile({
      file: { name: 'huge.roundtable.json', size: MAX_WORKFLOW_FILE_BYTES + 1, text },
      previewImport,
    });

    expect(result).toEqual({ ok: false, code: 'FILE_TOO_LARGE' });
    expect(text).not.toHaveBeenCalled();
    expect(previewImport).not.toHaveBeenCalled();
    expect(controller.state.error).toContain('1 MB');
  });

  it('keeps only the latest file preview when async checks finish out of order', async () => {
    let finishFirst!: (value: unknown) => void;
    const firstPreview = new Promise((resolve) => { finishFirst = resolve; });
    const previewImport = vi.fn(({ document }: { document: unknown }) => {
      const name = (document as { name: string }).name;
      return name === 'First' ? firstPreview : Promise.resolve({ name: 'Second', version: 2, hash: 'hash-2' });
    });
    const controller = createWorkflowTransferController();

    const first = controller.previewFile({ file: workflowFile('first.roundtable.json', { name: 'First' }), previewImport });
    const second = await controller.previewFile({ file: workflowFile('second.roundtable.json', { name: 'Second' }), previewImport });
    finishFirst({ name: 'First', version: 1, hash: 'hash-1' });

    await expect(first).resolves.toEqual({ ok: false, code: 'STALE' });
    expect(second).toMatchObject({ ok: true });
    expect(controller.state.fileName).toBe('second.roundtable.json');
    expect(controller.state.preview?.name).toBe('Second');
  });

  it('requires an explicit confirmation and refuses previews with blocking issues', async () => {
    const importDocument = vi.fn();
    const controller = createWorkflowTransferController();
    await controller.previewFile({
      file: workflowFile('blocked.roundtable.json', { workflow: {} }),
      previewImport: async () => ({
        canImport: false, canRun: false, contentHash: 'hash',
        workflow: { name: 'Blocked workflow', version: 1 },
        checks: [{ status: 'blocking', category: 'app', message: 'Required Roundtable version is unavailable.' }],
      }),
    });

    expect(importDocument).not.toHaveBeenCalled();
    const result = await controller.confirmImport({ importDocument });

    expect(result).toEqual({ ok: false, code: 'BLOCKED' });
    expect(importDocument).not.toHaveBeenCalled();
    expect(controller.state.preview?.blocking).toEqual(['Required Roundtable version is unavailable.']);
  });

  it('surfaces unavailable run requirements as warnings without blocking a safe import', async () => {
    const controller = createWorkflowTransferController();
    await controller.previewFile({
      file: workflowFile('portable.roundtable.json', { workflow: {} }),
      previewImport: async () => ({
        canImport: true,
        canRun: false,
        contentHash: 'portable-hash',
        workflow: { name: 'Portable workflow', version: 3 },
        checks: [{ status: 'unavailable', category: 'runtime', message: 'Claude Code is not installed.' }],
      }),
    });

    expect(controller.state.preview).toMatchObject({
      canImport: true,
      canRun: false,
      blocking: [],
      warnings: ['Claude Code is not installed.'],
    });
  });

  it('imports the previewed document once and uses a safe server export filename', async () => {
    const imported = vi.fn();
    const importDocument = vi.fn(async () => ({ workflowId: 'wf-imported' }));
    const exportRevision = vi.fn(async () => ({
      fileName: '../../My workflow.json',
      document: { format: 'roundtable.workflow', version: 1 },
    }));
    const controller = createWorkflowTransferController();
    await controller.previewFile({
      file: workflowFile('ready.roundtable.json', { format: 'roundtable.workflow' }),
      previewImport: async () => ({
        canImport: true, canRun: true, contentHash: 'hash', workflow: { name: 'Ready', version: 1 }, checks: [],
      }),
    });

    expect(importDocument).not.toHaveBeenCalled();
    await expect(controller.confirmImport({ importDocument, onImported: imported })).resolves.toMatchObject({ ok: true });
    expect(importDocument).toHaveBeenCalledOnce();
    expect(importDocument).toHaveBeenCalledWith({
      document: { format: 'roundtable.workflow' },
      confirmedContentHash: 'hash',
    });
    expect(imported).toHaveBeenCalledOnce();

    const exported = await controller.exportRevision({ revisionId: 'revision-1', exportRevision });
    expect(exportRevision).toHaveBeenCalledWith({ revisionId: 'revision-1' });
    expect(exported).toMatchObject({ ok: true, value: { fileName: 'My-workflow.roundtable.json' } });
    expect(safeWorkflowFileName('official.roundtable.json')).toBe('official.roundtable.json');
  });
});
