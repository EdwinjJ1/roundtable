export type WorkflowPermission =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'process.execute'
  | 'network.connect';

/** Compatibility claims persisted with an imported immutable revision. */
export type WorkflowCompatibilityRequirements = {
  schemaVersion: number;
  minimumAppVersion: string;
  runtimes: string[];
  platforms: string[];
  capabilities: string[];
  permissions: WorkflowPermission[];
};
