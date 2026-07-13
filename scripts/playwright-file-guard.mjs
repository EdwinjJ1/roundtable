import { readFile, rm, writeFile } from 'node:fs/promises';

const GENERATED_NEXT_ENV = /^\/\/\/ <reference types="next" \/>\r?\n\/\/\/ <reference types="next\/image-types\/global" \/>\r?\n(?:\/\/\/ <reference types="next\/navigation-types\/compat\/navigation" \/>\r?\n)?\/\/\/ <reference path="\.\/.next-playwright\/types\/routes\.d\.ts" \/>\r?\n\r?\n\/\/ NOTE: This file should not be edited\r?\n(?:\/\/ see https:\/\/nextjs\.org\/docs\/app\/api-reference\/config\/typescript for more information\.\r?\n)?$/;

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function buffersEqual(left, right) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

export function isPlaywrightGeneratedNextEnv(content) {
  return content !== null && GENERATED_NEXT_ENV.test(content.toString('utf8'));
}

export async function snapshotFile(path) {
  return readOptional(path);
}

/**
 * Restore only a byte shape owned entirely by Next.js. Any extra or changed
 * byte is treated as a concurrent contributor edit and is preserved.
 */
export async function restorePlaywrightNextEnv({
  path,
  snapshot,
  warn = (message) => process.stderr.write(`${message}\n`),
}) {
  const current = await readOptional(path);

  if (isPlaywrightGeneratedNextEnv(current)) {
    if (snapshot === null) await rm(path, { force: true });
    else await writeFile(path, snapshot);
    return { status: 'restored' };
  }

  if (!buffersEqual(current, snapshot)) {
    warn(
      `[test:e2e] Preserved a concurrent edit to ${path}; ` +
        'it did not exactly match the Next.js generated file.',
    );
    return { status: 'preserved-concurrent-edit' };
  }

  return { status: 'unchanged' };
}
