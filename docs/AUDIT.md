# Codebase Audit — Interview → Diagnosis → Exercise → Retest Pipeline

**Date:** 2026-07-20 · **Phase:** investigation only, no code changed · **HEAD at audit:** `7a98ec7`

Purpose: map exactly how the daily interview, its analysis, the results-screen CTA, the exercise
system, and the data layer work today — then a gap analysis against the wanted pipeline:
*interview → deep diagnosis of ALL errors → deliberate choice of ONE biggest bottleneck →
live-generated personalized exercise block → re-interview that retests exactly that bottleneck.*

---

## 1. Interview transcript: capture and storage

**Capture (in-memory, per session).** The WebSocket gateway `server/websocketManager.js` holds a
per-session `ctx` with two transcript buffers, initialized at `websocketManager.js:333-334`:

- `ctx.utterances` — candidate-only sentences for the debrief
- `ctx.dialogue` — the FULL ordered exchange (boss question → candidate answer)

They are filled in `_scoreAnswer(ctx, transcript, …)` (`websocketManager.js:2149`): every
transcribed utterance with ≥2 words is pushed at `:2174` (utterances) and `:2185` (dialogue).
Stored per utterance: `{ text, words, durationMs, stage, stageLabel, spokenEvidence, lowConf }` —
`lowConf` is the list of words Deepgram was unsure about (never quoted back to the learner).
Boss turns are pushed into `dialogue` at `:749` (Groq text path) and `:881` (Gemini Live path).

**Storage (persisted).** At session end, `_endSession` (`:1363`) → `_finishSession` (`:1395`) →
`_persistProgress` (`:1465`) writes ONE session record via `p.sessions.push(...)`
(`websocketManager.js:1569-1639`). The record contains **metrics and derived analysis only — the
raw transcript is NOT persisted**:

```
{ date, sessionId, level, bossId, fluency, wpm, fillers, subClauseRate?, vocabDiversity?,
  giveUpRate?, deescalation?+evidence, entryInteractionEvidence?, intelligibility?, latencyS?,
  c1Hits, konjunktivHits, connectorHits, answers, words, evidenceQuality, vocabTotal, xpGained,
  rank, verdict, jobLabel, priorityFix, targetRoleType, scenarioId?,
  errorTags: [...canonical ruleIds...],
  grammarRules: [{ ruleId, rule, count }] }   // per-session grammar errors, canonical + LT name
```

Also persisted per session: SRS items created from each grammar error's wrong/right pair
(`:1508-1526`), `p.recentErrors` (top 3 error labels, `:1646-1650`), `p.lastTopics` (claim-ledger
content memory, `:1656-1659`), the `p.weakLog` per-rule event spine (`:1664-1672`), and
`p.lastTargetRule` (`:1675-1680`). A small "carry the proof" debrief snapshot (≤2 corrections as
display fragments + one structure win) is stored for the home screen (`:1688-1709`).

> **Key fact for the new pipeline:** `ctx.utterances`/`ctx.dialogue` die with the socket. After the
> debrief is generated, the full transcript is gone forever — a deeper re-diagnosis later is
> impossible today.

Honesty gates: a session below `MIN_REAL_ANSWERS=1` / `MIN_REAL_WORDS=8` (`:205-206`) produces no
debrief and persists nothing; an anti-farm gate (`:1476-1500`) additionally requires trusted
spoken evidence before XP/streak/rank count.

## 2. Post-interview analysis: where, prompt, output

**Call site:** `_finishSession` → `generateDebrief({utterances, dialogue, history, metrics, level,
csScenarioId})` (`websocketManager.js:1427-1434`), implemented in **`server/coach.js:99`**.

**Pipeline inside `generateDebrief`:**
1. **LanguageTool** grammar check — `buildGrammar(utterances)` (`server/grammarCheck.js`), HTTP API
   `LANGUAGETOOL_URL` (defaults to the free public `api.languagetool.org/v2/check`), de-DE, with
   speech-transcript noise categories skipped (TYPOS/CASING/PUNCTUATION…).
