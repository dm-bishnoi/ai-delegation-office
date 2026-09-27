import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { consumeTransaction, createTransaction, exchangeCode, OAuthFlowError,
  OPENROUTER_AUTH_URL, OPENROUTER_EXCHANGE_URL } from './openrouter-oauth.mjs';
import { activeProviderEnv, loadProviderSettings, publicProviderSettings, removeProvider, saveOAuthProvider, saveProvider } from './provider-settings.mjs';

test('connect transaction creates PKCE S256 challenge, one-time cookie, and official authorization URL', () => {
  const { transaction, authorizationUrl, cookie } = createTransaction(1000);
  assert.match(transaction.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const url = new URL(authorizationUrl.replace('__CALLBACK__', 'http://127.0.0.1:3001/api/providers/openrouter/callback'));
  assert.equal(url.origin + url.pathname, OPENROUTER_AUTH_URL);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), transaction.challenge);
  assert.equal(url.searchParams.get('callback_url'), 'http://127.0.0.1:3001/api/providers/openrouter/callback');
  assert.equal(cookie.httpOnly, true);
  assert.equal(url.searchParams.get('client_id'), null); // OpenRouter's flow has no client registration
  assert.equal(transaction.expiresAt - 1000, 5 * 60 * 1000);
});

test('callback validation rejects missing, unknown, reused, and expired transactions', () => {
  const store = new Map();
  const { transaction } = createTransaction();
  store.set(transaction.cookie, { verifier: transaction.verifier, expiresAt: Date.now() + 60000 });
  assert.throws(() => consumeTransaction(store, null), OAuthFlowError);
  assert.throws(() => consumeTransaction(store, 'wrong-cookie-value'), OAuthFlowError);
  assert.equal(consumeTransaction(store, transaction.cookie).verifier, transaction.verifier);
  assert.throws(() => consumeTransaction(store, transaction.cookie), OAuthFlowError); // replay after one-time use
  const expired = createTransaction();
  store.set(expired.transaction.cookie, { verifier: expired.transaction.verifier, expiresAt: Date.now() - 1 });
  assert.throws(() => consumeTransaction(store, expired.transaction.cookie), OAuthFlowError);
  // Failed consumption must not have left anything behind.
  assert.equal(store.size, 0);
});

test('code exchange sends verifier over the official endpoint and never leaks secrets in errors', async () => {
  const { transaction } = createTransaction();
  const bodies = [];
  const key = await exchangeCode('one-time-code', transaction.verifier, async (url, options) => {
    bodies.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ key: 'sk-or-oauth-returned-key' }) };
  });
  assert.equal(key, 'sk-or-oauth-returned-key');
  assert.equal(bodies[0].url, OPENROUTER_EXCHANGE_URL);
  assert.equal(bodies[0].body.code, 'one-time-code');
  assert.equal(bodies[0].body.code_verifier, transaction.verifier);
  assert.equal(bodies[0].body.code_challenge_method, 'S256');
  await assert.rejects(exchangeCode('code', transaction.verifier, async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'raw provider detail' } }) })), error => {
    assert.match(error.message, /HTTP 403|rejected/i);
    assert.doesNotMatch(error.message, /raw provider detail/);
    return true;
  });
  await assert.rejects(exchangeCode('', transaction.verifier, async () => ({ ok: true, json: async () => ({}) })), OAuthFlowError);
  await assert.rejects(exchangeCode('code', transaction.verifier, async () => { throw new Error('network down'); }), OAuthFlowError);
  await assert.rejects(exchangeCode('code', transaction.verifier, async () => ({ ok: true, json: async () => ({ key: 42 }) })), OAuthFlowError);
});

test('OAuth connection stores the key encrypted, exposes nothing publicly, and removes cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-oauth-'));
  const file = join(dir, 'providers.json');
  const secret = join(dir, 'provider.key');
  try {
    let settings = await loadProviderSettings(file);
    settings = await saveOAuthProvider(settings, { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: 'oauth-secret-key' }, file, secret);
    const saved = await readFile(file, 'utf8');
    assert.doesNotMatch(saved, /oauth-secret-key/);
    const published = JSON.stringify(publicProviderSettings(settings, {}));
    assert.doesNotMatch(published, /oauth-secret-key/);
    assert.match(published, /viaOAuth/);
    assert.equal(settings.activeId, settings.providers[0].id);
    assert.equal(settings.providers[0].viaOAuth, true);
    assert.equal(settings.providers[0].freeFallback, true);
    settings = removeProvider(settings, settings.providers[0].id);
    assert.equal(settings.providers.length, 0);
    assert.equal(settings.activeId, null);
    await assert.rejects(saveOAuthProvider(settings, { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: '' }, file, secret), /usable key/);
    await assert.rejects(saveOAuthProvider(settings, { baseUrl: 'https://openrouter.ai/api/v1', model: '', apiKey: 'k' }, file, secret), /model/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('OAuth connect updates the single existing OpenRouter record instead of duplicating it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-oauth-dedup-'));
  const file = join(dir, 'providers.json');
  const secret = join(dir, 'provider.key');
  try {
    let settings = await loadProviderSettings(file);
    settings = await saveProvider(settings, { name: 'My OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'old/model:free', apiKey: 'manual-key' }, file, secret);
    const manualId = settings.providers[0].id;
    settings = await saveOAuthProvider(settings, { baseUrl: 'https://openrouter.ai/api/v1', model: 'new/model:free', apiKey: 'oauth-key' }, file, secret);
    assert.equal(settings.providers.length, 1); // no duplicate
    assert.equal(settings.providers[0].id, manualId); // same record kept
    assert.equal(settings.providers[0].name, 'My OpenRouter'); // name preserved
    assert.equal(settings.providers[0].viaOAuth, true);
    assert.equal(settings.providers[0].model, 'new/model:free');
    assert.equal(settings.activeId, manualId);
    const stored = await readFile(file, 'utf8');
    assert.doesNotMatch(stored, /oauth-key|manual-key/);
    const env = await activeProviderEnv(settings, {}, secret);
    assert.equal(env.AI_API_KEY, 'oauth-key'); // credential replaced
    // Reconnect remains idempotent: same single record again.
    settings = await saveOAuthProvider(settings, { baseUrl: 'https://openrouter.ai/api/v1', model: 'newer/model:free', apiKey: 'oauth-key-2' }, file, secret);
    assert.equal(settings.providers.length, 1);
    assert.equal(settings.providers[0].id, manualId);
    assert.equal((await activeProviderEnv(settings, {}, secret)).AI_API_KEY, 'oauth-key-2');
    // Unrelated provider untouched by the OpenRouter replacement.
    settings = await saveProvider(settings, { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'small', apiKey: '' }, file, secret);
    const before = structuredClone(settings.providers.find(item => item.name === 'Ollama'));
    settings = await saveOAuthProvider(settings, { baseUrl: 'https://openrouter.ai/api/v1', model: 'newest:free', apiKey: 'oauth-key-3' }, file, secret);
    assert.deepEqual(settings.providers.find(item => item.name === 'Ollama'), before);
    assert.equal(settings.providers.filter(item => item.baseUrl === 'https://openrouter.ai/api/v1').length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
