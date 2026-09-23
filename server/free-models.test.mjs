import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleFreeModels, withFreeFallback } from './free-models.mjs';
import { generateWebsite } from './provider.mjs';
import { makeWorkspace } from './workflow.mjs';

const env = { AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_MODEL: 'openrouter/free', AI_API_KEY: 'test-key' };
const css = 'body{color:red}';
const body = '<main><h1>Portfolio</h1></main>';
const model = (id, output = 16000, pricing = { prompt: '0', completion: '0', request: '0' }) => ({
  id, pricing, context_length: 32000, top_provider: { max_completion_tokens: output },
  architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'],
});
const project = () => {
  const workspace = makeWorkspace('A portfolio website');
  for (const task of workspace.tasks) { task.status = 'done'; task.output = `Approved: ${task.title}`; }
  return workspace;
};

test('catalog only selects verified zero-price models with enough output capacity', () => {
  const models = [model('bad/paid:free', 16000, { prompt: '0', completion: '0.001', request: '0' }),
    model('bad/empty:free', 16000, { prompt: '', completion: '0', request: '0' }),
    model('bad/low:free', 4096), model('bad/no-suffix'), model('good/large:free'), model('good/medium:free', 8192)];
  assert.deepEqual(eligibleFreeModels(models, 8000), ['good/large:free', 'good/medium:free']);
  const unknown = model('good/unspecified:free');
  unknown.top_provider.max_completion_tokens = null;
  assert.deepEqual(eligibleFreeModels([unknown, model('bad/too-small:free', 256)], 1200), ['good/unspecified:free']);
});

test('broken website response retries free models with a 1200-token cap for unknown output capacity', async () => {
  const attempts = [];
  const delays = [];
  const progress = [];
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith('/models')) {
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      return { ok: true, json: async () => ({ data: [model('bad/paid:free', 16000, { prompt: '0', completion: '1', request: '0' }), model('good/large:free', 2048), model('good/medium:free', null)] }) };
    }
    const request = JSON.parse(options.body);
    attempts.push(request.model);
    assert.equal(request.max_tokens, attempts.length >= 3 ? 1200 : 1500);
    if (attempts.length === 1) return { ok: true, headers: { get: () => 'application/json' },
      text: async () => { throw Error('connection broke while reading body'); } };
    return { ok: attempts.length !== 2, status: attempts.length === 2 ? 429 : 200,
      json: async () => ({ choices: [{ message: { content: attempts.length === 4 ? css : body }, finish_reason: 'stop' }] }) };
  };
  const artifact = await generateWebsite(project(), { env, fetchImpl, sleepImpl: async ms => { delays.push(ms); }, onAttempt: status => progress.push(status) });
  assert.deepEqual(attempts, ['openrouter/free', 'good/large:free', 'good/medium:free', 'openrouter/free']);
  assert.deepEqual(delays, [3000, 6000]);
  assert.equal(artifact.model, 'openrouter/free');
  assert.equal(artifact.attempts, 4);
  assert.equal(progress.findLast(item => item.stage === 'body').attempt, 3);
  assert.equal(progress.at(-1).stage, 'css');
});

test('disabled fallback makes no extra request; free-only router handles an empty eligible catalog', async () => {
  let catalogCalls = 0;
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith('/models')) {
      catalogCalls++;
      return { ok: true, json: async () => ({ data: [model('bad/paid:free', 16000, { prompt: '1', completion: '0', request: '0' })] }) };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: '<!doctype html><html>' }, finish_reason: 'length' }] }) };
  };
  await assert.rejects(generateWebsite(project(), { env: { ...env, AI_FREE_FALLBACK: 'false' }, fetchImpl }), /truncated/);
  assert.equal(catalogCalls, 0);
  const models = [];
  const result = await withFreeFallback(async modelId => {
    models.push(modelId);
    if (modelId !== 'openrouter/free') throw Object.assign(new Error('model timed out'), { retryable: true });
    return 'ok';
  }, { env: { ...env, AI_MODEL: 'bad/selected:free' }, fetchImpl, initialTokens: 1500,
    fallbackTokens: 1500, minimumFallbackTokens: 1200, sleepImpl: async () => {} });
  assert.equal(result.value, 'ok');
  assert.deepEqual(models, ['bad/selected:free', 'openrouter/free']);
  assert.equal(catalogCalls, 1);
});

test('free-only router is attempted when catalog discovery fails', async () => {
  let attempts = 0;
  const result = await withFreeFallback(async modelId => {
    attempts++;
    if (modelId !== 'openrouter/free') throw Object.assign(new Error('timeout'), { retryable: true });
    return 'ok';
  }, { env: { ...env, AI_MODEL: 'bad/selected:free' }, fetchImpl: async () => { throw new Error('catalog down'); },
    initialTokens: 1500, minimumFallbackTokens: 1200, sleepImpl: async () => {} });
  assert.equal(result.model, 'openrouter/free');
  assert.equal(attempts, 2);
});

test('known account quota errors do not trigger free-model fallback or expose provider text', async () => {
  let catalogCalls = 0;
  const fetchImpl = async url => {
    if (new URL(url).pathname.endsWith('/models')) catalogCalls++;
    return { ok: false, status: 429, json: async () => ({
      error: { code: 'insufficient_quota', message: 'secret provider diagnostic' },
    }) };
  };
  await assert.rejects(generateWebsite(project(), { env, fetchImpl }), error => {
    assert.match(error.message, /credits or account spending limit exhausted/);
    assert.doesNotMatch(error.message, /secret provider diagnostic/);
    return true;
  });
  assert.equal(catalogCalls, 0);
});
