import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleFreeModels, freeFallbackModels, withFreeFallback } from './free-models.mjs';
import { generate, generateDiscoveryQuestions, generateWebsite } from './provider.mjs';
import { makeConsultancyProject } from './consultancy.mjs';
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

test('catalog accepts explicit free pricing without a request field and rejects unsafe candidates', () => {
  const missingRequest = model('good/missing-request:free');
  delete missingRequest.pricing.request;
  const paidRequest = model('bad/request-paid:free', 16000, { prompt: '0', completion: '0', request: '0.001' });
  const noText = model('bad/no-text:free');
  noText.architecture.output_modalities = ['image'];
  const noMaxTokens = model('bad/no-max-tokens:free');
  noMaxTokens.supported_parameters = ['temperature'];
  const models = [model('bad/paid:free', 16000, { prompt: '0', completion: '0.001', request: '0' }),
    model('bad/empty:free', 16000, { prompt: '', completion: '0', request: '0' }),
    model('bad/low:free', 4096), model('bad/no-suffix'), missingRequest, paidRequest, noText, noMaxTokens,
    model('good/large:free'), model('good/medium:free', 8192)];
  assert.deepEqual(eligibleFreeModels(models, 8000), ['good/missing-request:free', 'good/large:free', 'good/medium:free']);
  assert.deepEqual(eligibleFreeModels([missingRequest, paidRequest, noText, noMaxTokens], 3000), ['good/missing-request:free']);
  const unknown = model('bad/unknown:free');
  unknown.top_provider.max_completion_tokens = null;
  assert.deepEqual(eligibleFreeModels([unknown], 3000), []);
});

test('normal consultancy requirements use a larger task-aware budget and accept useful output', async () => {
  const project = makeConsultancyProject('A service website');
  project.discovery.status = 'approved';
  project.discovery.brief = 'Build a clear service website for a small team.';
  let requestedMaxTokens;
  const result = await generate(project, project.tasks[1], {
    env: { AI_BASE_URL: 'http://127.0.0.1:9999/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' },
    fetchImpl: async (_url, options) => {
      requestedMaxTokens = JSON.parse(options.body).max_tokens;
      return { ok: true, json: async () => ({ choices: [{ message: { content: `Requirements include user journeys, prioritized scope, acceptance criteria, constraints, risks, open decisions, and implementation notes for the team. ${'Detailed delivery guidance. '.repeat(8)}` }, finish_reason: 'stop' }] }) };
    },
  });
  assert.equal(requestedMaxTokens, 4000);
  assert.match(result, /acceptance criteria/);
});

test('short and refusal-only written output is rejected before saving a deliverable', async () => {
  const project = makeConsultancyProject('A service website');
  project.discovery.status = 'approved';
  project.discovery.brief = 'Build a clear service website for a small team.';
  const env = { AI_BASE_URL: 'http://127.0.0.1:9999/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
  const response = content => ({ ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
  await assert.rejects(generate(project, project.tasks[1], { env, fetchImpl: async () => response('Too short.') }), /too little usable content/);
  await assert.rejects(generate(project, project.tasks[1], { env, fetchImpl: async () => response(`I cannot help with that. ${'Additional content '.repeat(20)}`) }), /too little usable content/);
});

test('fallback exhaustion preserves timeout, model, cap, finish reason, usage, and retry history', async () => {
  const project = makeConsultancyProject('A service website');
  project.discovery.status = 'approved';
  project.discovery.brief = 'Build a clear service website for a small team.';
  let calls = 0;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith('/models')) return { ok: true, json: async () => ({ data: [model('free/explicit:free', 8192)] }) };
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('provider timeout'), { name: 'TimeoutError' });
    const requested = JSON.parse(options.body);
    return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({
      model: requested.model === 'free/explicit:free' ? 'free/explicit:free' : 'router/underlying:free',
      usage: { prompt_tokens: 100, completion_tokens: requested.max_tokens, total_tokens: 100 + requested.max_tokens, completion_tokens_details: { reasoning_tokens: 20 } },
      choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
    }) };
  };
  await assert.rejects(generate(project, project.tasks[1], { env: { ...env, AI_MODEL: 'free/selected:free' }, fetchImpl, sleepImpl: async () => {} }), error => {
    assert.match(error.message, /1: timeout/);
    assert.match(error.message, /2: truncated at output limit/);
    assert.match(error.message, /3: truncated at output limit/);
    assert.deepEqual(error.attemptHistory.map(item => item.reason), ['timeout', 'truncated', 'truncated']);
    assert.deepEqual(error.attemptHistory.map(item => item.requestedModel), ['free/selected:free', 'free/explicit:free', 'openrouter/free']);
    assert.equal(error.attemptHistory[1].responseModel, 'free/explicit:free');
    assert.equal(error.attemptHistory[1].requestedMaxTokens, 4000);
    assert.equal(error.attemptHistory[1].finishReason, 'length');
    assert.equal(error.attemptHistory[1].usage.completionTokens, 4000);
    return true;
  });
});

