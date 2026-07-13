import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  getWorkflowRevision,
  saveWorkflowRevision,
  validateWorkflowTemplate,
  WorkflowTemplateError,
  type SaveWorkflowRevisionResult,
} from './mission-actions.js';
import { workflowExecutableContentHash } from './mission-actions.js';
import { id, readData } from '../store.js';
import type { RoundtableData } from '../store.js';
import type { Actor, WorkflowRevision, WorkflowTemplate } from '../types.js';
import type { WorkflowCompatibilityRequirements, WorkflowPermission } from '../workflow-compatibility.js';
import { AGENT_ROSTER } from './agent-roster.js';
import { normalizeRuntimeKind } from './cli-runtimes/registry.js';

export type { WorkflowCompatibilityRequirements, WorkflowPermission } from '../workflow-compatibility.js';

export const ROUNDTABLE_WORKFLOW_FILE_SCHEMA = 'roundtable.workflow' as const;
export const ROUNDTABLE_WORKFLOW_FILE_VERSION = 1 as const;
export const MAX_WORKFLOW_FILE_BYTES = 1_000_000;

export type RoundtableWorkflowFile = {
  schema: typeof ROUNDTABLE_WORKFLOW_FILE_SCHEMA;
  schemaVersion: typeof ROUNDTABLE_WORKFLOW_FILE_VERSION;
  minimumAppVersion: string;
  exportedAt: string;
  provenance: {
    workflowId: string;
    revision: number;
    contentHash: string;
    documentHash: string;
  };
  compatibility: {
    runtimes: string[];
    platforms: string[];
    capabilities: string[];
    permissions: WorkflowPermission[];
  };
  workflow: WorkflowTemplate;
};

export class WorkflowPortabilityError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type WorkflowCompatibilityStatus = 'blocking' | 'warning' | 'available' | 'unavailable';
export type WorkflowCompatibilityCheck = {
  category: 'schema' | 'app' | 'runtime' | 'platform' | 'capabilities' | 'permissions' | 'integrity';
  status: WorkflowCompatibilityStatus;
  message: string;
  missing?: string[];
};

export type WorkflowPreflightResult = {
  canImport: boolean;
  canRun: boolean;
  /** Backward-compatible confirmation alias; now the canonical document hash. */
  contentHash: string | null;
  documentHash: string | null;
  workflowContentHash: string | null;
  requirements: WorkflowCompatibilityRequirements | null;
  workflow: WorkflowTemplate | null;
  checks: WorkflowCompatibilityCheck[];
};

const gateSchema = z.object({
  kind: z.enum([
    'none', 'requirement_clarification', 'plan_approval', 'handoff_acceptance',
    'test_failure_repair', 'reviewer_signoff', 'final_delivery_acceptance',
  ]),
  required: z.boolean(),
  label: z.string().max(200),
  description: z.string().max(2_000),
  actions: z.array(z.string().max(100)).max(30),
});

const workflowTemplateFileSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  tag: z.string().max(100).nullable(),
  desc: z.string().max(5_000),
  builtin: z.boolean(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().max(100),
  planning: z.object({
    cut: z.enum(['by_role', 'by_capability', 'by_artifact']),
    clarifyThreshold: z.number().min(0).max(1),
    maxClarifyQuestions: z.number().int().min(0).max(10),
  }),
  stages: z.array(z.object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    icon: z.string().max(100),
    kind: z.enum(['intake', 'clarify', 'plan', 'work', 'review', 'repair', 'ship']),
    desc: z.string().max(5_000),
    seats: z.array(z.object({
      ref: z.union([
        z.object({ kind: z.literal('user') }),
        z.object({
          kind: z.literal('role'),
          role: z.enum(['planner', 'pm', 'architect', 'implementer', 'reviewer', 'fixer']),
          agentId: z.string().min(1).max(200).optional(),
        }),
      ]),
    })).max(30),
    fixed: z.boolean().optional(),
    parallelGroup: z.string().max(200).optional(),
    gate: gateSchema,
    requiredInputs: z.array(z.string().max(500)).max(100),
    expectedOutputs: z.array(z.string().max(500)).max(100),
    requiredCapabilities: z.array(z.string().max(200)).max(100),
  })).min(1).max(100),
});

