// lib/openrouter.js
//
// Shared OpenRouter call helper used by both the tutor call (api/ai-teacher.js)
// and the scope classifier (lib/scopeGuard.js).
//
// Strategy: try the FREE (":free") variant of the configured model first —
// zero cost, but rate-limited (20 req/min, and a daily cap that depends on
// whether you've ever purchased $10+ in OpenRouter credits). If the free
// variant is rate-limited (429) or has been permanently retired by
// OpenRouter (404), automatically retry once on the PAID variant of the
// same model, so the AI Teacher keeps working — just at a small real cost —
// instead of breaking. A transient upstream outage (503) is NOT retried on
// paid; that's temporary and better left to resolve on its own.
//
// Set OPENROUTER_DISABLE_FREE_FALLBACK=true to always call the paid variant
// directly (skip the free attempt entirely).

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function toFreeVariant(model) {
  return model.endsWith(':free') ? model : `${model}:free`;
}

function toPaidVariant(model) {
  return model.endsWith(':free') ? model.slice(0, -':free'.length) : model;
}

// Response statuses worth retrying on the paid variant.
// 429 = rate limit hit (temporary) -> retry on paid, cheap and immediate.
// 404 = the free (:free) variant has been permanently retired by OpenRouter
//       (this happens periodically as free promos end) -> retry on paid,
//       since retrying the free slug again will never succeed.
// 503 is intentionally NOT included -> that's a transient upstream outage;
// better to surface the error and let it resolve on its own than spend
// real credits on every brief hiccup.
const FALLBACK_STATUSES = new Set([429, 404]);

/**
 * @returns {Promise<{ resp: Response, modelUsed: string, usedFallback: boolean }>}
 */
async function callOpenRouter({ apiKey, model, messages, maxTokens, temperature, referer, title }) {
  const disableFreeFallback = process.env.OPENROUTER_DISABLE_FREE_FALLBACK === 'true';
  const freeModel = toFreeVariant(model);
  const paidModel = toPaidVariant(model);
  const firstModel = disableFreeFallback ? paidModel : freeModel;

  async function attempt(modelToUse) {
    return fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(referer ? { 'HTTP-Referer': referer } : {}),
        ...(title ? { 'X-Title': title } : {}),
      },
      body: JSON.stringify({
        model: modelToUse,
        messages,
        max_tokens: maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    });
  }

  let resp = await attempt(firstModel);
  let modelUsed = firstModel;
  let usedFallback = false;

  const canFallback = !disableFreeFallback && paidModel !== freeModel;
  if (!resp.ok && canFallback && FALLBACK_STATUSES.has(resp.status)) {
    resp = await attempt(paidModel);
    modelUsed = paidModel;
    usedFallback = true;
  }

  return { resp, modelUsed, usedFallback };
}

module.exports = { callOpenRouter, toFreeVariant, toPaidVariant };
