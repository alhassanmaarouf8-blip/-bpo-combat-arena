---
name: app-map
description: The token-saving map of OMNI-PERFORM — where everything lives (files, landmarks, conventions, message protocols, gates) so agents stop burning tokens re-discovering the codebase. Read FIRST on any task in this repo; grep from here instead of exploring cold.
---

# OMNI-PERFORM app map (updated 2026-07-02)

German job-interview trainer for Egyptian BPO candidates. **Frontend** React/Vite (`client/`) →
Vercel. **Backend** Node/Express (`server/`) → Render. Push to `main` = deploy BOTH. $0 pipeline:
browser mic → Deepgram STT → Groq LLM boss (Cerebras failover) → Deepgram Aura-2 / ElevenLabs TTS.
Health: `GET /health` (build field) on Render; frontend `<meta name="build">` = short git sha.

## client/src — one giant App.jsx + per-drill overlay components
**App.jsx (~4700 lines) landmarks (grep these anchors):**
- `:root {` → design tokens + global keyframes (style block ~545-660)
- `const S = {` / `const C = {` → WS message maps (server→client / client→server)
- `classifyTurnDE` → end-of-turn classification (conservative: uncertain ⇒ wait)
- `ICON_PATHS` / `function Icon` → SVG icon system (module scope, not exported)
- `stopBossVoice` / `speakBossStreamed` / `playBossVoice` / `playBossEarlySentence` /
  `continueBossLineEarly` → boss audio path (sentence-streaming: BOSS_SPEECH_EARLY starts TTS at
  ~first-token; full line splices the remainder)
- `startHandsFreeTurn` → the VAD loop: `SIL_COMPLETE/AMBIGUOUS/INCOMPLETE` windows, soft-speaker
  transcript-evidence path (`volSpoke`), classification-aware frozen-transcript backstop. OWNER-TUNED
  — do not change timing values uninvited.
- `function Debrief` → results screen: verdict → hire-readiness card (+`TRAIN_FOR_SKILL` one-tap
  drill handoff) → plan-for-today → `showDetails` toggle hiding ~17 analysis sections
- `function AuthScreen`-ish (`const rise =`) → landing (hero, CSS phone proof, glass auth card)
- home stack: STATUS STRIP → HERO CARD "Dein Interview" (segmented level, interviewer, options) →
  THE orange button → DailyMission → WeeklyBriefing/PlacementPrompt/InviteCard → Einstufung quiet
  link → GameMapCompact → "Übungen" tile grid → footer list card → HomeFeedback
- `_overlays` array → global BACK button; EVERY new overlay must register here

**Overlay convention (all drills):** `position:fixed, inset:0, zIndex:240` (Trainingslager 250,
debrief 200 — drills stack ABOVE the debrief on purpose; closing returns to results). Props:
`{ token, apiUrl, lang, onClose }` (+ onGoPricing for paid ones — server 402 → paywall).
Components: Shadowing, FluencyDrill (4-3-2), Listening (Hör-Check), SpokenReview (Sag es richtig),
PressureLadder (Druck-Leiter), DailyMission/DailyTraining, Trainingslager, VideoLessons (slide
"videos" + TTS), Alhassan (mentor chat; optional onAction chips), Assessment, BrainGuide (OFF —
masri gate), Zielplan (hidden), Trainingsnachweis, WeeklyBriefing, InviteCard, PlacementPrompt.
**nativeVoice.js**: `playNative({apiUrl, token, text, voice, onEnd})` → free TTS via
`/api/tts-stream?drill=1` (skips interview-minute gate), browser fallback. Use for ALL drill audio.

## server — Express + WS
- `websocketManager.js` (~1850): session gateway. `S`/`C` maps ~97; RealtimeClient wiring ~470-510
  (onBossSpeech/onBossEarly/onBossPartial/onBossSpeechDone); `_handleAudioEnd` (client VAD is the
  SOLE turn authority — never Deepgram speech_final); `_scoreAnswer` ~1400 (HP, funnel STAGE_AFTER
  =[2,4], ledger snapshot); session persist ~1000-1100 (p.sessions, recentErrors, lastTopics,
  weakLog); `_recordTurnLatency` (idempotent per turn; /api/diag/latency)
- `realtimeClient.js` (~700): the boss brain. PROVIDERS failover, `callBossStreaming` (SSE +
  `firstSentenceBoundary`/`earlySafeSentence` early emission), TURN_RULE (per-turn discipline),
  claim ledger `_noteClaims`/`ledgerTerms`, `threadNudge` (mechanical thread-following), warmth EMA,
  BOSS_CONFIGS + interviewer-characters.json merge, VOICES (Aura-2 per persona)
- `scenarios.js`: banks (BEHAVIORAL 16, BPO_SCREENING 10, C1 12, CS_SCENARIOS 10), rubrics,
  `buildSessionScript` (ÜBERGÄNGE/FADEN rules, dossier + AKTE memory lines, seeded INTRO_VARIANTS)
- `bossMemory.js` (+ .test.mjs): cross-session AKTE (trajectory + persistent errors + absence +
  lastTopics content memory)
- `scoring/turnQuality.js`: honesty gates (looksTruncatedDE, low-confidence quote guard) —
  feedback-accuracy doctrine enforcement; `coach.js` debrief; `hireReadiness.js` (limitingSkill ∈
  fluency|grammar|intelligibility|confidence|deescalation|complexity); `progress.js` /api/progress
- drills: daily.js, listening.js, druckLeiter.js, shadowing.js, spokenReview.js, fluencyDrill.js,
  srs.js; auth.js (plans/minutes), store.js (user profile shape), alhassan.js (mentor)

## Tests & gates (ALL must pass before done)
`npm run lint` · `npm run design-lint` · `node --test server/*.test.mjs server/scoring/*.test.mjs
server/brain/*.test.mjs` · `(cd client && npm run build)` · `node scripts/german-check.mjs <files>`
for German content (known false positives: 2 in scenarios.js C1 questions, WpM/Alhassan strings in
App.jsx). Screenshots: `node scripts/qa/screenshot.mjs [url] [--signup]` (PNGs land in the CWD you
run it from). Deploy verify: health build + vercel meta == `git rev-parse --short HEAD`.

## Hard owner rules (non-negotiable)
Zero spend ever · never name employers · no fabricated metrics · never author Arabic/masri (leave
OWNER-AR slots) · verify-by-proof · one bounded change per ship · push to main only with all gates
green (Guardian must go green; repo is public: check via api.github.com actions runs).
