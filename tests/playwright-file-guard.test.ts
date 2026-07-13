import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  restorePlaywrightNextEnv,
  snapshotFile,
} from '../scripts/playwright-file-guard.mjs';

const ORIGINAL = `/// <reference types="next" />
/// <reference path="./.next/types/routes.d.ts" />
`;
const PLAYWRIGHT_GENERATED = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="./.next-playwright/types/routes.d.ts" />

// NOTE: This file should not be edited
`;

const directories: string[] = [];

async function temporaryPath() {
  const directory = await mkdtemp(join(tmpdir(), 'roundtable-file-guard-'));
  directories.push(directory);
  return join(directory, 'next-env.d.ts');
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Playwright generated-file guard', () => {
  it('restores an exact Next.js Playwright generated file', async () => {
    const path = await temporaryPath();
    await writeFile(path, ORIGINAL);
    const snapshot = await snapshotFile(path);
    await writeFile(path, PLAYWRIGHT_GENERATED);

    await restorePlaywrightNextEnv({ path, snapshot });

    expect(await readFile(path, 'utf8')).toBe(ORIGINAL);
  });

  it('preserves an unrecognised concurrent contributor edit', async () => {
    const path = await temporaryPath();
    await writeFile(path, ORIGINAL);
    const snapshot = await snapshotFile(path);
    await writeFile(path, `${ORIGINAL}// contributor edit\n`);
    const warn = vi.fn();

    const result = await restorePlaywrightNextEnv({
      path,
      snapshot,
      warn,
    });

    expect(result.status).toBe('preserved-concurrent-edit');
    expect(await readFile(path, 'utf8')).toContain('// contributor edit');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('preserves edits appended to the generated file', async () => {
    const path = await temporaryPath();
    await writeFile(path, ORIGINAL);
    const snapshot = await snapshotFile(path);
    const contributorEdit = `${PLAYWRIGHT_GENERATED}// contributor edit\n`;
    await writeFile(path, contributorEdit);

    const result = await restorePlaywrightNextEnv({
      path,
      snapshot,
      warn: vi.fn(),
    });

    expect(result.status).toBe('preserved-concurrent-edit');
    expect(await readFile(path, 'utf8')).toBe(contributorEdit);
  });

  it('removes the generated file when no original existed', async () => {
    const path = await temporaryPath();
    const snapshot = await snapshotFile(path);
    await writeFile(path, PLAYWRIGHT_GENERATED);

    await restorePlaywrightNextEnv({
      path,
      snapshot,
    });

    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
