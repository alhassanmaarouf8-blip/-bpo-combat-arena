# ROADMAP — the owner-approved build queue

This file is the single source of truth for the **nightly feature-builder routine** and any
agent asked to "build the next thing." Items are ordered by learner impact and are
**owner-approved** — do not invent new items; do not reorder without the owner.

## Contract for any builder run (read before building)

0. **Token-saver (read these FIRST instead of exploring):** `.claude/skills/app-map/SKILL.md`
   (codebase map), `.claude/skills/design-system/SKILL.md` (UI law, for any client work),
   `.claude/skills/subagent-contract/SKILL.md` (binding work rules),
   `.claude/skills/owner-doctrine/SKILL.md` (the owner's 8 laws + pre-ship checklist —
   REQUIRED for anything learner-facing; it predicts his verdict before he gives it).
1. Build the **TOP item whose status is `QUEUED`** and which is not already claimed by an
   existing `feature/*` branch (check `git ls-remote origin 'refs/heads/feature/*'` and open
   PRs via the public GitHub API).
2. **One bounded item per run.** Finish it completely: implementation + unit tests + docs in code.
3. **All gates must pass before you are done** (run them, paste real output):
   `npm run lint` · `npm run design-lint` · `node --test server/*.test.mjs server/scoring/*.test.mjs server/brain/*.test.mjs`
   · `(cd client && npm run build)` · `node scripts/german-check.mjs <files>` if German content changed
   (german-check calls the free LanguageTool endpoint — if the sandbox has no network, say so; it
   then runs as a local gate before merge).
4. **NEVER push to `main` from a builder run.** Work on branch `feature/<slug>`; push the branch
   if credentials allow, otherwise output the full diff. `main` is production. Merging to main is
   done ONLY by the independent nightly **verifier+shipper** routine — a separate agent that
   re-runs every gate itself and adversarially reviews the diff — or locally via the ship loop.
   **Owner directive 2026-07-02: owner review is NOT required for deploys; independent agent
   verification IS.** The verifier's default is NO-SHIP; it auto-reverts if production comes up
   broken after a merge.
5. Include in your change: flip this item's status to `IN PROGRESS — <branch>` in ROADMAP.md.
   The verifier flips it to `SHIPPED — verified <date>` when it merges to main.
6. **Hard rules (never violate):** zero spend — no paid services or new dependencies; never name
   any company/employer; no fabricated metrics or content; **never write Egyptian-Arabic (masri)
   copy — leave `note_ar`-style fields as empty owner slots**; German shown to learners must pass
   german-check; anything learner-facing obeys `.claude/skills/feedback-accuracy-doctrine/SKILL.md`
   (no invented feedback, never blame a truncated/mis-heard turn on the learner); don't touch
   `.github/workflows`, auth/payment gating, or pricing unless the item says so.
7. Prefer **server-side, deterministic, test-provable** work. If an item has a "feel" aspect only
   the owner's ear can judge, build the provable core, keep the feel behind the existing patterns
   (flags / owner-gated defaults), and flag it in the PR — **owner testing must never block the
   build from landing green.**

## Queue

### 1. SHIPPED — verified 2026-07-02 — Satzbau-Schmiede: verb-final / word-order builder drill
**Why (owner mandate):** German verb-final word order is the #1 wall for Arabic-L1 speakers —
the single highest-leverage structure for hireable spoken German.
**Shipped as:** `server/satzbauSchmiede.js` (26 curated seed items, deterministic position-by-
position grader, unseen-first rotation, paid-drill gating) + `client/src/SatzbauSchmiede.jsx`
(tile-builder UI, cosmetic-only countdown, native-voice replay) + wiring (server.js route, home
Übungen-grid tile, BrainGuide/Alhassan prescription maps, DrillIntro line, drill-event → brain).
Built overnight by the nightly feature builder; independently verified + integrated by the
session agent (verifier fixes: newly-authored masri stripped to OWNER-AR slots, DrillIntro added,
native-voice stop handle, retry-timer reset; conflict with the redesigned home resolved — the
standalone button became a grid tile). 11 unit tests.

