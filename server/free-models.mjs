const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const maxFallbacks = 2;

const reasonLabels = {
  timeout: 'timeout',
  transport: 'transport failure',
  read_failed: 'connection ended while reading response',
  empty_response: 'empty response',
  malformed_response: 'malformed response',
  no_text: 'no text response',
  truncated: 'truncated at output limit',
  invalid_written_output: 'invalid written output',
  invalid_discovery_output: 'invalid discovery output',
  invalid_website_output: 'invalid website output',
  auth: 'authentication or permissions',
  credits: 'provider credits unavailable',
  quota_exhausted: 'account quota exhausted',
  rate_limit: 'rate limited',
  provider_unavailable: 'provider unavailable',
  invalid_config: 'invalid provider configuration',
  http_error: 'provider HTTP error',
  provider_error: 'provider error',
};

function safeNumber(value) {
  return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const values = {
    promptTokens: safeNumber(usage.prompt_tokens),
    completionTokens: safeNumber(usage.completion_tokens),
    totalTokens: safeNumber(usage.total_tokens),
    reasoningTokens: safeNumber(usage.completion_tokens_details?.reasoning_tokens),
  };
  return Object.values(values).some(value => value !== null) ? values : null;
}

function attachHistory(error, history) {
  error.attemptHistory = history.map(item => structuredClone(item));
  return error;
}

function exhaustionError(history) {
  const summary = history.map((item, index) => `${index + 1}: ${reasonLabels[item.reason] || 'generation failed'}`).join('; ');
  const error = new Error(`AI generation failed after ${history.length} attempts. ${summary}.`);
  error.code = 'fallback_exhausted';
  return attachHistory(error, history);
}

export function isOpenRouter(base) {
  try {
    const url = new URL(base);
    return url.origin === 'https://openrouter.ai' && url.pathname.replace(/\/+$/, '') === '/api/v1';
  } catch { return false; }
}

export function eligibleFreeModels(models, minOutputTokens, excluded = []) {
  const zeroPrice = value => value != null && String(value).trim() !== '' && Number(value) === 0;
  const sorted = (Array.isArray(models) ? models : [])
    .filter(model => typeof model?.id === 'string' && model.id.endsWith(':free') && !excluded.includes(model.id)
      && zeroPrice(model.pricing?.prompt) && zeroPrice(model.pricing?.completion)
      && (model.pricing?.request == null || String(model.pricing.request).trim() === '' || zeroPrice(model.pricing.request))
      && model.architecture?.input_modalities?.includes('text') && model.architecture?.output_modalities?.includes('text')
      && Number(model.context_length) >= 12000
      && Number.isFinite(Number(model.top_provider?.max_completion_tokens))
      && Number(model.top_provider.max_completion_tokens) >= minOutputTokens
      && Array.isArray(model.supported_parameters) && model.supported_parameters.includes('max_tokens'))
    .sort((a, b) => Number(b.top_provider.max_completion_tokens) - Number(a.top_provider.max_completion_tokens)
      || Number(b.context_length) - Number(a.context_length));
  return sorted.filter((model, index) => sorted.findIndex(item => item.id === model.id) === index).map(model => model.id);
}

export async function freeFallbackModels({ env, fetchImpl, minOutputTokens, excluded = [] }) {
  const response = await fetchImpl('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${env.AI_API_KEY.trim()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('OpenRouter free-model catalog is unavailable. Retry later.');
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('OpenRouter free-model catalog returned invalid JSON.'); }
  if (!Array.isArray(payload?.data)) throw new Error('OpenRouter free-model catalog returned no model list.');
  const catalog = new Map(payload.data.filter(model => typeof model?.id === 'string').map(model => [model.id, model]));
  const models = eligibleFreeModels(payload.data, minOutputTokens, excluded).slice(0, maxFallbacks)
    .map(id => ({ id, maxTokens: Number(catalog.get(id).top_provider.max_completion_tokens) }));
  while (models.length < maxFallbacks) models.push({ id: 'openrouter/free', maxTokens: minOutputTokens });
  return models;
}

export async function withFreeFallback(run, { env, fetchImpl, initialTokens, fallbackTokens = initialTokens,
  minimumFallbackTokens = fallbackTokens, attemptTimeoutMs, onAttempt = () => {}, sleepImpl = wait }) {
  const firstModel = env.AI_MODEL?.trim();
  if (!firstModel) throw new Error('Set AI_MODEL in .env.');
  const history = [];
  let models = [{ id: firstModel, maxTokens: initialTokens }];
  for (let index = 0; index < models.length; index += 1) {
    const fallback = models[index];
    const attempt = index + 1;
    const total = maxFallbacks + 1;
    if (attempt > 1) {
      const delayMs = attempt === 2 ? 3000 : 6000;
      onAttempt({ model: fallback.id, attempt, total, phase: 'waiting', delayMs });
      await sleepImpl(delayMs);
    }
    const tokenLimit = Math.min(fallbackTokens, fallback.maxTokens);
    onAttempt({ model: fallback.id, attempt, total, phase: 'running', timeoutMs: attemptTimeoutMs || (tokenLimit > 1200 ? 120000 : 60000) });
    const metadata = {};
    try {
      const value = await run(fallback.id, tokenLimit, report => Object.assign(metadata, report));
      history.push({
        attempt,
        requestedModel: fallback.id,
        responseModel: typeof metadata.responseModel === 'string' ? metadata.responseModel : null,
        httpStatus: safeNumber(metadata.httpStatus),
        errorClass: 'completed',
        finishReason: typeof metadata.finishReason === 'string' ? metadata.finishReason : null,
        requestedMaxTokens: tokenLimit,
        usage: safeUsage(metadata.usage),
        contentState: typeof metadata.contentState === 'string' ? metadata.contentState : 'complete',
        reason: 'completed',
      });
      return { value, model: fallback.id, attempts: attempt, attemptHistory: history };
    } catch (error) {
      const reason = typeof error.code === 'string' ? error.code : 'provider_error';
      history.push({
        attempt,
        requestedModel: fallback.id,
        responseModel: typeof metadata.responseModel === 'string' ? metadata.responseModel : null,
        httpStatus: safeNumber(metadata.httpStatus),
        errorClass: reason,
        finishReason: typeof metadata.finishReason === 'string' ? metadata.finishReason : null,
        requestedMaxTokens: tokenLimit,
        usage: safeUsage(metadata.usage),
        contentState: typeof metadata.contentState === 'string' ? metadata.contentState : 'error',
        reason,
      });
      if (!error.retryable) throw attachHistory(error, history);
      if (attempt === 1) {
        if (!isOpenRouter(env.AI_BASE_URL?.trim()) || env.AI_FREE_FALLBACK?.trim().toLowerCase() === 'false') throw attachHistory(error, history);
        let candidates;
        try { candidates = await freeFallbackModels({ env, fetchImpl, minOutputTokens: minimumFallbackTokens, excluded: [firstModel] }); }
        catch { candidates = Array.from({ length: maxFallbacks }, () => ({ id: 'openrouter/free', maxTokens: minimumFallbackTokens })); }
        const seen = new Set();
        candidates = candidates.filter(item => {
          if (item.id === firstModel && item.id !== 'openrouter/free') return false;
          if (item.id === 'openrouter/free') return true;
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        if (!candidates.length) throw attachHistory(exhaustionError(history), history);
        models = [{ id: firstModel, maxTokens: initialTokens }, ...candidates];
        continue;
      }
    }
  }
  throw exhaustionError(history);
}
