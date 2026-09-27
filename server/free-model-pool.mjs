// Server-side verified free-model pool for OpenRouter connections.
//
// Pipeline after a successful connection (OAuth or manual key):
// 1. fetch the OpenRouter catalog (official `GET /api/v1/models` endpoint)
// 2. filter with the same strict eligibility rules used for runtime fallback
// 3. run a bounded number of tiny deterministic health probes ("Reply with
//    exactly: OK", <=16 output tokens, 8s timeout) -- never real project prompts
// 4. keep up to `poolLimit` healthy models in the provider record
//
// The pool stores only safe metadata (id, verifiedAt, maxOutputTokens, status).
// Keys stay exclusively in the existing encrypted credential field.

import { eligibleFreeModels } from './free-models.mjs';

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const POOL_LIMIT = 3;
export const PROBE_LIMIT = 8; // at most 8 tiny probes per refresh, then stop
export const POOL_TTL_MS = 15 * 60 * 1000;

/** Minimal deterministic probe; never contains project or user data. */
const PROBE_PROMPT = 'Reply with exactly: OK';

export function poolFresh(pool, now = Date.now()) {
  return Array.isArray(pool) && pool.length > 0 && pool.every(item => typeof item?.verifiedAt === 'string') && now - Date.parse(pool[0].verifiedAt) < POOL_TTL_MS;
}

/**
 * Runs one tiny health probe. Returns { ok, status } -- classification uses
 * only HTTP status and whether any usable text came back; probe output is
 * never stored or surfaced beyond the boolean.
 */
export async function probeModel(modelId, { apiKey, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const response = await fetchImpl(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: PROBE_PROMPT }], max_tokens: 16, temperature: 0, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return { ok: false, status: response.status };
    let payload;
    try { payload = await response.json(); }
    catch { return { ok: false, status: response.status }; }
    const text = payload?.choices?.[0]?.message?.content;
    return { ok: typeof text === 'string' && text.trim().length > 0, status: response.status };
  } catch (error) {
    return { ok: false, status: error?.name === 'TimeoutError' ? 0 : -1 };
  }
}

function classify(status) {
  if (status === 0) return 'timeout';
  if (status === -1) return 'unavailable';
  if (status === 429 || status === 425) return 'rate_limited';
  if (status === 402) return 'quota_unavailable';
  if (status >= 500) return 'unavailable';
  if (status === 401 || status === 403) return 'unsuitable';
  if (status >= 400) return 'invalid_response';
  return 'invalid_response';
}

/**
 * Refreshes the verified pool: catalog -> strict filter -> bounded probes.
 * Stops as soon as `POOL_LIMIT` healthy models are verified. Never throws for
 * individual model failures; a fully failed run returns { pool: [], note }.
 */
export async function refreshVerifiedFreeModels({ apiKey, fetchImpl = fetch, minOutputTokens = 1200, now = Date.now() } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Connect an OpenRouter key before discovering models.');
  let payload;
  try {
    const response = await fetchImpl(CATALOG_URL, {
      headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`OpenRouter model catalog returned HTTP ${response.status}. Retry later.`);
    payload = await response.json();
  } catch (error) {
    if (error instanceof Error && /OpenRouter model catalog/.test(error.message)) throw error;
    throw new Error('Could not reach the OpenRouter model catalog. Retry later.');
  }
  if (!Array.isArray(payload?.data)) throw new Error('OpenRouter model catalog returned no model list.');
  const catalog = new Map(payload.data.filter(model => typeof model?.id === 'string').map(model => [model.id, model]));
  const candidates = eligibleFreeModels(payload.data, minOutputTokens).slice(0, PROBE_LIMIT);
  const pool = [];
  const checked = [];
  for (const id of candidates) {
    if (pool.length >= POOL_LIMIT) break;
    const entry = catalog.get(id);
    const { ok, status } = await probeModel(id, { apiKey, fetchImpl });
    const statusLabel = ok ? 'healthy' : classify(status);
    checked.push({ id, status: statusLabel });
    if (ok) pool.push({ id, verifiedAt: new Date(now).toISOString(), maxOutputTokens: Number(entry?.top_provider?.max_completion_tokens) || minOutputTokens, status: 'healthy' });
  }
  const note = pool.length ? `${pool.length} verified free model${pool.length === 1 ? '' : 's'} available.` : 'No verified free model is currently available; openrouter/free remains a last-resort fallback.';
  return { pool, checked, note };
}
