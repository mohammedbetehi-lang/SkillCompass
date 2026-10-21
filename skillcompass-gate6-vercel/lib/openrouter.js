// lib/openrouter.js
// Uses the model exactly as configured (free or paid). No forced :free suffix.

const OPENROUTER_URL =
  'https://openrouter.ai/api/v1/chat/completions';

function toFreeVariant(model) {
  return model.endsWith(':free') ? model : `${model}:free`;
}

function toPaidVariant(model) {
  return model.endsWith(':free')
    ? model.slice(0, -':free'.length)
    : model;
}

async function callOpenRouter({
  apiKey,
  model,
  messages,
  maxTokens,
  temperature,
  referer,
  title
}) {
  // Use the configured model as-is (do NOT force a :free variant).
  const modelToUse = model;

  const resp = await fetch(OPENROUTER_URL, {
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

  return {
    resp,
    modelUsed: modelToUse,
    usedFallback: false
  };
}

module.exports = {
  callOpenRouter,
  toFreeVariant,
  toPaidVariant
};
