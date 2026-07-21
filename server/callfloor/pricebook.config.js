/**
 * pricebook.config.js — THE machine-readable price book for the margin engine (Call Floor Phase 1).
 *
 * Single source of truth for what every AI unit costs. Two prices per entry, always:
 *   - list:   the provider's PAID list rate (what the unit costs when free tiers stop scaling)
 *   - actual: what we pay TODAY (mostly 0 — Groq/Cerebras/Deepgram ride free tiers or credits)
 * Phase 6's ≥80%-margin math MUST use `list` — free tiers are a subsidy, not a cost structure.
 *
 * Every entry carries `checkedOn` + `source`. Rates drift: REFRESH THIS FILE (and regenerate
 * docs/PRICEBOOK.md) before re-running any Phase 6 pricing decision. verified:'code' means the
 * rate is pinned by shipped, tested code in this repo; verified:'docs' means read from provider
 * pricing pages and not yet re-confirmed against a live bill.
 */

// USD per single token (not per million) — matches geminiBudget.js RATE conventions.
export const PRICEBOOK = {
  // Gemini 2.5 Flash native audio (the paid Gemini Live interview path).
  // VERIFIED IN CODE: server/geminiBudget.js RATE, confirmed against ai.google.dev pricing and
  // real billing in the $5 metered harness test (delta-priced sessions matched the bill).
  'gemini:live-native-audio': {
    unitType: 'tokens',
    list:   { textIn: 0.5e-6, audioIn: 3e-6, textOut: 2e-6, audioOut: 12e-6 },
    actual: { textIn: 0.5e-6, audioIn: 3e-6, textOut: 2e-6, audioOut: 12e-6 }, // genuinely paid (capped by GEMINI_BUDGET_USD)
    checkedOn: '2026-07-11', source: 'https://ai.google.dev/gemini-api/docs/pricing (pinned in server/geminiBudget.js)',
    verified: 'code',
  },

  // Groq chat completions — the workhorse for boss turns, debrief, deep diagnosis, exercise gen.
  // TODAY: free tier, ~100k tokens/DAY budget (proven exhaustible — llmFailover.js exists because
  // of it). LIST: Groq's published paid rate for llama-3.3-70b-versatile.
  'groq:llama-3.3-70b-versatile': {
    unitType: 'tokens',
    list:   { in: 0.59e-6, out: 0.79e-6 },
    actual: { in: 0, out: 0 },                      // free tier (100k tok/day)
    checkedOn: '2026-07-21', source: 'https://groq.com/pricing (from model knowledge — re-verify before Phase 6)',
    verified: 'docs',
  },

  // Groq Whisper STT (drill/spoken-step transcription via transcribeGroq).
  'groq:whisper-large-v3-turbo': {
    unitType: 'seconds',
    list:   { perHour: 0.04 },                      // USD per audio hour
    actual: { perHour: 0 },                         // free tier
    checkedOn: '2026-07-21', source: 'https://groq.com/pricing (from model knowledge — re-verify before Phase 6)',
    verified: 'docs',
  },

  // Cerebras failover (gpt-oss-120b — the proven model on this account).
  'cerebras:gpt-oss-120b': {
    unitType: 'tokens',
    list:   { in: 0.35e-6, out: 0.75e-6 },          // approximate list — Cerebras publishes per-model
    actual: { in: 0, out: 0 },                      // free tier
    checkedOn: '2026-07-21', source: 'https://cerebras.ai/pricing (APPROXIMATE, from model knowledge — re-verify before Phase 6)',
    verified: 'docs',
  },

  // Deepgram streaming STT (the FREE cascaded interview path's ears; nova-2, de).
  'deepgram:nova-2-streaming': {
    unitType: 'seconds',
    list:   { perMinute: 0.0059 },                  // pay-as-you-go streaming
    actual: { perMinute: 0 },                       // riding free credits today
    checkedOn: '2026-07-21', source: 'https://deepgram.com/pricing (from model knowledge — re-verify before Phase 6)',
    verified: 'docs',
  },

  // Deepgram Aura-2 TTS (the boss voice on the cascaded path; per character).
  'deepgram:aura-2': {
    unitType: 'chars',
    list:   { per1kChars: 0.030 },
    actual: { per1kChars: 0 },                      // riding free credits today
    checkedOn: '2026-07-21', source: 'https://deepgram.com/pricing (from model knowledge — re-verify before Phase 6)',
    verified: 'docs',
  },

  // ElevenLabs (owner-approved paid exception; used for FIXED cached lines → amortizes to ~0).
  'elevenlabs:tts': {
    unitType: 'chars',
    list:   { per1kChars: 0.15 },                   // mid-tier estimate; plan-dependent
    actual: { per1kChars: 0 },                      // cached fixed lines; no per-user marginal cost
    checkedOn: '2026-07-21', source: 'https://elevenlabs.io/pricing (plan-dependent — re-verify before Phase 6)',
    verified: 'docs',
  },

  // LanguageTool public API (grammar checking) — free, rate-limited.
  'languagetool:public': {
    unitType: 'requests',
    list:   { perRequest: 0 },
    actual: { perRequest: 0 },
    checkedOn: '2026-07-21', source: 'https://languagetool.org (public endpoint, free)',
    verified: 'code',
  },
};