2. **L2-aware LLM grammar check** — `buildGrammarLLM(utterances)` (`server/grammarLLM.js`), Groq
   `GROQ_GRAMMAR_MODEL ?? llama-3.3-70b-versatile`, targeting Arabic-L1 error classes (verb-final,
   case, aux haben/sein, gender, adjective endings) under hard guards (verbatim-quote gate,
   no-change gate, truncation gate). Merged with LT via `mergeGrammarSources`
   (`grammarProvenance.js`); LLM is primary, LT supplement (`coach.js:119-128`).
3. **Honesty gate** — `sessionSubstance` (`coach.js:135-143`): too thin/interrupted → metrics-only
   fallback debrief, no per-answer critique.
4. **The coach LLM call** — `coach.js:180-194`: Groq chat completions,
   `GROQ_COACH_MODEL ?? llama-3.3-70b-versatile`, temperature 0.2, `max_tokens: 3200`, JSON mode.
   `SYSTEM_PROMPT` at `coach.js:28-97` (bilingual DE + Egyptian-Arabic, conservative-correction
   rules). User message = level + scenario + deterministic metrics + the full B:/K: dialogue +
   per-answer pace. A `naturalness` evaluator runs in parallel (`naturalness.js`, also Groq 70B).

**Returned structure** (after `normalize()` shaping at `coach.js:295` + anti-fabrication guards at
`:237-253` that drop any quote not verbatim in the transcript):

```
{ grammar:[{rule, count, explanation, explanation_ar, summaryExamples≤2, allExamples}],
  strengths[≤4] + _ar, studyNext[≤4], vocabTargets[≤6], upgrades[≤4],
  answerArchitecture{label,de,ar}, deliveryConfidence{label,de,ar},
  priorityFix{de,ar},                  // THE one-sentence "do this now"
  interviewReview[≤4]{frage, deinSatz, stark, luecke, fixDerEinstellt, ..._ar},
  lesson (deterministic, buildLesson :431), drills (≤3 templated repair cards, buildDrills :491),
  metrics, progressNarrative (deterministic, :406), naturalness, generated:true }
```

The gateway then attaches `l1Pattern` (deterministic Arabic-L1 detector, `scoring/l1Errors.js`),
`structureWins`, `result` (rank/verdict via `_computeResult` → `hireReadiness.js`), `progress`, and
`nextTime` and sends it as one `DEBRIEF` WS message (`websocketManager.js:1457-1461`).

**Where the owner's observed "~2 sentences + 1–2 corrections + NÄCHSTES MAL" comes from:**
- The corrections ("einer regelmäßige Nutzer → einen regelmäßigen Nutzer") = `grammar[].summaryExamples`
  display fragments — capped at 2 per rule, max 5 rules, conservative by design.
- The short feedback = `priorityFix` + the compact verdict card. The Debrief screen
  (`client/src/App.jsx`, `function Debrief`) hides ~17 richer analysis sections (interviewReview,
  upgrades, naturalness, …) behind a `showDetails` toggle — **much of the depth already exists but
  is not surfaced**.
- The "NÄCHSTES MAL" line (`App.jsx:2294-2298`) renders `data.nextTime.targetWeakRule`, which is set
  from `ctx.targetWeakRule` (`websocketManager.js:595`) = the Salma retest grammar rule or
  `topWeakRule(profile)` (`:185-190`) = the **raw rule NAME of the most-lapsed unmastered SRS
  grammar item**. When the stored rule is a LanguageTool description like "Evtl. passen Wörter
  grammatisch nicht zusammen", that vague string is shown verbatim. That is exactly the observed
  symptom.

## 3. "PERSÖNLICHEN SCHRITT ÖFFNEN" — the full click path

- Button: `client/src/App.jsx:2363`, inside `function Debrief`, wired to the `onDone` prop.
- Mount: `<Debrief … onDone={handleDebriefDone} …>` at `App.jsx:6063`.
- `handleDebriefDone` (`App.jsx:5538-5549`): stops boss audio, clears
  `debrief/debriefPending/funnel`, closes the WebSocket, `setPhaseSync('idle')`.