### 2. SHIPPED — verified 2026-07-03 — Formulaic-chunk automaticity in Flow-Drill ("Blitz-Formeln")
**Why (owner mandate):** formulaic chunks ("Da bin ich mir sicher, dass…", "Ich kümmere mich
sofort darum") are the anti-freeze for real-time fluency.
**Shipped as:** `server/fluencyDrill.js` chunk section (32-chunk BPO-register bank, cue→formula
pairs, OWNER-AR note slots; deterministic in-order presence match reusing the ONE srs.js grading
rule; latency verdict automatic ≤1.5s / ok ≤3s / slow; GET `/api/fluency/chunks` serves SRS-due
chunks first then unseen; POST `/api/fluency/chunks/score` grades + schedules on the 1-3-7-14-30
SRS) + `client/src/FluencyDrill.jsx` ChunkMode (prime: see+hear the formula once in the native
voice → fire: formula hidden, situation cue shown, reaction time measured mic-open→first voiced
frame, silence auto-stop → verdict → SRS-honest summary; drill-event `blitz-formeln` → brain).
Entry from the Flow-Drill round-0 screen. 17 unit tests (bank hygiene incl. langGuard + empty
OWNER-AR slots, match accept/typo/scramble/partial/reject, verdict tiers incl. missing-latency
honesty, due-first/unseen/cycle selection, SRS advance+lapse). Suite 148/148, lint (changed
files), design-lint, client build green; german-check: all 64 new strings clean (4 flags =
pre-existing false positives in the old prompt bank).

### 3. SHIPPED — verified 2026-07-03 — Debrief names Arabic-L1 high-frequency errors
**Why (owner mandate):** the debrief should name the L1-specific pattern (verb-second in
subordinate clauses, article-gender slips, P/B devoicing transcript artifacts) — not generic
"grammar mistakes."
**Shipped as:** NEW `server/scoring/l1Errors.js` — three deterministic detectors: (1) V2-in-
subordinate-clause (conj+subject+finite-verb+more-content; clause-final verbs never flagged;
deterministic verb-final rewrite offered only for simple clauses, else no fabricated example);
(2) article-gender on a 30-noun interview lexicon, flagging ONLY articles impossible in EVERY
case of the correct gender ("mit der Frage" dative never flagged — underclaims by design);
(3) P→B devoicing via a non-word-only artifact map (broblem→Problem…), framed as what the
speech recognition heard, never a knowledge error. `topL1Pattern()` names at most ONE pattern,
only at ≥2 occurrences, example gated by looksTruncatedDE + lowConf-overlap (counted but
unquoted otherwise). Wired in `websocketManager._finishSession` (DEBRIEF payload `l1Pattern`,
behind the existing real-session gate; coach.js deliberately untouched — a concurrent session
holds uncommitted WIP there) + neutral-blue debrief card in `client/src/App.jsx` (Wochenfokus
keeps the single orange; note_ar OWNER-AR slot). 17 unit tests incl. false-positive guards.
Suite 165/165, lint, design-lint, client build green; german-check: learner-visible strings
clean (6 flags = regex source internals, not shown to learners).

### 4. QUEUED — Druck-Leiter scoring spinner
**Why:** the scoring round-trip currently shows nothing while the grade computes (known
follow-up from the drills wave).
**What:** small client-side pending state (existing spinner pattern) for Druck-Leiter's scoring
call; no scoring-logic change.
**DoD:** lint + design-lint + client build green; matches the 2-color design system.

### 5. QUEUED — 'Souverän' heuristic tuning
**Why:** known follow-up — the heuristic reads too coarse.
**What:** tighten the heuristic in the scorer with unit tests around the boundary cases; keep it
deterministic and cause-labeled (every HP change stays explainable).
**DoD:** boundary unit tests; no change to HP caps or damage balance; gates green.

### 6. QUEUED — Rückfrage-Reflex: the repair-language drill
**Why (elite-conversationalist review 07-02):** real German phone work is ~a third clarification
and repair — „Habe ich Sie richtig verstanden, dass …?", „Meinen Sie damit …?", „Könnten Sie mir
das bitte präzisieren?". The app trains ANSWERING but never the spoken REPAIR move, and a candidate
who can repair gracefully never freezes — it converts every misunderstanding into a competence
signal. This is arguably the single most hireable phone skill.
**What:** a drill that plays a deliberately ambiguous/incomplete customer line (existing TTS path,
`drill=1`) and grades — deterministically — whether the learner's spoken response is a WELL-FORMED
clarifying question (question form + repair formula present + polite Sie-register), not a guessed
answer. Bank of ≥20 ambiguous prompts (german-check gated); grading via existing STT + pattern
rules, unit-tested. Wire into the drill wall like Hör-Check.
**DoD:** ≥20 items german-check clean; deterministic grader unit-tested (accept/reject/partial);
lint+build green; no interview-minute gating.

### 6b. QUEUED — Aspect-audit wave: Zielplan / WeeklyBriefing / Invite / Assessment / Paywall / Trainingsnachweis / BrainGuide polish
**Why (owner mandate 07-02: "revolutionize 10 undertouched aspects"):** a judged multi-agent audit
produced 3 concrete moves for each of 10 surfaces; 3 surfaces shipped same-night, the rest are
specced and waiting.
**What:** implement the moves in **docs/audit-2026-07-02.md** for ONE surface per run (pick the
top-most not-yet-done section; respect its S/M/L effort labels and every constraint written there).
Follow `.claude/skills/design-system/SKILL.md` + `.claude/skills/subagent-contract/SKILL.md`.
**DoD per surface:** the audit section's moves implemented (or honestly skipped with reason),
design-lint + lint + build green; german-check on any German content; no Arabic authored.

### 7. QUEUED — Candidate delivery metrics under pressure (debrief)
**Why (elite-conversationalist review 07-02):** sounding calm under attack matters as much as the
words. The app already stores per-utterance WPM, fillers, and stage — so it can MEASURE composure:
pace spike and filler spike in the Teil-3 roleplay vs. Teil-1, latency drift across the session.
"Dein Tempo sprang um 40%, als der Kunde laut wurde" is elite, personal, and fully deterministic.
**What:** compute stage-contrast deltas (WPM variance, filler rate, reaction latency: Teil 3 vs
Teil 1) from EXISTING stored signals in the debrief pipeline; surface ONE composure insight in the
debrief only when the delta is beyond noise (respect turnQuality honesty gates — truncated turns
excluded). No new data collection.
**DoD:** pure helper with unit tests (incl. below-noise → silent, thin-session → silent); wired
into coach/debrief behind the existing honesty gates; gates green.

### 8. SHIPPED — verified 2026-07-02 — Lessons report to the brain (harmony gap)
**Why (predicted from the owner's standing harmony mandate — "real intelligence and congruency
between the drills, the interview, the feedback; everything must work in harmony"):** Video-
Lektionen now RECOMMENDS by weakness, but a finished lesson + quiz result never reaches the
brain, so Alhassan and the next debrief can't see that the learner already studied the rule.
That's the exact class of incongruence the owner flags on sight.
**What:** on quiz completion, POST the existing `/api/drill-event` with
`{drill:'video-lektion', correct:<quiz majority>, ruleKeywords}` from VideoLessons.jsx; extend
the brain's snapshot to read it (same pattern as the other drills). No new endpoint.
**DoD:** event fires once per completed quiz (unit-testable helper for the payload); brain
snapshot test extended; gates green.

### 9. QUEUED — Druck-Leiter: retire mastered lines across sessions
**Why (salvaged from an abandoned WIP branch/stash `hermes-client-wip` — the idea is right, the
WIP was broken; build it fresh):** within a session lines never repeat, but across sessions the
same openers return, and a learner who has already survived a line under max pressure gains
nothing from hearing it again.
**What:** persist survived line ids per user server-side (same `loadUser/saveUser` store idiom as
`satzbauSeen`); a proper authed GET/POST route (the WIP's `/api/pressure/survived` fetch had no
auth and no server side — do NOT copy it); client filters retired lines out of the pool and
signals pool exhaustion honestly.
**DoD:** server route unit-tested (auth, persistence, reset-on-exhaustion); client never throws
on an empty pool; gates green.

### 10. SHIPPED — verified 2026-07-04 — OWNER-AR fill sheet (one-sitting masri pass)
**Why (predicted):** the hard rule "the builder never authors masri" is accumulating empty
OWNER-AR slots across the app (drill intros, Satzbau labels, thin-debrief note_ar, BrainGuide
copy). The owner WILL eventually sit down for the native pass — today that means hunting slots
across a dozen files.
**Shipped as:** `scripts/owner-ar-sheet.mjs` (offline, node built-ins only, idempotent —
regenerating after slots are filled shows only what's left; filters out runtime
coercions/fallbacks and `youtubeId_ar` video-ID slots, which are not masri text) +
committed `docs/owner-ar-sheet.md` (45 slots / 11 files at generation time, with fill
instructions: masri in the عربي column, `-` = keep German, bank/data rows expanded per-item
in-session). Hand-checked against the SatzbauSchmiede + VideoLessons slot sets.

### 11b. QUEUED — Payment-provider webhook: paid plan activates itself
**Why (owner go 2026-07-04, week-1 distribution push):** fulfillment is manual — every payment
requires the owner to verify and set the plan in the admin panel, so revenue is capped by his
availability. The owner is creating a hosted checkout (Paddle or Lemon Squeezy — both free to
set up, both pay out to Egypt) and setting `PAYMENT_URL` on Render; the missing half is the
webhook so payment → plan happens with no human.
**What:** `POST /api/payments/webhook` (payments.js): verify the provider's signature
(Paddle `Paddle-Signature` HMAC / Lemon Squeezy `X-Signature` HMAC-SHA256 — secret from a new
`PAYMENT_WEBHOOK_SECRET` env, reject unsigned), map the checkout's customer email + product/
variant to `basic`/`elite` (mapping via env or a small config block next to plans.config.js),
set the plan through the SAME code path the admin panel uses (no duplicate plan-setting logic),
handle `subscription_cancelled`/`refund` events by reverting to `free`, idempotent on event id.
Keep manual Vodafone Cash flow untouched as the no-card fallback.
**DoD:** unit tests for signature verify (valid/invalid/missing), event→plan mapping, idempotent
replay, cancel/refund revert; no plan change on unverified payload; zero new dependencies (node
`crypto`); gates green. Until the owner picks the provider, implement both verifiers behind one
env-selected switch (`PAYMENT_PROVIDER=paddle|lemonsqueezy`).

### 11. QUEUED — Abend-Rückkehr: surface the two-session day on home
**Why (predicted from the owner's own design: 15 min/day = 2×7.5-min interviews, "study today →
return tonight"):** the debrief already says "komm heute Abend wieder", but the home screen has
no state that knows a morning session happened — the return visit lands on a generic home and
the rhythm dies there.
**What:** deterministic client-side read of today's session count from existing progress data:
if 1 interview today + budget remaining → the home's single orange CTA becomes the SECOND
session prompt with the day's one focus (from the debrief's stored next step). No new endpoints,
no notifications (zero cost, no permissions).
**DoD:** pure date-boundary helper unit-tested (Cairo timezone); design-lint green (still ONE
orange object); gates green.

### 12. SHIPPED — verified 2026-07-04 (`78d5422`) — Debrief card: "Strukturen, die Sie schon beherrschen" (structureWins)
**Why (predicted after the 07-04 human-HR-closing ship, owner laws #5/#6):** the interviewer now
SPEAKS one verified positive observation (Konjunktiv II / verb-final / Perfekt, from
`server/scoring/structureWins.js`) in the goodbye — but the written debrief still shows only
errors + model-written strengths. The owner will ask why the praised structure isn't IN the
written feedback loop. Positive recognition must also persist (law #5: the drills should know
what the learner already masters).
**What:** a small debrief section fed by `topStructureWins(ctx.utterances)` (already computed at
session end — pass it through the DEBRIEF payload next to `l1Pattern`), rendered like the
l1Pattern card. German copy exists in `WIN_COPY`; Arabic lines are OWNER-AR slots (empty until
the owner fills them — render German-only meanwhile). Also write a `drill-event` style marker so
SRS/Trainingslager can down-prioritize mastered structures.
**DoD:** unit test that the payload includes wins only when count ≥2 and quotes stay
honesty-gated; design-lint green; no fabricated Arabic; gates green.

### 13. SHIPPED — verified 2026-07-04 (`9963e5d`) — Gemini path: announce the final exchange (no dangling last question)
**Why (predicted from the 07-04 Gemini closing fix):** on the Gemini Live path the "interview
complete" signal is only known AFTER Gemini has already replied to the candidate's last answer —
so Gemini may ask one more question and then immediately say goodbye when the closing directive
lands. A real interviewer signals the end BEFORE the last exchange ("Eine letzte Frage noch …").
**What:** when `scoredAnswers` is ONE short of the completion threshold on the Gemini path, send
a lightweight directive (`proxy.sendText`, same mechanism as the greeting kick and the goodbye)
telling the interviewer the NEXT question is the last one and to frame it that way.
**DoD:** no double-directives (idempotent flag like `_geminiClosingSent`); classic path
untouched; gates green.

### 14. QUEUED — Voice variety beyond Hör-Check (Shadowing, Sag es richtig, Druck-Leiter)
**Why (predicted from the 07-04 voice wave):** Hör-Check callers are now 7 different German
humans; every OTHER drill still speaks with the single default voice (`aura-2-julius-de` via
nativeVoice.js). The owner will hear the contrast within a day and ask why the rest of the app
is one narrator.
**What:** reuse `makeVoicePicker`/`inferSpeakerGender` (exported from server/listening.js —
move to a shared module) wherever drill lines are SPOKEN CHARACTERS (customer lines in
Druck-Leiter, example speakers in Sag es richtig). Keep ONE consistent voice where the speaker
is the app itself (instructions, Alhassan) — a narrator changing voice mid-lesson reads as a
bug, not variety.
**DoD:** per-drill decision table in the commit message (character vs narrator); no new cost
(same cached /api/tts-stream); gates green.

### 15. SHIPPED — verified 2026-07-04 (`9963e5d`) — Funnel/model pacing sync: tell the boss which Teil the counter is in
**Why (07-04 adversarial audit, top structural finding):** the stage funnel + ending are a rigid
counter (`stageForAnswers`, complete at 8 scored answers) while the system prompt orders the model
to linger on threads — two unsynchronized clocks. A talkative candidate can be forced into the
goodbye while conversationally still in Teil 2, so the Drucktest ("der eigentliche Prüfstein")
may never fire before closing.
**What:** per-turn, append one line to the turn context telling the model the counter's current
Teil and how many exchanges remain (mechanism like threadNudge/TURN_RULE injection in
`realtimeClient.respond()`); when ONE answer remains, instruct it to wrap the thread. Do NOT
change the counter values themselves or any timing knob.
**DoD:** unit test that the injected line matches ctx.stageIdx/scoredAnswers; prompt-contradiction
grep (no line tells the model to ignore the funnel); gates green.

### 16. QUEUED — Terse-answer honesty: a real "Sofort." must count
**Why (07-04 audit, corrected finding):** turns under MIN_SCORED_WORDS=3 are silently IGNORED —
no score, no funnel advance — yet the Drucktest rubric explicitly solicits terse replies
("Sofort."). The gate exists to stop VAD fragments from draining HP (owner-tuned balance — do not
just lower it).
**What:** distinguish a COMPLETE short turn (typed submit, or spoken turn-final commit) from a
mid-speech VAD fragment at the _scoreAnswer call site; complete 1–2-word turns in stage ≥2 score
via factors (never the 'keine Antwort' label) and advance `scoredAnswers`. HP damage caps unchanged.
**DoD:** unit tests: "Sofort." typed in roleplay → scored + funnel advances; a 2-word VAD fragment
mid-stream → still ignored; suite green.

### 17. SHIPPED — verified 2026-07-04 (`9963e5d`) — Silence gets an in-character lifeline (wire the dead 'silence' rescue)
**Why (07-04 audit):** `requestRescue('silence')` exists but is never called — an empty turn
short-circuits before scoring, so a frozen candidate (the most common real failure) faces an
endlessly reopening mic with zero acknowledgment, up to 60s, forever.
**What:** count consecutive empty TRANSCRIPT_DONE turns per session; on the 2nd, call
`requestRescue('silence')` once (boss says something human: "Lassen Sie sich ruhig einen Moment
Zeit — fangen Sie einfach mit dem ersten Gedanken an."); cap once per Teil. No VAD/timing changes.
**DoD:** unit test on the counter/one-shot logic; no rescue on a single empty turn; gates green.

### 18. QUEUED — Honest halt on sustained LLM outage (no infinite filler loop)
**Why (07-04 audit):** if both providers stay down, every turn becomes a 3-phrase generic filler
rotation forever while scoring keeps running and a banner simultaneously says "starte neu" — the
boss says "continue", the system says "restart".
**What:** after N=3 consecutive fallback-line turns, end the session honestly: boss speaks one
in-character close ("Ich fürchte, die Leitung macht uns heute einen Strich durch die Rechnung —
lassen Sie uns hier unterbrechen."), session ends WITHOUT scoring those filler exchanges against
the learner, client shows the honest connection-error state (no contradictory double message).
**DoD:** unit test the counter + no-score path; feedback-accuracy doctrine check (no learner blame);
gates green.

### 19. QUEUED — Opening variety + scene-consistent greetings (German content)
**Why (07-04 audit):** GREETINGS pool = 1 per boss → the first sentence of the product is its
most-repeated sentence (bit-identical cached MP3); and 4 bosses greet in-person ("Setzen Sie
sich…") while 2 of 9 intro variants are phone-framed ("Die Verbindung steht…") — ~22% of those
sessions contradict the scene inside one breath.
**What:** 3 scene-neutral greetings per boss (seeded pick like intros; register-true German,
german-check gated) and pair-filter greeting×intro so phone-framed intros never follow in-person
greetings. TTS cache works per-variant already.
**DoD:** probe: 20 seeded interviews/boss → ≥3 distinct first sentences, zero scene-contradiction
pairs; german-check green on new lines; no employer names; gates green.

### 20. QUEUED — Fallback turn integrity: finish_reason guard + deterministic TTS number expansion
**Why (07-04 audit):** Groq-fallback turns (cap 90 tokens) can truncate mid-sentence with no
`finish_reason==='length'` check — and cleanForTTS then APPENDS a '.' so the voice calmly ends
mid-thought. Separately, digits/€/abbreviations reach TTS raw on paths without TURN_RULE.
**What:** on `finish_reason==='length'`, trim to the last COMPLETE sentence boundary (never
fake-close a fragment); raise the fallback cap toward the Cerebras value if latency allows; add a
small deterministic German digit/€/abbrev expander into `cleanForTTS` (unit-testable, all paths).
**DoD:** unit tests: truncated sample → ends at a real sentence; "19,99 €"/"24h" → spoken words;
gates green.
