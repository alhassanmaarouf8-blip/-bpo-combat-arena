# FROZEN.md — the Mode 1 freeze manifest (Call Floor Phase 1, 2026-07-21)

**MODE 1 = the entire existing app — the daily feedback loop (interview → deep diagnosis →
ONE bottleneck → personal exercises → gated re-interview → Akte mastery). It is FINISHED.
No file below may be modified by Call Floor (Mode 2) work. Ever.**

## The contract (verbatim, from the owner's phase document)
> Mode 2 (Call Floor) may only READ Mode 1 data and may only WRITE new error_events by calling
> Mode 1's existing analysis entry point from outside. No Mode 1 file may be modified, and no
> existing table may gain columns. Mode 2 lives only in its own new files and new tables.

The one allowed door: **`startAnalysisForSession({ userId, sessionId, input })`**
(`server/analysisRunner.js:91`) — exported, fire-and-forget, transcript-carrying
(`input = { dialogue, utterances[], metrics, level, csScenarioId }`), runs the whole chain
(deepDiagnosis → error_events → bottleneck → exercise generation) with its own retry queue.
Mode 2 calls it from outside; it never reaches behind it.

**Isolation proof recipe** (run before any Mode 2 merge): with `CALLFLOOR_ENABLED` unset,
`git diff main -- <every path below>` must be EMPTY, plus one full daily-cycle smoke on prod
(interview → debrief → DIAGNOSE banner → personal step) behaving exactly as today.

## Frozen server files (the daily loop)
- **Interview gateway + boss:** `websocketManager.js`, `realtimeClient.js`, `scenarios.js`,
  `interviewer-characters.json`, `claimLedger.js`, `bossMemory.js`, `bossVariety.js`,
  `naturalness.js`, `naturalnessWiring.js`, `streamingTranscribe.js`, `transcribeDeepgram.js`,
  `transcribeRouter.js`, `geminiLive.js`, `geminiLiveProxy.js`, `geminiAudio.js`,
  `geminiBudget.js`, `audioGuard.js`, `speechExpandDE.js`, `langGuard.js`, `transcriptGuard.js`,
  `latencyLog.js`, `mediaTickets.js`
- **Analysis chain (the door and everything behind it):** `analysisRunner.js`,
  `analysisRoutes.js`, `analysisStore.js`, `deepDiagnosis.js`, `coach.js`, `grammarCheck.js`,
  `grammarLLM.js`, `grammarProvenance.js`, `errorTags.js`, `idiolect.js`
- **Choose + prescribe:** `bottleneckSelector.js`, `bottleneckStore.js`, `exerciseGenerator.js`,
  `personalStep.js`, `srs.js`, `planGuide.js`, `guideStore.js`, `salmaCoach.js`,
  `salmaCoachCore.js`, `progression.js`, `hireReadiness.js`, `firstSessionTrace.js`
- **`server/brain/` (all):** `adapter.js`, `bkt.js`, `drillSeries.mjs`, `elo.js`, `engine.js`,
  `problemRank.js`, `skillGraph.js`
- **`server/scoring/` (all):** `diagnosticTruth.js`, `entryInteractionEvidence.js`,
  `errorTaxonomy.js`, `forecastEvidence.js`, `l1Errors.js`, `panelscorer.mjs`,
  `roleplayTurnScoring.js`, `serviceRecoveryEvidence.js`, `speakingMeasurement.js`,
  `structureWins.js`, `transferProofs.js`, `turnQuality.js`, `scoreFactors.js` (root)
- **Drills:** `daily.js`, `listening.js`, `listeningEvidence.js`, `druckLeiter.js`,
  `shadowing.js`, `spokenReview.js`, `fluencyDrill.js`, `satzbauSchmiede.js`,
  `trainingslager.js`, `trainingslagerContent.js`, `pronunciation*.js`, `assessment.js`,
  `assessmentRamp.mjs`, `skillDials.mjs`, `drillEvidence.js`
- **Shared infra (Mode 2 imports read-only, never edits):** `db.js`, `store.js`, `time.js`,
  `llmFailover.js`, `server.js`, `weakness_db_schema.sql`
- **All `*.test.mjs` pinning the above.**

## Frozen client surfaces
`client/src/App.jsx` (interview / debrief / home loop), `PersonalStep.jsx`, `BrainGuide`,
`ProblemRankPanel.jsx`, `Assessment.jsx`, `SpokenReview.jsx`, and every drill overlay listed in
the app-map. (Phase 2+ adds Call Floor as NEW components registered alongside — a new overlay
entry in `_overlays` will be proposed as the single, owner-approved wiring exception, since the
global BACK contract physically lives in App.jsx. Until the owner approves that line, Mode 2
touches no client file.)

## Named wiring exceptions (Phase 2, 2026-07-21 — the ONLY Mode 1 lines Mode 2 may own)
Every "alongside" mode needs an entry point; these are the two, each flag-gated and inert when
`CALLFLOOR_ENABLED` is off (test-pinned: flag off ⇒ the API answers the catch-all's identical 404):
1. `server/server.js` — one import + one `app.use('/api', callfloorRouter)` line.
2. `client/src/main.jsx` — the `?callfloor` param branch (lazy chunk; mirrors the shipped
   `?feedback` pattern; App.jsx and the protected home are untouched).
Anything beyond these two lines in any frozen file is a violation, not an extension.

## Explicitly OUTSIDE the freeze (owner decision, 2026-07-21)
Billing/plan files — `plans.config.js`, `plans.js`, `payments.js`, `paymentsStore.js`,
`auth.js` (entitlements), `admin.js` — because the owner ruled that Call Floor plans EXTEND the
existing Basic/Elite system (no parallel plan machinery). Phase 4 edits these under its own
approval; they are still Two-Laws-gated like everything else.

## Existing tables that may not gain columns
`kv_store`, `weakness_taxonomy`, `error_events`, `weakness_profile`. Mode 2 tables live only in
`server/callfloor/callfloor_schema.sql` (`ai_usage_events` now; `call_results` in Phase 2).