**It opens nothing specific.** It is a teardown-and-route-home: phase `idle` renders the home
screen, where `<BrainGuide …>` (`App.jsx:6264`) fetches the server-computed next step and displays
the actual "personal step" (drill dose / wait window / retest / interview — see §4). So the button
label promises a personal step; the click just lands on home and relies on BrainGuide to show one.
There is no deep link into a specific drill and no handoff of this debrief's diagnosis through the
click (the drill handoff exists separately as `TRAIN_FOR_SKILL` inside the hire-readiness card).
A regression test pins the button's existence (`server/salmaCoachClientRegression.test.mjs:301`).

## 4. The exercise system today

**Content sourcing — three kinds, none live-generated:**

| Drill | Content source | File |
|---|---|---|
| SAG ES RICHTIG (SpokenReview) | **Learner's own errors** — SRS items seeded at interview persist from `debrief.grammar` wrong/right pairs; drill makes them SAY the correction; grading deterministic (target token present in Groq-Whisper transcript). No LLM authoring at drill time. | `server/spokenReview.js` (routes `:16-17`), `server/srs.js` (1→3→7→14→30-day schedule) |
| Daily drill | Learner's own SRS/weakness items, templated | `server/daily.js` |
| Shadowing, Flow-Drill (4-3-2), Hör-Check, Druck-Leiter, Satzbau-Schmiede, Trainingslager | **Static banks, same for everyone**; deterministic scoring servers (`shadowing.js`, `druckLeiter.js`, `fluencyDrill.js`, `listening.js`) add honest transcript-based credit | per-drill server files + client overlays |

The `drills` cards inside the debrief itself (`coach.js:491-510`) are **templated** repair cards
("Sag es richtig: „…"") built from the grammar examples — not generated exercises.

**Prescription layer (Salma coach).** `server/salmaCoachCore.js` is a full prescription engine:
allowed drills (`DRILLS` set, `:19`), fixed dose `PROTOCOLS` per drill (repetitions, duration,
spacing, success gate — `:52-60`), criterion→skill mapping restricted to exactly-measurable
criteria (`ACTIONABLE_FORECAST_CRITERIA`, `EXACT_CRITERION_SKILLS`), and retest timing
(`SPEAKING_MATCHED_RETEST_DELAY_MS = 24h`, `SPEAKING_TRANSFER_RETEST_DELAY_MS = 7d`, `:49-50`).
When a `sag-es-richtig` prescription is active, `targetedSpokenReviewQueue`
(`spokenReview.js:62-95`) serves exactly the dose's cards, including a repair-debt queue.

**Server-side completion confirmation** ("Der Abschluss ist serverseitig bestätigt",
`client/src/BrainGuide.jsx:183`): drills POST `/api/drill-event`
(`server/progress.js:137-193`). Receipt-protected drills must present a server-issued
`evidenceReceipt` (`drillEvidence.js`) or get `422 verified_drill_evidence_required`. Events land
on the same canonical `p.weakLog[ruleId]` spine the interview writes (rule names canonicalized via
`classifyGrammar`), and feed `recordDrillOutcome` → `p.salmaCoach.coachState.completedBlocks` /
dose progress. BrainGuide's step machine (`BrainGuide.jsx:121-185`) renders drill-dose / wait /
measure / retest / interview states from the server's decision.

## 5. Data layer

- **Storage:** `server/store.js` — one JSON blob per user through `loadUser()/saveUser()/mutateUser()`.
  With `DATABASE_URL` set (Render free Postgres), `server/db.js` backs it with **one JSONB KV table**
  `kv_store(namespace, key, value, updated_at)`; without it, files under `server/data/users/`.
  Namespaces: `profile` (per-user), `auth/store` (accounts), `feedback/all`. There are **no
  relational tables** for interviews/errors/exercises — everything lives inside the profile blob.
- **Profile shape:** `defaultProfile` (`store.js:43-106`). Relevant members: `sessions[]` (§1),
  `srs[]` (errors→production tasks), `weakLog{ruleId→{errCounts[],drills[]}}` (the per-weakness
  event spine), `vocabLearned`, `masteredRules`, `recentErrors`, `lastTopics`, `lastTargetRule`,
  streak inputs (`lessonDays`, `dailyDays`, sessions dates → `computeStreak`), `liveUsage`/
  `usageDays` (minute caps), `assessmentResult`, `placement`, `vacancyTarget`,
  `outcomeCalibration`, and **`salmaCoach` (v4)**: `activePrescription`, `coachState`
  (`repeatedErrorCounts`, `completedBlocks`, `lastRetestSessionId`, `improvementHistory`).
- **"Akte bleibt offen / wird erneut geprüft" mechanic:** the debrief's `nextTime.targetWeakRule`
  (§2) promises the re-check; the NEXT interview delivers it: session setup
  (`websocketManager.js:564-601`) loads the profile, asks `salmaRetestTarget` for a due
  matched/transfer retest (locks boss + level to the baseline envelope, `:578-587`), else falls
  back to `dossier = topWeakRule(prof)`. `buildSessionScript` injects it into the boss system
  prompt: the open "GEZIELTER WIEDERHOLUNGSTEST" dossier line (`scenarios.js:977-987` — the boss
  must engineer a moment forcing exactly that weakness) and the covert "VERDECKTER
  WIEDERHOLUNGSTEST" probe (`scenarios.js:992-996`). Cross-session interviewer memory (trajectory,
  persistent errors, absence) comes from `server/bossMemory.js`.

