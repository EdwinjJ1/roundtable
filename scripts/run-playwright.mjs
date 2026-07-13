import { spawn } from 'node:child_process';
import { restorePlaywrightNextEnv, snapshotFile } from './playwright-file-guard.mjs';
import { signalProcessGroup, stopProcessGroup } from './process-group.mjs';

const nextEnvPath = 'next-env.d.ts';
const snapshot = await snapshotFile(nextEnvPath);
const useProcessGroup = process.platform !== 'win32';
const testCommand =
  process.env.NODE_ENV === 'test' && process.env.ROUNDTABLE_E2E_TEST_COMMAND
    ? JSON.parse(process.env.ROUNDTABLE_E2E_TEST_COMMAND)
    : null;
const command = testCommand?.[0] ?? 'corepack';
const commandArgs = testCommand?.slice(1) ?? [
  'pnpm',
  'exec',
  'playwright',
  'test',
  ...process.argv.slice(2),
];
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: process.env,
  detached: useProcessGroup,
});

let receivedSignal = null;
const forwardSignal = (signal) => {
  receivedSignal ??= signal;
  if (child.pid !== undefined) signalProcessGroup(child.pid, signal);
};
const forwardInterrupt = () => forwardSignal('SIGINT');
const forwardTermination = () => forwardSignal('SIGTERM');
process.on('SIGINT', forwardInterrupt);
process.on('SIGTERM', forwardTermination);

let exitCode = 1;
try {
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== null) resolve(code);
      else resolve(signal === 'SIGINT' ? 130 : 143);
    });
  });
} finally {
  if (child.pid !== undefined) await stopProcessGroup(child.pid);
  await restorePlaywrightNextEnv({ path: nextEnvPath, snapshot });
  process.removeListener('SIGINT', forwardInterrupt);
  process.removeListener('SIGTERM', forwardTermination);
}

process.exitCode = receivedSignal === 'SIGINT' ? 130 : receivedSignal ? 143 : exitCode;
