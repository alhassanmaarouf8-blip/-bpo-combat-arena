# AUDIT_CALLFLOOR — Call Floor Phase 1: audit, isolation plan, cost foundation (2026-07-21)

No features were built. This document + `docs/FROZEN.md` + the cost instrumentation under
`server/callfloor/` are Phase 1's entire output. **Owner go/no-go gates Phase 2.**

---

## §0 Two-mode isolation plan (RULE ZERO)

**Mode 2 home:** all Call Floor server code lives in **`server/callfloor/`**; scripts in
`scripts/callfloor/`; tables only in `server/callfloor/callfloor_schema.sql` (additive
`CREATE ... IF NOT EXISTS`, applied by Mode 2's own pg pool — `server/callfloor/db.js` imports
only the exported read-only helpers `dbEnabled`/`databaseConnectionConfig` from `server/db.js`).
No existing table gains a column; no Mode 1 file is edited.

**The feature flag:** **`CALLFLOOR_ENABLED`** (env; unset/absent = OFF). Phase 2's routes and
client entry will check it. Phase 1 code is dormant by construction: **nothing in Mode 1 imports
`server/callfloor/`** — so with the flag off (or the folder deleted) Mode 1 is byte-identical.

**Byte-identical verification recipe** (run before every Mode 2 merge):
1. `git diff main -- <every path in docs/FROZEN.md>` → MUST be empty.
2. `Select-String -Path server\*.js -Pattern "callfloor"` finds no Mode 1 import.
3. With `CALLFLOOR_ENABLED` unset: one full daily-cycle smoke on prod (interview → debrief →
   DIAGNOSE-ABGESCHLOSSEN → personal step) behaves exactly as today.

**The ONE analysis door (confirmed in code):** `startAnalysisForSession({ userId, sessionId,
input })` — `server/analysisRunner.js:91`, exported, callable from outside, fire-and-forget with
its own persisted retry queue. Input contract (exactly what the interview passes,
`websocketManager.js`): `{ dialogue, utterances:[{text,words,durationMs,stage,stageLabel,
lowConf}], metrics, level, csScenarioId }`. A finished call transcript can be shaped into this
without touching anything.
⚠ **Phase 2 design note for the owner:** this door runs the FULL chain — deep diagnosis →
`error_events` → **bottleneck selection → personal-exercise generation**. A call fed through it
doesn't just log errors; it can mint that day's bottleneck and a personal step, exactly like an
interview. That is what "errors flow into the diagnosis loop" means — but whether a CALL should
be allowed to set the daily bottleneck (vs. errors-only) is an owner call to make in the Phase 2
plan. Doing errors-only would require a second, narrower door (additive, no freeze violation).

---

## §1 Freeze manifest

`docs/FROZEN.md` — created this phase. Billing files (`plans.config.js`, `plans.js`,
`payments.js`, `paymentsStore.js`, `auth.js`, `admin.js`) are explicitly OUTSIDE the freeze
(owner decision 2026-07-21: Call Floor plans EXTEND the existing Basic/Elite system).

---

## §2 The voice + interview stack (what a call loop can reuse)

**a. Providers & pricing units** (rates + both price levels: `docs/PRICEBOOK.md`):
| Role | Provider/model | Pricing unit |
|---|---|---|
| STT (live interview) | Deepgram **nova-2 streaming**, `de` (`streamingTranscribe.js`) | per audio minute |
| STT (drills/personal step) | Groq **whisper-large-v3-turbo** (`transcribeGroq` in `transcribeRouter.js`) | per audio hour |
| Boss LLM | Groq **llama-3.3-70b-versatile** → Cerebras **gpt-oss-120b** failover (`realtimeClient.js`; non-boss consumers share `llmFailover.js`) | per token |
| TTS (boss voice) | Deepgram **Aura-2** per-persona voices; ElevenLabs = owner-approved exception for fixed cached lines | per character |
| Premium realtime | **Gemini 2.5 Flash native audio** (Live) — `geminiLive.js`/`geminiLiveProxy.js` | per token (audio/text split) |
| Grammar | LanguageTool public API | free |

**b. Turn structure (cascaded path):** browser mic → client VAD commits the turn (sole turn
authority) → Deepgram streaming transcript → `realtimeClient.respond()` (SSE, early-sentence
emission) → Aura-2 TTS streamed back → playback. **Yes — a call-style loop can reuse this
end-to-end**; it is persona-driven by prompt (BOSS_CONFIGS), so a "customer" persona is a new
prompt + scenario bank on the same pipeline, NOT new audio plumbing.