## 6. LLM providers, keys, cost per analysis

- **Interview boss (live turns):** `server/realtimeClient.js` — provider chain with 429 failover
  (`PROVIDERS`, `:50+`): Groq `GROQ_INTERVIEW_MODEL ?? llama-3.3-70b-versatile` primary, Cerebras
  `gpt-oss-120b` failover (active only if `CEREBRAS_API_KEY` set). Max 140 tokens/turn. Premium
  voice path: Gemini Live (`geminiLive.js`, `GEMINI_BUDGET_USD` guard). STT: Deepgram streaming
  (interview) / Groq `whisper-large-v3` (drills). TTS: Deepgram Aura-2 / ElevenLabs (owner-approved
  exception) / Gemini-TTS for Salma.
- **Post-interview analysis:** 3 Groq chat calls (coach ~3.2k-token budget + grammarLLM +
  naturalness) + 1 free LanguageTool HTTP call. All on `GROQ_API_KEY`.
- **Keys:** backend env only (Render dashboard): `GROQ_API_KEY` (+ optional `GROQ_COACH_MODEL`,
  `GROQ_GRAMMAR_MODEL`, `GROQ_TRANSCRIBE_MODEL`, `GROQ_INTERVIEW_MODEL`, `INTERVIEW_API_KEY/BASE_URL`),
  `CEREBRAS_API_KEY`, `LANGUAGETOOL_URL`, `DATABASE_URL`, `DEEPGRAM_*`, `GEMINI_*`, `ELEVENLABS_*`.
  Client ships no keys. Entry point `server/server.js` mounts the routers.
- **Cost per analysis today: $0 cash** — Groq free tier + public LanguageTool. At Groq's paid
  llama-3.3-70b rates (~$0.59/M in, $0.79/M out) a full analysis (~6–10k in / ~4k out across the
  3 calls) would be roughly **half a US cent** — the analysis is not the cost constraint; live
  voice minutes are (see memory: $0.022–0.025/min).

## 7. Observations flagged while auditing (no changes made)

1. **Mojibake in a live prompt:** the VERDECKTER WIEDERHOLUNGSTEST block (`scenarios.js:992-996`)
   contains double-encoded UTF-8 in the committed source (`fÃ¼r`, `PrÃ¼fe`, `natÃ¼rlich`) — this
   garbled German is sent to the boss LLM whenever a covert retest probe fires. Likely from the
   known PS `Set-Content` foot-gun. Cheap fix, separate bounded ship.
