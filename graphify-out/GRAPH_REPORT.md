# Graph Report - bpo-combat-arena  (2026-06-28)

## Corpus Check
- 86 files · ~215,604 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 805 nodes · 1438 edges · 57 communities (49 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d8af8f5c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 61|Community 61]]

## God Nodes (most connected - your core abstractions)
1. `WebSocketManager` - 29 edges
2. `loadUser()` - 26 edges
3. `dbEnabled()` - 23 edges
4. `planOf()` - 20 edges
5. `saveUser()` - 19 edges
6. `requireAuth()` - 17 edges
7. `kvGet()` - 16 edges
8. `kvSet()` - 16 edges
9. `dayKey()` - 16 edges
10. `ClipRecorder` - 12 edges

## Surprising Connections (you probably didn't know these)
- `canStartAssessment()` --calls--> `planOf()`  [EXTRACTED]
  server/assessment.js → server/auth.js
- `normalizeResult()` --calls--> `canon()`  [INFERRED]
  server/assessment.js → server/grammarCheck.js
- `LessonScreen()` --calls--> `overlay`  [INFERRED]
  client/src/Trainingslager.jsx → client/src/Feedback.jsx
- `buildFacts()` --calls--> `loadUser()`  [EXTRACTED]
  server/alhassan.js → server/store.js
- `load()` --calls--> `dbEnabled()`  [EXTRACTED]
  server/auth.js → server/db.js

## Import Cycles
- None detected.