const workflowFileSchema = z.object({
  schema: z.literal(ROUNDTABLE_WORKFLOW_FILE_SCHEMA),
  schemaVersion: z.literal(ROUNDTABLE_WORKFLOW_FILE_VERSION),
  minimumAppVersion: z.string().min(1).max(100),
  exportedAt: z.string().max(100),
  provenance: z.object({
    workflowId: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  compatibility: z.object({
    runtimes: z.array(z.string().min(1).max(100)).max(20),
    platforms: z.array(z.string().min(1).max(100)).max(20),
    capabilities: z.array(z.string().min(1).max(200)).max(300),
    permissions: z.array(z.enum(['filesystem.read', 'filesystem.write', 'process.execute', 'network.connect'])).max(10),
  }),
  workflow: workflowTemplateFileSchema,
});

export async function exportWorkflowRevisionFile(actor: Actor, revisionId: string): Promise<{
  fileName: string;
  file: RoundtableWorkflowFile;
}> {
  const revision = await getWorkflowRevision(actor, revisionId);
  if (!revision) throw new WorkflowPortabilityError('workflow_revision_not_found', 404);
  const template = structuredClone(revision.template);
  const requirements = revision.compatibility ?? defaultRequirementsFor(template);
  if (requirements.schemaVersion !== ROUNDTABLE_WORKFLOW_FILE_VERSION) {
    throw new WorkflowPortabilityError('workflow_schema_version_not_exportable', 409);
  }
  const file: RoundtableWorkflowFile = {
    schema: ROUNDTABLE_WORKFLOW_FILE_SCHEMA,
    schemaVersion: ROUNDTABLE_WORKFLOW_FILE_VERSION,
    minimumAppVersion: requirements.minimumAppVersion,
    exportedAt: new Date().toISOString(),
    provenance: {
      workflowId: revision.workflowId,
      revision: revision.revision,
      contentHash: revision.contentHash,
      documentHash: '',
    },
    compatibility: {
      runtimes: [...requirements.runtimes],
      platforms: [...requirements.platforms],
      capabilities: [...requirements.capabilities],
      permissions: [...requirements.permissions],
    },
    workflow: template,
  };
  file.provenance.documentHash = workflowDocumentHash(file);
  return {
    fileName: `${safeFileStem(template.name)}.roundtable.json`,
    file,
  };
}

export async function preflightWorkflowFile(actor: Actor, input: unknown): Promise<WorkflowPreflightResult> {
  const parsedInput = parseBoundedInput(input);
  const parsed = workflowFileSchema.safeParse(parsedInput);
  if (!parsed.success) {
    return {
      canImport: false,
      canRun: false,
      contentHash: null,
      documentHash: null,
      workflowContentHash: null,
      requirements: null,
      workflow: null,
      checks: [{ category: 'schema', status: 'blocking', message: 'File structure or schema version is invalid.' }],
    };
  }
  const file = parsed.data as RoundtableWorkflowFile;
  // Preflight is deliberately non-executing: it reads saved configuration but
  // never launches a CLI probe or any content from the imported document.
  const data = await readData();
  const requirements = requirementsFromFile(file);
  const workflowContentHash = workflowExecutableContentHash(file.workflow);
  const documentHash = workflowDocumentHash(file);
  const domainError = workflowDomainError(file.workflow);
  const checks: WorkflowCompatibilityCheck[] = [
    {
      category: 'schema',
      status: domainError ? 'blocking' : 'available',
      message: domainError
        ? `Workflow definition is invalid: ${domainError}.`
        : 'Workflow file schema v1 and definition are valid.',
    },
    ...environmentCompatibilityChecks(requirements, file.workflow, data),
    {
      category: 'integrity',
      status: workflowContentHash === file.provenance.contentHash
        && documentHash === file.provenance.documentHash ? 'available' : 'blocking',
      message: workflowContentHash === file.provenance.contentHash
        && documentHash === file.provenance.documentHash
        ? 'Workflow and compatibility envelope match their integrity hashes. Hashes are not signatures or proof of origin.'
        : 'The workflow or compatibility envelope differs from its integrity hash.',
    },
  ];
  const importBlocked = checks.some((check) => check.status === 'blocking');
  const runBlocked = checks.some((check) => check.status === 'blocking' || check.status === 'unavailable');
  return {
    canImport: !importBlocked,
    canRun: !runBlocked,
    contentHash: documentHash,
    documentHash,
    workflowContentHash,
    requirements,
    workflow: structuredClone(file.workflow),
    checks,
  };
}

export async function importWorkflowFile(actor: Actor, input: {
  input: unknown;
  confirmedContentHash: string;
}): Promise<SaveWorkflowRevisionResult> {
  const preview = await preflightWorkflowFile(actor, input.input);
  if (!preview.canImport || !preview.workflow || !preview.documentHash || !preview.requirements) {
    throw new WorkflowPortabilityError('workflow_file_not_importable', 409);
  }
  if (input.confirmedContentHash !== preview.documentHash) {
    throw new WorkflowPortabilityError('workflow_import_confirmation_mismatch', 409);
  }
  const importedTemplate: WorkflowTemplate = {
    ...structuredClone(preview.workflow),
    id: id('wf_import'),
    builtin: false,
    version: 0,
    updatedAt: '',
  };
  return saveWorkflowRevision(actor, {
    template: importedTemplate,
    expectedRevision: 0,
    documentHash: preview.documentHash,
    compatibility: preview.requirements,
  });
}

function parseBoundedInput(input: unknown): unknown {
  let serialized: string;
  if (typeof input === 'string') serialized = input;
  else {
    try {
      const encoded = JSON.stringify(input);
      if (typeof encoded !== 'string') throw new Error('not_serializable');
      serialized = encoded;
    } catch {
      throw new WorkflowPortabilityError('workflow_file_not_serializable', 400);
    }
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKFLOW_FILE_BYTES) {
    throw new WorkflowPortabilityError('workflow_file_too_large', 413);
  }
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function requiredCapabilitiesFor(template: WorkflowTemplate): string[] {
  return [...new Set(template.stages.flatMap((stage) => stage.requiredCapabilities))].sort();
}

function requiredPermissionsFor(template: WorkflowTemplate): WorkflowPermission[] {
  const hasRunnableStage = template.stages.some((stage) => ['plan', 'work', 'review'].includes(stage.kind));
  const hasWritableStage = template.stages.some((stage) => ['work', 'repair'].includes(stage.kind));
  return [
    'filesystem.read',
    ...(hasRunnableStage ? ['process.execute' as const] : []),
    ...(hasWritableStage ? ['filesystem.write' as const] : []),
  ];
}

function defaultRequirementsFor(template: WorkflowTemplate): WorkflowCompatibilityRequirements {
  return {
    schemaVersion: ROUNDTABLE_WORKFLOW_FILE_VERSION,
    minimumAppVersion: currentAppVersion(),
    runtimes: ['local-dispatch'],
    platforms: ['darwin', 'linux', 'win32'],
    capabilities: requiredCapabilitiesFor(template),
    permissions: requiredPermissionsFor(template),
  };
}

function requirementsFromFile(file: RoundtableWorkflowFile): WorkflowCompatibilityRequirements {
  return {
    schemaVersion: file.schemaVersion,
    minimumAppVersion: file.minimumAppVersion,
    runtimes: [...file.compatibility.runtimes],
    platforms: [...file.compatibility.platforms],
    capabilities: [...file.compatibility.capabilities],
    permissions: [...file.compatibility.permissions],
  };
}

function environmentCompatibilityChecks(
  requirements: WorkflowCompatibilityRequirements,
  template: WorkflowTemplate,
  data: Pick<RoundtableData, 'agentRuntimeConfigs' | 'agentRuntimeDefaults'>,
): WorkflowCompatibilityCheck[] {
  const minimumVersion = parseSemVer(requirements.minimumAppVersion);
  const installedVersion = parseSemVer(currentAppVersion());
  const versionAvailable = Boolean(
    minimumVersion
    && installedVersion
    && compareVersions(installedVersion, minimumVersion) >= 0,
  );

  const configuredRuntimes = new Set<string>(['local-dispatch']);
  for (const config of data.agentRuntimeConfigs) configuredRuntimes.add(config.runtime);
  for (const config of data.agentRuntimeDefaults) configuredRuntimes.add(config.runtime);
  const globalRuntime = normalizeRuntimeKind(process.env.ROUNDTABLE_AGENT_RUNTIME);
  if (globalRuntime) configuredRuntimes.add(globalRuntime);
  for (const agent of AGENT_ROSTER) {
    const byAgent = normalizeRuntimeKind(process.env[`ROUNDTABLE_AGENT_RUNTIME_${envKey(agent.id)}`]);
    const byRole = normalizeRuntimeKind(process.env[`ROUNDTABLE_AGENT_RUNTIME_${envKey(agent.role)}`]);
    if (byAgent) configuredRuntimes.add(byAgent);
    if (byRole) configuredRuntimes.add(byRole);
  }
  const missingRuntimes = unique(requirements.runtimes).filter((runtime) => !configuredRuntimes.has(runtime));

  const supportedPlatforms = unique(requirements.platforms);
  const platformAvailable = supportedPlatforms.length === 0 || supportedPlatforms.includes(process.platform);

  const availableCapabilities = new Set(AGENT_ROSTER.flatMap((agent) => [
    ...agent.capabilities,
    ...agent.skills,
  ]));
  // Requirements derived from executable workflow content are authoritative.
  // A document cannot weaken them by omitting its declared capability list.
  const effectiveCapabilities = unique([
    ...requirements.capabilities,
    ...requiredCapabilitiesFor(template),
  ]);
  const missingCapabilities = effectiveCapabilities.filter((capability) => !availableCapabilities.has(capability));

  // Permission declarations are advisory until each runtime exposes a stable
  // permission introspection API. Server-derived permissions remain included,
  // so a document cannot erase the access implied by its executable stages.
  const effectivePermissions = unique<WorkflowPermission>([
    ...requirements.permissions,
    ...requiredPermissionsFor(template),
  ]);

  return [
    {
      category: 'app',
      status: versionAvailable ? 'available' : 'blocking',
      message: versionAvailable
        ? `Roundtable ${currentAppVersion()} satisfies minimum ${requirements.minimumAppVersion}.`
        : minimumVersion && installedVersion
          ? `Roundtable ${requirements.minimumAppVersion} or newer is required; current version is ${currentAppVersion()}.`
          : 'The current or required Roundtable version is not valid SemVer.',
    },
    {
      category: 'runtime',
      status: missingRuntimes.length === 0 ? 'available' : 'unavailable',
      message: missingRuntimes.length === 0
        ? 'Declared runtimes are configured. CLI readiness is checked when execution starts.'
        : `Required runtimes are not configured: ${missingRuntimes.join(', ')}.`,
      ...(missingRuntimes.length > 0 ? { missing: missingRuntimes } : {}),
    },
    {
      category: 'platform',
      status: platformAvailable ? 'available' : 'unavailable',
      message: platformAvailable
        ? `Current platform ${process.platform} is supported.`
        : `Current platform ${process.platform} is not declared as supported.`,
      ...(!platformAvailable ? { missing: [process.platform] } : {}),
    },
    {
      category: 'capabilities',
      status: missingCapabilities.length === 0 ? 'available' : 'unavailable',
      message: missingCapabilities.length === 0
        ? 'Required agent capabilities are available.'
        : `Required agent capabilities are unavailable: ${missingCapabilities.join(', ')}.`,
      ...(missingCapabilities.length > 0 ? { missing: missingCapabilities } : {}),
    },
    {
      category: 'permissions',
      status: effectivePermissions.length === 0 ? 'available' : 'warning',
      message: effectivePermissions.length === 0
        ? 'No file, process, or network permissions are declared.'
        : `Permission checks are advisory and runtime-specific: ${effectivePermissions.join(', ')}.`,
    },
  ];
}

/**
 * Canonical integrity hash for the executable workflow and its compatibility
 * envelope. This deliberately excludes mutable discovery/provenance metadata.
 * It is an integrity checksum, not a signature or proof of origin.
 */
export function workflowDocumentHash(file: RoundtableWorkflowFile): string {
  return workflowDocumentHashForRequirements(file.workflow, requirementsFromFile(file));
}

function workflowDocumentHashForRequirements(
  template: WorkflowTemplate,
  requirements: WorkflowCompatibilityRequirements,
): string {
  return createHash('sha256').update(canonicalJson({
    schema: ROUNDTABLE_WORKFLOW_FILE_SCHEMA,
    schemaVersion: requirements.schemaVersion,
    minimumAppVersion: requirements.minimumAppVersion,
    compatibility: {
      runtimes: requirements.runtimes,
      platforms: requirements.platforms,
      capabilities: requirements.capabilities,
      permissions: requirements.permissions,
    },
    workflow: {
      planning: template.planning,
      stages: template.stages,
    },
  })).digest('hex');
}

/** Revalidates an imported revision against its persisted declaration and current host. */
export function workflowRevisionCompatibilityError(
  revision: Pick<WorkflowRevision, 'template' | 'documentHash' | 'compatibility'>,
  data: Pick<RoundtableData, 'agentRuntimeConfigs' | 'agentRuntimeDefaults'>,
): string | null {
  // Revisions created locally before portability declarations remain runnable,
  // but imported revision metadata is an invariant pair: clearing either side
  // must never downgrade the revision into the legacy path.
  if (!revision.compatibility && !revision.documentHash) return null;
  if (!revision.compatibility) return 'workflow_incompatible:missing_compatibility_declaration';
  if (!revision.documentHash) return 'workflow_incompatible:missing_document_hash';
  const expectedDocumentHash = workflowDocumentHashForRequirements(revision.template, revision.compatibility);
  if (expectedDocumentHash !== revision.documentHash) {
    return 'workflow_incompatible:document_integrity_mismatch';
  }
  if (revision.compatibility.schemaVersion !== ROUNDTABLE_WORKFLOW_FILE_VERSION) {
    return 'workflow_incompatible:schema';
  }
  const domainError = workflowDomainError(revision.template);
  if (domainError) return `workflow_incompatible:definition:${domainError}`;
  const blockers = environmentCompatibilityChecks(revision.compatibility, revision.template, data)
    .filter((check) => check.status === 'blocking' || check.status === 'unavailable')
    .map((check) => check.category);
  return blockers.length > 0 ? `workflow_incompatible:${unique(blockers).join(',')}` : null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function envKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

type SemanticVersion = {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
};

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemVer(value: string): SemanticVersion | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease: match[4]?.split('.') ?? [],
  };
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const order = compareNumericIdentifier(left[key], right[key]);
    if (order !== 0) return order;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return compareNumericIdentifier(a, b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function workflowDomainError(template: WorkflowTemplate): string | null {
  try {
    validateWorkflowTemplate(template);
    return null;
  } catch (error) {
    if (error instanceof WorkflowTemplateError) return error.message;
    throw error;
  }
}

function currentAppVersion(): string {
  return process.env.ROUNDTABLE_APP_VERSION?.trim() || '0.1.0-beta.1';
}

function safeFileStem(value: string): string {
  const stem = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return stem || 'workflow';
}
