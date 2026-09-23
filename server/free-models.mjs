const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function isOpenRouter(base) {
  try {
    const url = new URL(base);
    return url.origin === 'https://openrouter.ai' && url.pathname.replace(/\/+$/, '') === '/api/v1';
  } catch { return false; }
}

// Verify current catalog pricing before every fallback. An unknown output limit is tried only at 1200 tokens.
export function eligibleFreeModels(models, minOutputTokens, excluded = []) {
  const freePrice = value => value != null && String(value).trim() !== '' && Number(value) === 0;
  return (Array.isArray(models) ? models : [])
    .filter(model => typeof model?.id === 'string' && model.id.endsWith(':free') && !excluded.includes(model.id)
      && ['prompt', 'completion', 'request'].every(field => freePrice(model.pricing?.[field]))
      && model.architecture?.input_modalities?.includes('text') && model.architecture?.output_modalities?.includes('text')
      && Number(model.context_length) >= 12000
      && (model.top_provider?.max_completion_tokens == null ? minOutputTokens <= 1200
        : Number(model.top_provider.max_completion_tokens) >= minOutputTokens)
      && (!Array.isArray(model.supported_parameters) || model.supported_parameters.includes('max_tokens')))
    .sort((a, b) => (Number(b.top_provider?.max_completion_tokens) || 0) - (Number(a.top_provider?.max_completion_tokens) || 0)
      || b.context_length - a.context_length)
    .map(model => model.id);
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
  const eligible = eligibleFreeModels(payload.data, minOutputTokens, excluded).slice(0, 2);
  return eligible.map(id => ({ id, maxTokens: Number(payload.data.find(model => model.id === id).top_provider?.max_completion_tokens) || 1200 }));
}

export async function withFreeFallback(run, { env, fetchImpl, initialTokens, fallbackTokens = initialTokens,
  minimumFallbackTokens = fallbackTokens, attemptTimeoutMs, onAttempt = () => {}, sleepImpl = wait }) {
  const firstModel = env.AI_MODEL?.trim();
  if (!firstModel) throw new Error('Set AI_MODEL in .env.');
  onAttempt({ model: firstModel, attempt: 1, total: 3, phase: 'running', timeoutMs: attemptTimeoutMs || (initialTokens > 1200 ? 120000 : 60000) });
  try { return { value: await run(firstModel, initialTokens), model: firstModel, attempts: 1 }; }
  catch (firstError) {
    if (!firstError.retryable || !isOpenRouter(env.AI_BASE_URL?.trim()) || env.AI_FREE_FALLBACK?.trim().toLowerCase() === 'false') throw firstError;
    let models;
    try { models = await freeFallbackModels({ env, fetchImpl, minOutputTokens: minimumFallbackTokens, excluded: [firstModel] }); }
    catch (error) { throw new Error(`${firstError.message} ${error.message}`); }
    if (!models.length) throw new Error(`${firstError.message} No zero-price free text fallback is available for a ${minimumFallbackTokens}-token request. Choose another model in AI connections or retry later.`);
    let lastError = firstError;
    for (const [index, { id: model, maxTokens }] of models.entries()) {
      const attempt = index + 2;
      const delayMs = attempt === 2 ? 3000 : 6000;
      onAttempt({ model, attempt, total: models.length + 1, phase: 'waiting', delayMs });
      await sleepImpl(delayMs);
      const tokenLimit = Math.min(fallbackTokens, maxTokens);
      onAttempt({ model, attempt, total: models.length + 1, phase: 'running', timeoutMs: attemptTimeoutMs || (tokenLimit > 1200 ? 120000 : 60000) });
      try { return { value: await run(model, tokenLimit), model, attempts: attempt }; }
      catch (error) {
        lastError = error;
        if (!error.retryable) throw error;
      }
    }
    throw new Error(`Free-model fallback exhausted after ${models.length + 1} attempts. Last error: ${lastError.message}`);
  }
}