// Blended per-voice-minute reference numbers for estimates (NOT a pricing source — the audit
// derives these; kept here so the backfill and Phase 6 use the same constants).
export const VOICE_MINUTE_USD = {
  // MEASURED live 2026-07-11 (3 probe interviews, Gemini native audio, funnel-proven zero
  // fallback) — pinned in plans.config.js unit-economics comment.
  geminiLiveMeasured: { low: 0.022, high: 0.025, mid: 0.024, basis: 'measured 2026-07-11 (plans.config.js)' },
  // ESTIMATED list-rate cost of one minute on the free cascaded path (Deepgram STT full-session
  // minutes + boss TTS ~400 chars/session-min + ~1 LLM turn/min at Groq list). Arithmetic in
  // docs/AUDIT_CALLFLOOR.md §5. Actual today: $0 (all free tiers).
  cascadeListEstimate: { low: 0.015, high: 0.024, mid: 0.019, basis: 'estimated from list rates 2026-07-21 (see AUDIT_CALLFLOOR.md §5)' },
};

// Deep-analysis token footprint per full daily cycle, MEASURED from prod logs 2026-07-20
// (memory bpo-e2e-verification-0720): deep analysis ~3.9k in/5.4k out ×2 (interview +
// re-interview) + exercise generation ~1.2k in/1.0k out ≈ 21k tokens ⇒ <2¢ at Groq list rates.
export const ANALYSIS_CYCLE_TOKENS = { in: 9_000, out: 11_800, basis: 'measured prod logs 2026-07-20' };

/**
 * Price one chat-completion usage report → { usdList, usdActual }.
 * `provider` accepts llmFailover's `${name}:${model}` string; unknown models fall back to the
 * provider family's known entry (over-estimating with the family's priciest known model would be
 * better, but we have exactly one model per family today) and are flagged via `known:false` so
 * the margin engine can list unpriced calls instead of silently zeroing them.
 */
export function priceChatUsage(provider, usage) {
  const inTok  = Number(usage?.prompt_tokens)     || 0;
  const outTok = Number(usage?.completion_tokens) || 0;
  const key = String(provider || '');
  const entry = PRICEBOOK[key]
    || (key.startsWith('groq:')     ? PRICEBOOK['groq:llama-3.3-70b-versatile'] : null)
    || (key.startsWith('cerebras:') ? PRICEBOOK['cerebras:gpt-oss-120b']        : null);
  if (!entry || entry.unitType !== 'tokens' || !('in' in entry.list)) {
    return { usdList: 0, usdActual: 0, known: false, unitsIn: inTok, unitsOut: outTok };
  }
  return {
    usdList:   inTok * entry.list.in   + outTok * entry.list.out,
    usdActual: inTok * entry.actual.in + outTok * entry.actual.out,
    known: true, unitsIn: inTok, unitsOut: outTok,
  };
}

export default { PRICEBOOK, VOICE_MINUTE_USD, ANALYSIS_CYCLE_TOKENS, priceChatUsage };
