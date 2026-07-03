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

### 3. QUEUED — Debrief names Arabic-L1 high-frequency errors
**Why (owner mandate):** the debrief should name the L1-specific pattern (verb-second in
subordinate clauses, article-gender slips, P/B devoicing transcript artifacts) — not generic
"grammar mistakes."
**What:** deterministic detectors in `server/scoring/` for the top Arabic-L1 error patterns
detectable from text; coach.js surfaces at most the ONE most frequent detected pattern with the
learner's own (confidence-gated, non-truncated) example. Must respect the existing honesty gates
(`turnQuality.js`: never quote low-confidence words, never fault truncated turns).
**DoD:** detectors unit-tested on synthetic + past-bug fragments (incl. false-positive cases);
integrates behind the existing thin-session gate; gates green.

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

### 10. QUEUED — OWNER-AR fill sheet (one-sitting masri pass)
**Why (predicted):** the hard rule "the builder never authors masri" is accumulating empty
OWNER-AR slots across the app (drill intros, Satzbau labels, thin-debrief note_ar, BrainGuide
copy). The owner WILL eventually sit down for the native pass — today that means hunting slots
across a dozen files.
**What:** a zero-cost script (`scripts/owner-ar-sheet.mjs`) that greps the repo for OWNER-AR
slots + empty `_ar`/`ar:''` fields and emits ONE `docs/owner-ar-sheet.md` with file:line, the
German source string, and an empty column to fill. Re-runnable (idempotent).
**DoD:** script runs offline, output complete against a hand-checked sample; committed sheet;
gates green (script excluded from client build).

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
