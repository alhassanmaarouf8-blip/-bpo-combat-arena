# ROADMAP — the owner-approved build queue

This file is the single source of truth for the **nightly feature-builder routine** and any
agent asked to "build the next thing." Items are ordered by learner impact and are
**owner-approved** — do not invent new items; do not reorder without the owner.

## Contract for any builder run (read before building)

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

### 1. QUEUED — Satzbau-Schmiede: verb-final / word-order builder drill
**Why (owner mandate):** German verb-final word order is the #1 wall for Arabic-L1 speakers —
the single highest-leverage structure for hireable spoken German.
**What:** a new drill where the learner assembles/produces subordinate-clause sentences
(weil/dass/wenn/obwohl…) against the clock. Server-side generator + deterministic grader
(exact-order check with tolerant articles), C1-level BPO-context sentences, difficulty ramps.
Wire into the existing drill list UI following the pattern of Hör-Check / Sag-es-Richtig.
**DoD:** ≥24 curated seed items passing german-check; unit tests for the grader (word-order
correct/incorrect/partial); lint+build green; drill reachable from the drill wall; no interview-
minute gating (it's a drill, use the `drill=1` TTS path if voice is used).

### 2. QUEUED — Formulaic-chunk automaticity in Flow-Drill
**Why (owner mandate):** formulaic chunks ("Da bin ich mir sicher, dass…", "Ich kümmere mich
sofort darum") are the anti-freeze for real-time fluency.
**What:** extend Flow-Drill with a chunk-automaticity mode: a curated bank of BPO-register
chunks, prompted rapid-fire, graded deterministically on chunk presence + latency (existing
timing signals). Repetition schedule via the existing SRS (`server/srs.js`).
**DoD:** ≥30 chunks passing german-check; deterministic grading unit-tested; SRS wiring tested;
gates green.

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