test('duplicate explicit catalog entries are not selected repeatedly', async () => {
  const duplicate = model('free/duplicate:free', 4096);
  const result = await freeFallbackModels({
    env,
    minOutputTokens: 3000,
    excluded: ['openrouter/free'],
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [duplicate, structuredClone(duplicate)] }) }),
  });
  assert.deepEqual(result, [{ id: 'free/duplicate:free', maxTokens: 4096 }, { id: 'openrouter/free', maxTokens: 3000 }]);
});

test('broken website response prefers explicit free models before the router', async () => {
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
    assert.equal(request.max_tokens, attempts.length === 3 || attempts.length >= 4 ? 1200 : 1500);
    if (attempts.length === 1) return { ok: true, headers: { get: () => 'application/json' },
      text: async () => { throw Error('connection broke while reading body'); } };
    return { ok: attempts.length !== 2, status: attempts.length === 2 ? 429 : 200,
      json: async () => ({ choices: [{ message: { content: attempts.length === 4 ? css : body }, finish_reason: 'stop' }] }) };
  };
  const artifact = await generateWebsite(project(), { env, fetchImpl, sleepImpl: async ms => { delays.push(ms); }, onAttempt: status => progress.push(status) });
  assert.deepEqual(attempts, ['openrouter/free', 'good/large:free', 'openrouter/free', 'openrouter/free']);
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

test('temporary model limits and gateway errors rotate through verified free models', async () => {
  const attempts = [];
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith('/models')) {
      return { ok: true, json: async () => ({ data: [model('free/first:free', 2048), model('paid/never:free', 16000, { prompt: '0', completion: '0.01', request: '0' }), model('free/second:free', 16000)] }) };
    }
    attempts.push(JSON.parse(options.body).model);
    if (attempts.length === 1) return { ok: false, status: 408, json: async () => ({}) };
    if (attempts.length === 2) return { ok: false, status: 425, json: async () => ({}) };
    const content = attempts.length === 3 ? body : css;
    return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) };
  };
  const artifact = await generateWebsite(project(), { env: { ...env, AI_MODEL: 'free/selected:free' }, fetchImpl, sleepImpl: async () => {} });
  assert.deepEqual(attempts, ['free/selected:free', 'free/second:free', 'free/first:free', 'free/selected:free']);
  assert.equal(artifact.model, 'free/selected:free');
});

test('invalid discovery output switches to another free model before it reaches the user', async () => {
  const attempts = [];
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith('/models')) return { ok: true, json: async () => ({ data: [model('free/questions:free', 2048)] }) };
    attempts.push(JSON.parse(options.body).model);
    const content = attempts.length === 1 ? '{bad json'
      : JSON.stringify({ questions: [
        { key: 'scope', question: 'What belongs in version one?', options: ['Core workflow', 'Core workflow plus reporting'] },
        { key: 'success', question: 'How will you measure success?', options: ['User testing', 'A target conversion rate'] },
      ] });
    return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) };
  };
  const discovery = { mode: 'consultancy', brief: 'Plan a small service website', discovery: { status: 'followup', answers: {} } };
  const result = await generateDiscoveryQuestions(discovery, 'followup', { env: { ...env, AI_MODEL: 'free/selected:free' }, fetchImpl, sleepImpl: async () => {} });
  assert.deepEqual(attempts, ['free/selected:free', 'free/questions:free']);
  assert.equal(result.model, 'free/questions:free');
  assert.equal(result.questions.length, 2);
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