**c. Realtime vs cascaded:** BOTH exist. The default/free path is **cascaded** — and it is
already the "cheap live loop" the phase doc demands. The realtime path (Gemini native audio) is
the expensive one: allowlisted to the owner, budget-capped (`geminiBudget.js`, fail-closed,
$5/mo). **Call Floor verdict: build on the cascaded path; never put a frontier/realtime model on
a live call.**

**d. Keys/config:** all server-side env on Render — `GROQ_API_KEY`, `CEREBRAS_API_KEY`,
`DEEPGRAM_API_KEY`, `GEMINI_API_KEY` (+ `USE_GEMINI_LIVE`, `GEMINI_LIVE_EMAILS`,
`GEMINI_BUDGET_USD`), `ELEVENLABS_*`, `LANGUAGETOOL_URL`, `DATABASE_URL`.
Note: `server/.env.example` is stale (OpenAI-era) — cosmetic, not fixed (frozen-adjacent hygiene
for a later owner-approved sweep).

---

## §3 Cost instrumentation — built this phase

- **`ai_usage_events`** (Postgres via Mode 2's own pool; JSONL file fallback when
  `DATABASE_URL` is absent — EPHEMERAL on Render, flagged below). One row per AI call:
  user, feature, provider/model, units in/out, **`usd_actual` AND `usd_list`** (dual pricing —
  free tiers are a subsidy, not a cost structure; Phase 6 margins use LIST), `measured` flag
  (backfilled estimates can never masquerade as telemetry).
- **`loggedChat.js`** — the only LLM door Mode 2 code may call: wraps the existing
  `chatWithFailover` unchanged, prices from the price book, records, never lets a logging
  failure reach the caller. 11/11 unit tests green (`server/callfloor/usage.test.mjs`).
- **Price book** — `server/callfloor/pricebook.config.js` (source of truth) +
  `docs/PRICEBOOK.md` (human view). Every rate dated; `verified: code` vs `docs` distinguished.
- **Backfill** — `scripts/callfloor/backfill-usage.mjs`: reconstructs historical per-user costs
  from durable profile data (`usageDays` per-day live seconds → voice minutes; `sessions[]`
  count → analysis tokens), writes `measured=false` rows, dry-run by default, double-run guard,
  ZERO LLM calls.
- **Frozen calls that CANNOT be wrapped without modification** (per contract: leave them,
  estimate in Phase 6): the boss's own provider loop (`realtimeClient.js`), `deepDiagnosis.js`'s
  provider loop, Gemini Live (already self-metered by `geminiBudget.js` — its file is a usable
  actual-spend source), Deepgram STT/TTS calls, drill Whisper calls, coach/debrief. Their costs
  enter the model via the backfill estimates + the measured per-minute/per-cycle constants.

⚠ **Durability flag for the owner:** if `DATABASE_URL` is not set on Render, usage telemetry
falls back to a local JSONL that Render WIPES on every restart/redeploy (the 2026-07-07 13-layer
audit flagged the same risk for learner data). **Durable cost telemetry — and Phase 6's honesty —
needs the free Render Postgres attached.**
⚠ **Gate gap:** the standard verify gate globs `server/*.test.mjs server/scoring/*.test.mjs
server/brain/*.test.mjs` — it does NOT pick up `server/callfloor/*.test.mjs`. Run explicitly
until Phase 2 adds the glob to the gate command (a `package.json` edit, outside the freeze,
owner-approved with the Phase 2 plan).

---

## §4 Billing / plan inventory

- **Plans exist and are law:** `plans.config.js` — free / Basic 999 EGP / Elite 1999 EGP
  (monthly; yearly = 12-for-10), sold as FULL DAILY INTERVIEWS (2×7.5 min / 4×7.5 min hard
  daily caps, reset midnight Cairo). Owner decision 2026-07-21: **Call Floor extends THESE plans**
  (voice-minute entitlements join this config in Phase 4); no parallel system.
- **Payment rail today:** manual **Vodafone Cash** verify-first flow (`payments.js` — pending
  record → owner verifies → admin activates; `supportedPaymentRailAvailable()` gates on
  `VODAFONE_CASH_NUMBER`). Hosted checkout (**Paddle or Lemon Squeezy** — both free to set up,
  both pay out to Egypt) is the planned card rail via `PAYMENT_URL`; the self-activating webhook
  is ROADMAP item 11b (QUEUED). Processing fees (Paddle ~5% + $0.50-class) must enter COGS in
  Phase 4's ledger — at 999 EGP (~$20) that is ~6–7% of price, a visible margin bite.
- **Currency:** prices displayed/charged in EGP; costs in USD. **No EGP↔USD rate source exists
  in-app** → Phase 4 adds a configurable rate (owner-set, dated) — margin math converts at that
  pinned rate; no live FX dependency, no invented precision.

---

## §5 The numbers (measured where possible, labeled estimates elsewhere)