2. **Transcripts are ephemeral** (§1) — the single biggest structural blocker for "deep diagnosis
   of ALL errors".
3. **The CTA over-promises** (§3): "PERSÖNLICHEN SCHRITT ÖFFNEN" routes to home; the personal step
   only appears if BrainGuide has one and the user scrolls to it.

---

## 8. Gap analysis — wanted pipeline vs. today

**Wanted:** interview → deep diagnosis of ALL errors → deliberate choice of ONE biggest bottleneck
→ live-generated personalized exercise block → re-interview that retests exactly that bottleneck.

| Stage | Exists today | Missing |
|---|---|---|
| **Interview** | Full capture in `ctx.utterances`/`ctx.dialogue`; honesty + anti-farm gates; evidence-quality tagging. | Nothing — solid. |
| **Deep diagnosis of ALL errors** | Two-source grammar merge (LT + L2-aware LLM) with provenance; deterministic L1 detector (ONE pattern); `interviewReview` per exchange; `hireReadiness.limitingSkill` across 6 skills; per-rule `grammarRules` persisted. | (a) Raw transcript not persisted → diagnosis cannot be deepened or re-run after the session; (b) caps everywhere by design (≤5 rules, ≤2 examples shown, 1 L1 pattern) — "ALL errors" is neither extracted nor stored; (c) error classes beyond grammar (pronunciation/intelligibility, structure, fluency) are measured but never unified into one ranked error inventory. |
| **Deliberate choice of ONE bottleneck** | THREE choosers exist: `brain/engine.decide()` (deterministic, drives BrainGuide), `salmaCoachCore` prescriptions (criterion-gated, exact-metric doctrine), and the debrief's `priorityFix` + `nextTime.targetWeakRule` (SRS-lapse heuristic). | ONE authoritative chooser. The debrief screen's "NÄCHSTES MAL" is picked by SRS lapse count — not by the fresh interview's evidence, and not necessarily the same thing BrainGuide will prescribe after the button click. The choice is also never *explained* from evidence ("2× in diesem Interview, kostet dich X"). |
| **Live-generated personalized exercise block** | **Does not exist.** Closest: SAG-ES-RICHTIG serves the learner's own stored wrong/right pairs (templated), Salma doses them (repetitions/spacing/success gate), `buildDrills` templates ≤3 repair cards. All other drills are static banks. | An LLM-generated exercise block built from THIS interview's actual errors (fresh sentences targeting the bottleneck rule at the right level, validated before showing — the `compounding-accuracy-engine` + `feedback-accuracy-doctrine` skills define the guardrails). |
| **Re-interview retesting exactly that bottleneck** | **Real and shipped:** dossier GEZIELTER WIEDERHOLUNGSTEST + covert retest probe in the boss prompt; matched (24h) and transfer (7d) retests locking boss+level; delta proof via `lastTargetRule` + `weakLog`; `improvementHistory` in salmaCoach. | Tightness: retest targets a *skill/criterion or one grammar rule string*; if the new pipeline picks a bottleneck outside those (e.g. a specific pronunciation confusion), the probe can't express it. Also the retest only ever carries ONE rule — fine for the vision, but the choice feeding it must become the unified chooser above. |

**Bottom line:** ~70% of the vision already exists server-side — capture, honest two-source
diagnosis, a prescription engine with doses and server-confirmed completion, and a genuinely
covert re-test loop. The two real builds are: (1) **persist a full per-interview error inventory**
(transcript + all extracted errors, not the capped summary), and (2) **a live exercise-block
generator** from that inventory, slotted into the existing Salma prescription/dose/retest
machinery instead of beside it. The third fix is unification: ONE bottleneck chooser feeding the
debrief line, the CTA target, and the retest probe, so the learner never sees three different
"one things". The CTA should deep-link into that chosen block, not just route home.
