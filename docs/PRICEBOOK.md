# PRICEBOOK — what every AI unit costs (Call Floor Phase 1)

**Machine-readable source of truth: `server/callfloor/pricebook.config.js`** — the margin engine
reads THAT file; this page is the human view. Two prices everywhere:
- **LIST** = the provider's paid rate. **Phase 6's ≥80%-margin math uses LIST** — free tiers are
  a subsidy that stops scaling, not a cost structure.
- **ACTUAL** = what we pay today (mostly $0 — free tiers/credits).

⚠ **Prices drift.** Before ANY Phase 6 pricing decision: re-verify every `verified: docs` row
against the provider's live pricing page, update `checkedOn`, and regenerate this file.
`verified: code` rows are pinned by shipped, billing-confirmed code in this repo.

| Provider / model | Unit | LIST | ACTUAL today | Checked | Verified |
|---|---|---|---|---|---|
| Gemini 2.5 Flash native audio (Live interview) | tokens | text in $0.50/M · audio in $3/M · text out $2/M · audio out $12/M | same (genuinely paid, capped by `GEMINI_BUDGET_USD`) | 2026-07-11 | **code** (`geminiBudget.js`, matched real billing) |
| Groq llama-3.3-70b-versatile (boss, debrief, deep analysis, exercise gen) | tokens | $0.59/M in · $0.79/M out | $0 (free tier ~100k tok/DAY) | 2026-07-21 | docs — re-verify |
| Groq whisper-large-v3-turbo (drill STT) | audio time | $0.04/hour | $0 (free tier) | 2026-07-21 | docs — re-verify |
| Cerebras gpt-oss-120b (failover) | tokens | ~$0.35/M in · ~$0.75/M out (approx.) | $0 (free tier) | 2026-07-21 | docs — APPROXIMATE, re-verify |
| Deepgram nova-2 streaming (interview STT, de) | audio time | $0.0059/min | $0 (free credits) | 2026-07-21 | docs — re-verify |
| Deepgram Aura-2 (boss TTS) | characters | $0.030/1k chars | $0 (free credits) | 2026-07-21 | docs — re-verify |
| ElevenLabs TTS (owner-approved exception; fixed cached lines) | characters | ~$0.15/1k chars (plan-dependent) | ~$0 marginal (cache) | 2026-07-21 | docs — re-verify |
| LanguageTool public API (grammar) | request | $0 | $0 | 2026-07-21 | code (public endpoint) |

## Blended per-voice-minute reference (constants in `VOICE_MINUTE_USD`)
- **Gemini Live path — MEASURED $0.022–0.025/min** (2026-07-11, 3 live probe interviews,
  funnel-proven zero fallback; pinned in `plans.config.js`). This is the app's only genuinely
  paid path, allowlisted to the owner's account.
- **Free cascaded path — LIST estimate ~$0.015–0.024/min, mid $0.019** (arithmetic in
  `docs/AUDIT_CALLFLOOR.md` §5). ACTUAL today: $0.

## Deep analysis footprint (constant `ANALYSIS_CYCLE_TOKENS`)
~21k tokens per full daily cycle (interview + re-interview analysis + exercise generation),
**measured in prod logs 2026-07-20** ⇒ <2¢ per cycle at Groq LIST rates; $0 actual.