**Per voice minute:**
- **Gemini Live path (paid, owner-only): $0.022–0.025/min — MEASURED** 2026-07-11, 3 live probe
  interviews, billing-confirmed (`plans.config.js` unit-economics pin).
- **Cascaded path (all real users): ACTUAL $0 today** (free tiers). **LIST estimate
  ~$0.015–0.024/min, mid $0.019**, arithmetic (assumption-ranged, re-verify rates before
  Phase 6): Deepgram streaming billed on full session audio ≈ $0.0059/min; boss speaks ~½ the
  session at ~700–900 chars/spoken-min → ~350–450 chars/session-min × $0.030/1k ≈
  $0.011–0.014/min; ~1 boss turn/min ≈ 1.5–2.5k tokens in + 100–200 out at Groq list ≈
  $0.001–0.002/min.

**Per interview + analysis (the unit the plans sell):**
- Cascade at LIST: 7.5 min × $0.019 ≈ **$0.14** + deep analysis ≈ **$0.008** (½ of the measured
  21k-token daily cycle at Groq list) ≈ **~$0.15 per interview** (actual today: $0).
- Gemini path MEASURED: ≈ **$0.18–0.19 per 7.5–8-min interview** + the same analysis.
- Existing margin pin (`plans.config.js`, 07-11): worst-case 100% daily usage keeps ≥45–50%
  margin at the measured rate; realistic ~50% usage → ~73–75%. **The 80% target therefore fails
  TODAY at worst-case usage on list-rate math — exactly what Phase 6's allowance formula must
  fix (allowance sizing, price, or cheaper $/min).**

**Backfill dry-run (local file store, this machine, ACTUAL OUTPUT 2026-07-21):** 17 local dev
profiles; 1 has 11 sessions, none has recorded `usageDays` voice seconds → local estimate
**$0.08 LIST / $0 actual** (analysis tokens only). These are dev/QA profiles — **the real
backfill must run against prod Postgres** (`DATABASE_URL` set) where real learner profiles live:
`node scripts/callfloor/backfill-usage.mjs` (dry run) → `--write`. Gemini actual spend:
`geminiBudget.js`'s month file + Render env history.

**The real cost constraint Phase 2 must design around (loss-flag):** Groq's free tier is
~**100k tokens/DAY shared across ALL users**. A 3-min call ≈ 5–8 persona turns (~10–15k tokens)
+ ~10k analysis ≈ **~25k tokens → ~4 calls/day app-wide exhausts the free tier**. The Call Floor
at any real scale runs on LIST-rate Groq (still cheap: ~$0.01–0.02/call LLM) or spreads across
Cerebras — but "free today" must never be pitched as the unit economics. Margins must be computed
at LIST (the dual-price design exists for exactly this).

---

## Gap analysis → Phases 2–6

| Phase | Exists already | To build | Risks/notes |
|---|---|---|---|
| 2 Call engine | Whole cascaded voice loop; persona-by-prompt; analysis door confirmed | Scenario bank (4 quadrants), customer-persona prompts, call session manager (own WS route or reuse pattern), `call_results` table, transcript→door adapter | Bottleneck-minting design note (§0); Groq daily budget (§5); client entry needs the ONE `_overlays` wiring line in App.jsx (flagged freeze exception, owner approves in Phase 2 plan) |
| 3 Shift mode | rank/readiness engines (`hireReadiness.js`) readable | Shift queue, shift report, quadrant career profile (reads `call_results` only) | Owner ruling: job-realistic core ONLY — no random bonuses/"legendary" events/streak bonuses (anti-slop law) |
| 4 Plans/metering | `plans.config.js` + daily-minute enforcement + per-user `usageDays`; `ai_usage_events` (this phase) | Voice-minute entitlements for calls in the EXISTING config, per-user cost ledger view, admin margin view, fee lines | Billing files outside freeze; EGP↔USD pinned rate; masri = OWNER-AR slots |
| 5 Free-talk | Same loop + metering | Free-talk persona, product fact sheets | Most expensive feature; Premium-gated |
| 6 Margin engine | Price book + dual-cost telemetry + backfill (this phase) | The COGS/margin computation + allowance formula + staged prices behind owner sign-off | Needs prod backfill run + refreshed price book; 80% fails today at worst-case usage (§5) |

---

## Owner prove-it (60 seconds)
1. Open this file — check the $/min numbers match what you were told on 07-11 ($0.022–0.025).
2. Open `docs/FROZEN.md` — confirm it names the loop you consider sacred.
3. Confirm the two ⚠ items you own: set `DATABASE_URL` on Render (durable telemetry + learner
   data), and the Phase 2 design question (may a CALL set the daily bottleneck, or errors-only?).
