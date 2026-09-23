import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generate, listModels, testConnection } from './provider.mjs';
import { makeWorkspace, nextTask } from './workflow.mjs';
import { activeProviderEnv, activeProviderInfo, loadProviderSettings, publicProviderSettings,
  removeProvider, saveProvider, selectProvider } from './provider-settings.mjs';

test('provider connection is encrypted, survives restart, and routes task requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-providers-'));
  const file = join(dir, 'providers.json');
  const secret = join(dir, 'provider.key');
  const fallback = { AI_BASE_URL: 'https://api.openai.com/v1', AI_MODEL: 'old-model', AI_API_KEY: 'env-key' };
  try {
    let settings = await loadProviderSettings(file);
    settings = await saveProvider(settings, { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
      model: 'test/free:free', apiKey: 'private-test-key' }, file, secret);
    const saved = await readFile(file, 'utf8');
    assert.doesNotMatch(saved, /private-test-key/);
    assert.doesNotMatch(JSON.stringify(publicProviderSettings(settings, fallback)), /private-test-key/);
    settings = await loadProviderSettings(file);
    assert.equal(activeProviderInfo(settings, fallback).model, 'test/free:free');
    const active = await activeProviderEnv(settings, fallback, secret);
    assert.equal(active.AI_API_KEY, 'private-test-key');
    const workspace = makeWorkspace('Create a simple project.');
    let calls = 0;
    const fetchImpl = async (_url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, 'Bearer private-test-key');
      assert.equal(JSON.parse(options.body).model, 'test/free:free');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] }) };
    };
    assert.equal(await generate(workspace, nextTask(workspace), { env: active, fetchImpl }), 'Done.');
    assert.equal(calls, 1);
    assert.equal((await testConnection({ env: active, fetchImpl })).status, 'connected');
    settings = selectProvider(settings, 'env', fallback);
    assert.equal(activeProviderInfo(settings, fallback).model, 'old-model');
    settings = removeProvider(settings, settings.providers[0].id);
    assert.equal(settings.providers.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local model works without a key; remote provider rejects insecure URL or missing key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-local-provider-'));
  try {
    const file = join(dir, 'providers.json');
    const secret = join(dir, 'provider.key');
    const empty = await loadProviderSettings(file);
    await assert.rejects(saveProvider(empty, { name: 'Bad', baseUrl: 'http://example.com/v1', model: 'x', apiKey: 'key' }, file, secret), /HTTPS/);
    await assert.rejects(saveProvider(empty, { name: 'Bad', baseUrl: 'https://example.com/v1', model: 'x', apiKey: '' }, file, secret), /API key/);
    const saved = await saveProvider(empty, { name: 'Local', baseUrl: 'http://127.0.0.1:11434/v1', model: 'small', apiKey: '' }, file, secret);
    const env = await activeProviderEnv(saved, {}, secret);
    assert.equal(env.AI_LOCAL_NO_KEY, 'true');
    await testConnection({ env, fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }) };
    } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('model picker only returns IDs and never follows redirects with a credential', async () => {
  const baseUrl = 'https://openrouter.ai/api/v1';
  const models = await listModels({ baseUrl, apiKey: 'private-key', fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer private-key');
    return { ok: true, json: async () => ({ data: [{ id: 'paid/model' }, { id: 'free/model:free' }, { id: 44 }] }) };
  } });
  assert.deepEqual(models, ['free/model:free', 'paid/model']);
});
