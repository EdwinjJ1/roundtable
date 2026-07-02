import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOnOpenAICompat } from '../src/server/actions/adapters/openai-compat-adapter.js';
import { normalizeAdapter } from '../src/server/actions/agent-runner.js';
import {
  listSettingsState,
  resolveDefaultAgentAdapter,
  saveSettings,
} from '../src/server/actions/settings-actions.js';
import { readData, resetData } from '../src/server/store.js';

let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'roundtable-settings-'));
  process.env.ROUNDTABLE_DATA_PATH = join(tempDir, 'data.json');
  await resetData();
});

afterEach(async () => {
  delete process.env.ROUNDTABLE_DATA_PATH;
  delete process.env.ROUNDTABLE_OPENAI_API_KEY;
  delete process.env.ROUNDTABLE_OPENAI_BASE_URL;
  delete process.env.ROUNDTABLE_OPENAI_MODEL;
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

describe('settings actions', () => {
  it('saves model provider config without returning the API key', async () => {
    const state = await saveSettings({
      defaultAgentAdapter: 'openai-compat',
      providers: [{
        provider: 'openai-compatible',
        enabled: true,
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'sk-test-secret',
      }],
    });
    const stored = (await readData()).settings.modelProviders.find((provider) => provider.provider === 'openai-compatible');
    const exposed = state.providers.find((provider) => provider.provider === 'openai-compatible');

    expect(await resolveDefaultAgentAdapter()).toBe('openai-compat');
    expect(normalizeAdapter(await resolveDefaultAgentAdapter())).toBe('openai-compat');
    expect(stored?.apiKey).toBe('sk-test-secret');
    expect(JSON.stringify(state)).not.toContain('sk-test-secret');
    expect(exposed?.apiKeySet).toBe(true);
    expect(exposed?.apiKeySource).toBe('settings');
  });

  it('keeps existing keys when saving a provider with an empty key field', async () => {
    await saveSettings({
      providers: [{
        provider: 'minimax',
        apiKey: 'mini-secret',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M3',
      }],
    });
    await saveSettings({
      providers: [{
        provider: 'minimax',
        baseUrl: 'https://alt.minimax.example/v1',
        model: 'MiniMax-M2.7',
      }],
    });

    const stored = (await readData()).settings.modelProviders.find((provider) => provider.provider === 'minimax');
    expect(stored?.apiKey).toBe('mini-secret');
    expect(stored?.baseUrl).toBe('https://alt.minimax.example/v1');
    expect(stored?.model).toBe('MiniMax-M2.7');
  });

  it('runs OpenAI-compatible requests using saved settings instead of env vars', async () => {
    await saveSettings({
      providers: [{
        provider: 'openai-compatible',
        enabled: true,
        baseUrl: 'https://settings-model.test/v1',
        model: 'settings-model',
        apiKey: 'settings-key',
      }],
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'settings response' }, finish_reason: 'stop' }],
      usage: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runOnOpenAICompat({
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 1_000,
    });
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(result.text).toBe('settings response');
    expect(url).toBe('https://settings-model.test/v1/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer settings-key' });
    expect(JSON.parse(String(init.body)).model).toBe('settings-model');
  });

  it('lists env-backed provider state without exposing the env key', async () => {
    process.env.ROUNDTABLE_OPENAI_API_KEY = 'env-secret';
    process.env.ROUNDTABLE_OPENAI_BASE_URL = 'https://env-model.test/v1';
    process.env.ROUNDTABLE_OPENAI_MODEL = 'env-model';

    const state = await listSettingsState();
    const openai = state.providers.find((provider) => provider.provider === 'openai-compatible');

    expect(openai?.apiKeySet).toBe(true);
    expect(openai?.apiKeySource).toBe('env');
    expect(openai?.baseUrl).toBe('https://env-model.test/v1');
    expect(JSON.stringify(state)).not.toContain('env-secret');
  });
});
