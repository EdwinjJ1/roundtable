import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'scripts/run-playwright.mjs');
const CHILD = join(ROOT, 'tests/fixtures/playwright-runner-child.mjs');
const ORIGINAL = '/// <reference types="next" />\n// original bytes\n';
const GENERATED = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="./.next-playwright/types/routes.d.ts" />

// NOTE: This file should not be edited
`;
const directories: string[] = [];

async function setup(mode: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'roundtable-runner-'));
  directories.push(cwd);
  const nextEnv = join(cwd, 'next-env.d.ts');
  await writeFile(nextEnv, ORIGINAL);
  const runner = spawn(process.execPath, [RUNNER], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ROUNDTABLE_E2E_TEST_COMMAND: JSON.stringify([
        process.execPath,
        CHILD,
        mode,
        nextEnv,
        GENERATED,
      ]),
    },
    stdio: 'ignore',
  });
  return { runner, nextEnv };
}

function closed(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });
}

async function waitForGenerated(path: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const content = await readFile(path, 'utf8');
    if (content === GENERATED) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Child did not generate next-env.d.ts');
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Playwright runner process boundary', () => {
  it('keeps a child failure code, waits for a delayed descendant, and restores bytes', async () => {
    const { runner, nextEnv } = await setup('nonzero-with-late-descendant');

    expect(await closed(runner)).toBe(7);
    expect(await readFile(nextEnv, 'utf8')).toBe(ORIGINAL);
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('forwards %s, cleans the process group, and restores bytes', async (signal, code) => {
    const { runner, nextEnv } = await setup('wait-for-signal');
    await waitForGenerated(nextEnv);

    runner.kill(signal);
    if (signal === 'SIGINT') runner.kill(signal);

    expect(await closed(runner)).toBe(code);
    expect(await readFile(nextEnv, 'utf8')).toBe(ORIGINAL);
  });
});
