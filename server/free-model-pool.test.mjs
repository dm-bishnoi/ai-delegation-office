import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clearModelCooldowns, modelCoolingDown, setModelCooldown, withFreeFallback } from './free-models.mjs';
import { POOL_LIMIT, PROBE_LIMIT, probeModel, refreshVerifiedFreeModels } from './free-model-pool.mjs';
import { activeProviderEnv, loadProviderSettings, publicProviderSettings, saveProvider } from './provider-settings.mjs';

const model = (id, output = 16000, pricing = { prompt: '0', completion: '0', request: '0' }) => ({
  id, pricing, context_length: 32000, top_provider: { max_completion_tokens: output },
  architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'],
});
const probeOk = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }) });

test('health probe accepts a valid tiny text response and classifies failures safely', async () => {
  let bodies = [];
  const good = await probeModel('free/good:free', { apiKey: 'secret-key', fetchImpl: async (url, options) => {
    bodies.push({ url: String(url), body: JSON.parse(options.body), auth: options.headers.Authorization });
    return probeOk();
  } });
  assert.equal(good.ok, true);
  assert.equal(bodies[0].body.max_tokens, 16);
  assert.match(bodies[0].body.messages[0].content, /Reply with exactly: OK/);
  assert.equal(bodies[0].auth, 'Bearer secret-key'); // key used server-side only, never returned
  assert.equal((await probeModel('x', { apiKey: 'k', fetchImpl: async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); } })).ok, false);
  assert.equal((await probeModel('x', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) })).ok, false);
  assert.equal((await probeModel('x', { apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: {} }] }) }) })).ok, false);
});

test('pool refresh filters paid, non-text, and broken entries and probes a bounded candidate set', async () => {
  const paid = model('bad/paid:free', 16000, { prompt: '0', completion: '0.001', request: '0' });
  const paidRequest = model('bad/request:free', 16000, { prompt: '0', completion: '0', request: '0.01' });
  const missingRequest = model('good/missing-request:free');
  delete missingRequest.pricing.request;
  const imageOnly = model('bad/image:free');
  imageOnly.architecture.output_modalities = ['image'];
  const tiny = model('bad/tiny:free', 512);
  const candidates = Array.from({ length: PROBE_LIMIT + 4 }, (_, index) => model(`good/candidate-${index}:free`, 16000));
  let probes = 0;
  const { pool, checked } = await refreshVerifiedFreeModels({ apiKey: 'secret-key', fetchImpl: async url => {
    if (String(url).endsWith('/models')) return { ok: true, json: async () => ({ data: [paid, paidRequest, imageOnly, tiny, missingRequest, ...candidates] }) };
    probes += 1;
    return probeOk();
  } });
  assert.equal(pool.length, POOL_LIMIT);
  assert.ok(probes <= PROBE_LIMIT + 1, `probes bounded: ${probes}`);
  assert.ok(!pool.some(entry => [paid.id, paidRequest.id, imageOnly.id, tiny.id].includes(entry.id)));
  assert.ok(pool[0].id.startsWith('good/'));
  assert.match(pool[0].verifiedAt, /T/);
  assert.equal(pool[0].status, 'healthy');
  assert.ok(checked.length <= PROBE_LIMIT);
  const allUnavailable = await refreshVerifiedFreeModels({ apiKey: 'k', fetchImpl: async url =>
    String(url).endsWith('/models') ? { ok: true, json: async () => ({ data: [model('good/a:free'), model('good/b:free')] }) }
      : { ok: false, status: 429, json: async () => ({}) } });
  assert.equal(allUnavailable.pool.length, 0);
  assert.equal(allUnavailable.checked.every(item => item.status === 'rate_limited'), true);
  await assert.rejects(refreshVerifiedFreeModels({ apiKey: '', fetchImpl: async () => probeOk() }), /key/i);
  await assert.rejects(refreshVerifiedFreeModels({ apiKey: 'k', fetchImpl: async () => { throw new Error('down'); } }), /catalog/i);
});

test('verified pool metadata flows through env and public settings without keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-pool-'));
  try {
    const file = join(dir, 'providers.json');
    const secret = join(dir, 'provider.key');
    let settings = await loadProviderSettings(file);
    settings = await saveProvider(settings, { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: 'secret-key' }, file, secret);
    const pool = [{ id: 'free/a:free', verifiedAt: '2026-09-27T00:00:00.000Z', maxOutputTokens: 8192, status: 'healthy' }];
    settings = { ...settings, providers: settings.providers.map(item => ({ ...item, verifiedFreeModels: pool })) };
    const env = await activeProviderEnv(settings, {}, secret);
    assert.deepEqual(JSON.parse(env.AI_VERIFIED_FREE_MODELS), pool);
    const published = JSON.stringify(publicProviderSettings(settings, {}));
    assert.match(published, /free\/a:free/);
    assert.doesNotMatch(published, /secret-key/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runtime failover tries the verified pool before the catalog and the generic router', async () => {
  clearModelCooldowns();
  const env = { AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_MODEL: 'openrouter/free', AI_API_KEY: 'k',
    AI_VERIFIED_FREE_MODELS: JSON.stringify([
      { id: 'free/verified-a:free', maxOutputTokens: 8192 },
      { id: 'free/verified-b:free', maxOutputTokens: 8192 },
    ]) };
  const attempts = [];
  const result = await withFreeFallback(async modelId => {
    attempts.push(modelId);
    if (modelId === 'openrouter/free') throw Object.assign(new Error('timed out'), { retryable: true, code: 'timeout' });
    return 'ok';
  }, { env, fetchImpl: async () => { throw new Error('catalog should not be needed'); }, initialTokens: 1500, minimumFallbackTokens: 1200, sleepImpl: async () => {} });
  assert.deepEqual(attempts, ['openrouter/free', 'free/verified-a:free']);
  assert.equal(result.model, 'free/verified-a:free');
  clearModelCooldowns();
});

test('failed models cool down, are skipped, and openrouter/free stays the final last resort', async () => {
  clearModelCooldowns();
  setModelCooldown('free/cooled:free', 'rate_limit');
  assert.equal(modelCoolingDown('free/cooled:free'), true);
  const env = { AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_MODEL: 'free/selected:free', AI_API_KEY: 'k', AI_VERIFIED_FREE_MODELS: '[]' };
  const attempts = [];
  await withFreeFallback(async modelId => {
    attempts.push(modelId);
    if (modelId !== 'openrouter/free') throw Object.assign(new Error('limit'), { retryable: true, code: 'rate_limit' });
    return 'ok';
  }, { env, fetchImpl: async url => String(url).endsWith('/models')
    ? { ok: true, json: async () => ({ data: [model('free/cooled:free', 16000), model('free/fresh:free', 16000)] }) }
    : probeOk(), initialTokens: 1500, minimumFallbackTokens: 1200, sleepImpl: async () => {} });
  assert.deepEqual(attempts, ['free/selected:free', 'free/fresh:free', 'openrouter/free']);
  assert.equal(modelCoolingDown('free/selected:free'), true); // cooldown set by the failure above
  clearModelCooldowns();
  assert.equal(modelCoolingDown('free/selected:free'), false);
});
