import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 3107;
const baseURL = `http://127.0.0.1:${port}`;
const runId = process.env.CI ? 'ci' : String(process.pid);
const runRoot = join(tmpdir(), `roundtable-playwright-${runId}`);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: 'roundtable-playwright-only-secret',
      ROUNDTABLE_ENABLE_DEV_AUTH: '1',
      ROUNDTABLE_AGENT_ADAPTER: 'local-dispatch',
      ROUNDTABLE_CLARIFY_ENABLED: 'false',
      ROUNDTABLE_NEXT_DIST_DIR: '.next-playwright',
      ROUNDTABLE_DATA_PATH: `${runRoot}.json`,
      ROUNDTABLE_WORKSPACE_ROOT: `${runRoot}-workspaces`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