## Communities (57 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.23
Nodes (9): paymentsRouter, deletePaymentsFor(), loadPayments(), _mem, paymentStatusFor(), refCodeFor(), savePayments(), PLAN_IDS (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (16): Arena(), C, _CONT_CUES, EMOTIONS, FACE_PARAMS, _highlight(), inputStyle, PERKS_DE (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (11): dailyMinutesFor(), entitlement(), freeFightAvailable(), isAdminEmail(), planOf(), publicAccount(), paidOnly(), paidOnly() (+3 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (23): analyze(), assessmentRouter, canStartAssessment(), normalizeResult(), hasRealSpeech(), voicedDurationMs(), chat(), generateDrillSet() (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (22): BOSS_CONFIGS, callBoss(), GREETINGS, MOOD_POOL, _providerCooldownUntil, PROVIDERS, RealtimeClient, sanitizeOneTurn() (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (26): buildDrills(), buildLesson(), buildProgress(), _canon(), fallbackDebrief(), formatDialogue(), generateDebrief(), _isRealCorrection() (+18 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (19): checkAudioSupport(), btnGhost, btnPrimary, card, feedbackBox, input, metricBox, metricLbl (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (11): 10. The Impossible List, 1. Current Architecture Map, 2. Component-Level Optimization Audit, 3. The Compounding Curriculum Engine (Design Spec), 4. First-Token-to-Speech Architecture, 5. Real-Time Prosody Coaching Layer, 6. Interviewer Personality Fidelity System, 7. Hire-Readiness Forecasting System (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (14): buildScoringPrompt(), __dirname, __filename, gradeTranscript(), groqChat(), groqKey(), mainScore(), parseScoredCompletion() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (24): ACCT_FILE, activatePlan(), authenticate(), consumeFreeFight(), consumeTrialSession(), createAccount(), DATA_DIR, deactivatePlan() (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (64): buildFacts(), buildBossMemory(), daysBetween(), num(), classifyGrammar(), KEYWORD_MAP, isSpeakableRule(), clampN() (+56 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (17): overlay, BossNode(), buildPath(), CompactNode(), deriveStates(), GameMapCompact(), ghost, iconFor() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.26
Nodes (9): callModel(), guideRouter, maybeSummarize(), cache, DATA_DIR, defaultGuide(), loadGuide(), safeId() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (16): dependencies, cors, dotenv, express, pg, ws, description, engines (+8 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (15): A. Fake feedback from silence (HIGH — the worst trust-killer), B. Punctuation/casing/spelling shown as a SPOKEN weakness (HIGH — "Komma vor 'sondern'"), C. Drills repeat / never refresh (HIGH — "this is a lie from you claude"), D. A "pass/fail" judged by the wrong signal (HIGH), E. Two competing verdicts on one screen (MEDIUM — doctrine Law 6), F. LLM inventing what must be deterministic (HIGH), G. Redundant / self-contradictory features (MEDIUM — "are you dumb, makes me look like a toy"), H. Robotic / wrong voice (HIGH — shipped blind once, "extremely robotic") (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (14): lucide-react, dependencies, react, react-dom, devDependencies, vite, @vitejs/plugin-react, name (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (14): preview, dependencies, react, react-dom, devDependencies, vite, @vitejs/plugin-react, name (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (11): adminRouter, authRouter, billingRouter, feedbackRouter, pressureRouter, app, CLIENT_ORIGINS, httpServer (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.18
Nodes (8): ENDLESS, freezeMsg(), ghostBtn, ghostBtnWide, LEVELS, PressureLadder(), primaryBtn, T()

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (10): AdminFeedback(), btnGhost, btnPrimary, card, FirstFightCard(), HomeFeedback(), modal, PRICE_OPTS (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (6): AURA_DE_VOICES, ELEVEN_VOICE_SETTINGS, ELEVEN_VOICES, router, TRANSCRIBER, _ttsCache

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (8): difficultyFor(), genCache, generateItems(), ITEMS, listeningRouter, normalize(), TYPES, validItem()

### Community 23 - "Community 23"
Cohesion: 0.17
Nodes (11): After every push — VERIFY THE DEPLOY LANDED (never assume), Architecture facts (don't re-discover these), Before every push — build-check, Cross-cutting changes deploy server + client TOGETHER, Env / dashboard items you CANNOT do from code — always flag these to the user, Reporting discipline, Ship & Verify — do it right the first time (OMNI-PERFORM / bpo-combat-arena), THE GOLDEN RULE (+3 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (10): card, cueBtn, DailyTraining(), errBox, ghost, inputSt, ov, primary (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.20
Nodes (9): 0. Default stance, 1. Challenge before you build — but scope it (kill the yes-man), 2.5. Treat push-to-main as a RELEASE — human-gate what I can't verify  ⟵ hard rule, 2. Verify, don't assert ("finished" ≠ "working"), 3. Manage context (you get dumber as the chat grows), 4. Stop making me the bottleneck (parallelize + goal-loops), CLAUDE.md — Operating Rules (OMNI-PERFORM / bpo-combat-arena), Orchestration — how the skills chain (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.20
Nodes (9): 1. Render env vars (backend) — verify all are set, 2. The one test only YOU can do — real phone fight, 3. Decide your price (optional — defaults are fine), 4. Add your teaching videos (optional — works without them), 5. Turn on payments (when ready), 6. How each plan behaves (so you can spot-check with a test account), Known limitations (not blockers — improve after launch), OMNI-PERFORM — Go-Live Checklist (+1 more)

### Community 27 - "Community 27"
Cohesion: 0.24
Nodes (5): App(), BACKEND, paintError(), reportError(), RootBoundary

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (8): Debrief(), FluencyDrill(), ghostBtn, ghostBtnWide, primaryBtn, RoundCard(), StatRow(), T()

### Community 29 - "Community 29"
Cohesion: 0.21
Nodes (21): dbEnabled(), ensureReady(), getPool(), kvDel(), kvGet(), kvSet(), FEEDBACK_FILE, loadFeedback() (+13 more)

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (7): fetchTtsUrl(), playBossVoice(), playClipFromUrl(), playDeepgramVoice(), speakBossStreamed(), splitSentencesDE(), stopBossVoice()

### Community 31 - "Community 31"
Cohesion: 0.28
Nodes (7): Assessment(), ghostBtn, ghostBtnWide, primaryBtn, QUESTIONS, T(), Verdict()

### Community 33 - "Community 33"
Cohesion: 0.39
Nodes (8): clamp(), coachLine(), computeReadiness(), DailyMission(), DRILL_LABEL, lastAvg(), nextMission(), T()

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (7): 1. Server, 2. Client, German BPO Combat Arena, How it works, Project structure, Requirements, Setup

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (7): ClipRecorder, pcm16ToWav(), ghostBtn, ghostBtnWide, primaryBtn, SpokenReview(), T()

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (6): IDENTITY, OUTPUT FORMAT, REVOLUTION PRINCIPLES, STACK, WHEN EDITING, YOUR TARGET USER

### Community 38 - "Community 38"
Cohesion: 0.38
Nodes (6): Alhassan(), bubble(), errBox, ghost, ov, T()

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (5): ghostBtn, ghostBtnWide, Listening(), primaryBtn, T()

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (5): ghostBtn, ghostBtnWide, primaryBtn, Shadowing(), T()

### Community 41 - "Community 41"
Cohesion: 0.33
Nodes (5): Composes with, Council — challenge before you build, Output shape, Scope (don't ritualize it), The voices

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (5): Build/audit checklist, Feedback Accuracy Doctrine, Keep improving this skill, Reusable red-team prompt, The 6 laws

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (4): Composes with, Don't, Goal-loop — parallelize to an objective bar, then judge hostilely, Steps

### Community 45 - "Community 45"
Cohesion: 0.40
Nodes (4): Composes with, Rules, Session-handoff — survive the context reset, Write this block (tight enough to paste into a fresh window with zero loss)

### Community 46 - "Community 46"
Cohesion: 0.40
Nodes (5): CatBar(), Debrief(), HpBar(), useAnimatedNumber(), WpmMeter()

### Community 49 - "Community 49"
Cohesion: 0.50
Nodes (3): How you operate, Output (the debrief), The owner's standing dislikes (treat each as a defect to hunt, not a preference)

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (3): BossAvatar(), _eyePath(), _mouthPath()

### Community 57 - "Community 57"
Cohesion: 0.13
Nodes (22): buildDaily(), buildFreshSet(), completeDaily(), dailyRouter, dailyStatus(), FALLBACK_DRILLS, gradeDailyItem(), interleaveBySource() (+14 more)

### Community 61 - "Community 61"
Cohesion: 0.29
Nodes (5): defaultPlacement(), placementRouter, shouldPrompt(), STATUSES, TERMINAL

## Knowledge Gaps
- **252 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+247 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `clamp()` connect `Community 33` to `Community 2`?**
  _High betweenness centrality (0.294) - this node is a cross-community bridge._
- **Why does `WebSocketManager` connect `Community 2` to `Community 17`, `Community 10`?**
  _High betweenness centrality (0.185) - this node is a cross-community bridge._
- **Why does `gradeTranscript()` connect `Community 8` to `Community 10`, `Community 2`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _252 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.047474747474747475 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11428571428571428 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09365079365079365 - nodes in this community are weakly interconnected._