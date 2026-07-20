/**
 * llmFailover.js — ONE provider chain for every non-boss LLM consumer (owner approval 2026-07-20,
 * after live sessions 2c76ea13/73a7b0e3: Groq's free 100k-tokens/day budget ran out and every
 * Groq-only consumer — debrief, L2 grammar, naturalness — silently degraded to its fallback while
 * the boss survived on its own failover).
 *
 * Chain: Groq (caller's model) → Cerebras gpt-oss-120b — the model PROVEN to exist on this
 * Cerebras account (llama-3.3-70b there 404s; provider catalogs differ, never assume). Cerebras
 * is a reasoning model: reasoning_effort low + automatic completion headroom, or the visible
 * JSON gets eaten by the thinking budget (same lesson as realtimeClient's boss config).
 *
 * Callers keep their own JSON parsing, validation guards, and fail-safe fallbacks — this module
 * only makes "one provider is down/capped" stop meaning "the feature is down".
 */

export function chatProviders(groqModel) {
  return [
    { name: 'groq',
      url:  'https://api.groq.com/openai/v1/chat/completions',
      key:  process.env.GROQ_API_KEY,
      model: groqModel,
      headroom: 0, extra: {} },
    { name: 'cerebras',
      url:  `${process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1'}/chat/completions`,
      key:  process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_FALLBACK_MODEL ?? 'gpt-oss-120b',
      headroom: 2000, extra: { reasoning_effort: 'low' } },
  ].filter((p) => p.key);
}

/**
 * chatWithFailover({ messages, temperature, maxTokens, jsonMode, timeoutMs, groqModel, tag })
 *   → { content, usage, provider, finishReason }   — first provider that answers wins.
 * Throws only when EVERY configured provider failed (callers' existing catch = their fallback).
 */
export async function chatWithFailover({ messages, temperature = 0.2, maxTokens, jsonMode = true,
  timeoutMs = 30_000, groqModel, tag = 'llm' }) {
  const providers = chatProviders(groqModel);
  if (!providers.length) throw new Error('no_llm_provider_key');
  let lastErr = null;
  for (const p of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const call = (withJson) => fetch(p.url, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({
          model: p.model, temperature, max_tokens: maxTokens + p.headroom,
          ...p.extra,
          ...(withJson ? { response_format: { type: 'json_object' } } : {}),
          messages,
        }),
      });
      let res = await call(jsonMode);
      // Unproven-provider guard: if a provider rejects JSON mode itself, retry once without —
      // the prompts already demand pure JSON and the callers' validators are the correctness gate.
      if (res.status === 400 && jsonMode) {
        const errText = await res.text().catch(() => '');
        if (/response_format|json_object/i.test(errText)) res = await call(false);
        else throw new Error(`${tag} API 400 ${errText}`.slice(0, 300));
      }
      if (!res.ok) throw new Error(`${tag} API ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
      const data = await res.json();
      if (p.name !== 'groq') console.log(`[${tag}] served by failover provider=${p.name}:${p.model}`);
      return {
        content:      data.choices?.[0]?.message?.content ?? '',
        usage:        data.usage ?? null,
        provider:     `${p.name}:${p.model}`,
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      };
    } catch (err) {
      lastErr = err;
      console.error(`[${tag}] provider=${p.name} failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`${tag}_all_providers_failed`);
}

export default { chatProviders, chatWithFailover };
