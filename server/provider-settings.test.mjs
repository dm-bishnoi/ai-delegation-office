import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generate, generateWebsite, listModels, testConnection } from './provider.mjs';
import { makeWorkspace, nextTask } from './workflow.mjs';
import { activeProviderEnv, activeProviderInfo, loadProviderSettings, publicProviderSettings,
  removeProvider, saveProvider, selectProvider, setProviderFallback } from './provider-settings.mjs';

test('provider connection is encrypted, survives restart, and routes task requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-providers-'));
  const file = join(dir, 'providers.json');
  const secret = join(dir, 'provider.key');
  const fallback = { AI_BASE_URL: 'https://api.openai.com/v1', AI_MODEL: 'old-model', AI_API_KEY: 'env-key', AI_FREE_FALLBACK: 'false' };
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
    assert.equal(active.AI_FREE_FALLBACK, 'true');
    const workspace = makeWorkspace('Create a simple project.');
    let calls = 0;
    const fetchImpl = async (url, options) => {
      if (String(url).endsWith('/key')) {
        assert.equal(options.method, undefined);
        assert.equal(options.headers.Authorization, 'Bearer private-test-key');
        return { ok: true, json: async () => ({ data: { free_model_daily_requests: { remaining: 3 } } }) };
      }
      calls++;
      assert.equal(options.headers.Authorization, 'Bearer private-test-key');
      assert.equal(JSON.parse(options.body).model, 'test/free:free');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] }) };
    };
    assert.equal(await generate(workspace, nextTask(workspace), { env: active, fetchImpl }), 'Done.');
    assert.equal(calls, 1);
    assert.deepEqual(await testConnection({ env: active, fetchImpl }),
      { status: 'connected', model: 'test/free:free', check: 'credentials', freeRemaining: 3 });
    assert.equal(calls, 1);
    settings = setProviderFallback(settings, settings.providers[0].id, false);
    assert.equal((await activeProviderEnv(settings, fallback, secret)).AI_FREE_FALLBACK, 'false');
    settings = setProviderFallback(settings, settings.providers[0].id, true);
    assert.equal((await activeProviderEnv(settings, fallback, secret)).AI_FREE_FALLBACK, 'true');
    settings = selectProvider(settings, 'env', fallback);
    assert.equal(activeProviderInfo(settings, fallback).model, 'old-model');
    settings = removeProvider(settings, settings.providers[0].id);
    assert.equal(settings.providers.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('OpenRouter key check reports bad credentials and timeouts without running a model', async () => {
  const env = { AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_MODEL: 'free/model:free', AI_API_KEY: 'test-key' };
  await assert.rejects(testConnection({ env, fetchImpl: async () => ({ ok: false, status: 401,
    json: async () => ({ error: { message: 'private provider detail' } }) }) }), error => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /private provider detail/);
    return true;
  });
  await assert.rejects(testConnection({ env, fetchImpl: async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); } }), /key check timed out/);
});

test('malformed provider JSON is diagnosed without exposing its response body', async () => {
  const workspace = makeWorkspace('A small website.');
  for (const task of workspace.tasks) { task.status = 'done'; task.output = 'Approved.'; }
  const env = { AI_BASE_URL: 'https://api.example.com/v1', AI_MODEL: 'test-model', AI_API_KEY: 'test-key' };
  await assert.rejects(generateWebsite(workspace, { env, fetchImpl: async () =>
    new Response('{"private":"secret", "choices": [', { status: 200, headers: { 'content-type': 'application/json' } }) }), error => {
    assert.match(error.message, /invalid JSON \(HTTP 200\)/);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
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
