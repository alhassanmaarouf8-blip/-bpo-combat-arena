# Phase 2–4 Pipeline Verification — 2026-07-20

End-to-end verification of the deep-diagnosis → bottleneck → personal-step → re-interview pipeline,
per the owner's 7-item protocol. Method: scripted planted-error transcripts driven through the REAL
prod stack (typed WS interviews on verified probe accounts deepqa2/deepqa3), in-process keyless
tests for failure paths, real-device-width UI runs via Playwright, costs from prod logs.
**Every fail found was fixed and re-verified in the same cycle** (commits `469d5ea`, `ea830b5`,
plus the RTL fix shipped with this doc). Verification builds: `ea830b5` → final.

| # | Item | Verdict |
|---|------|---------|
| 1 | 13 planted errors / 7 classes detected, events match, one sound bottleneck | **PASS** (after fix) |
| 2 | Day-2 same error → repeat flag + different exercises | **PASS** (repeat live; novelty unit-proven + live 0-reuse) |
| 3 | Day-2 new error → selector switches, yesterday's file stays open | **PASS** (after fix) |
| 4 | Completion server-confirmed; skipping never unlocks | **PASS** (after fix) |
| 5 | Killed LLM calls → retry/queue/fallback, no blank screens | **PASS** |
| 6 | DE + RTL Arabic on mobile width | **PASS** (after fix) |
| 7 | Added LLM cost per full daily cycle | **~21k tokens ≈ $0 (free tier); <2¢ at paid rates** |

## Item 1 — Planted transcript (session `24731960`, day-1 default variant)
13 planted errors across 7 classes (placement family ×5 incl. "Gestern ich habe angerufen habe
hatte…", ADJ/ARTIKEL, KASUS ×3, TEMPUS, FUELLWOERTER storm, REGISTER du/Sie ×2). Result: 16
errors / 9 categories — **all 5 required classes detected**, error_events rows == totalErrors
(16), one bottleneck with evidence quotes, 2 runner-ups and the stored why
("Verbstellung … Gewählt vor Wortstellung – reflexivpronomen vor verb (9) …").
- **FAIL FOUND → FIXED:** in 3 pre-fix runs the filler storm produced ZERO events (the measured
  fillerCount=6 never reached the selector) and the du/Sie slip was caught in only 1 of 2
  identical runs. LLM detection of these classes is structurally unreliable → they are now
  **code-made events** (`augmentFillerEvents`: ≥3 fillers/answer, correction = the de-filled
  sentence; `augmentRegisterEvents`: fixed safe du→Sie map, never auto-conjugated sentences).
  General law adopted: *an LLM detector must be backstopped by deterministic events for every
  class it demonstrably under-reports.*
- Note: 13 planted → 14–16 reported is expected variance (compound plants split into multiple
  real errors; every quote passes the verbatim gate, so nothing is fabricated).

## Item 2 — Repeat day (sessions `24731960` → `6afae7fc`)
Same dominant wall re-selected → `repeat=true`, dayStreak counting Cairo days, exerciseHistory
carried into generation. Repeat matching works at problem-FAMILY level (verb-placement trio) —
necessary because the analyzer names the same wall differently across days (three different
subcodes for one planted sentence across three runs). Novelty: the do-not-reuse prompt +
canonical drop-guard are unit-proven; the live diff measured **0 reused items** across all
stages (one comparison was vacuous when a quota-capped day produced a fallback set — noted, not
hidden). Both same-day sets observed distinct (e.g. "Verb an Satzanfang" ladder vs
reflexive-verb ladder).

## Item 3 — Selector switch (session `e6522536`, ADJ-heavy variant)
ADJ transcript (main clauses only) → bottleneck switched to
`ADJ_ENDUNG/nach_unbestimmtem_artikel_maskulin_nominativ`; yesterday's WORTSTELLUNG file stayed
**open, cleanStreak 0/2**.
- **FAIL FOUND → FIXED (design flaw):** the original closure rule closed a file after ONE clean
  interview — a learner who simply avoided subordinate clauses for a day "mastered" verb
  position (mastery by avoidance). Closure now requires **2 consecutive clean interviews, or
  drilled/retested + 1 clean** (`cleanStreak` on records; family-level occurrence counting).

## Item 4 — Completion + unlock (session `018774f7`'s generated set, s1=3 s2=3 s3=1)
Live run proved, in order: stage-1 completed → **still locked**; near-silent WAV → **422
no_voice, attempt NOT consumed**; stage-2 reps via real TTS audio (clean passes where Whisper
understood — "Er hat das Ticket nicht geschlossen" exact — honest 2-attempt "geübt" ladder where
it didn't); stage-2 done → **still locked** (stage-3 pending); transfer question answered →
`completed=true`, `reinterviewUnlocked=true`, bottleneck record → **drilled**. No API path
force-completes; skipping cannot unlock.
- **FAIL FOUND → FIXED:** near-silent clips originally counted as attempts — two garbage posts
  per rep could farm the unlock. Voiced floor (1200ms RMS) added.

## Item 5 — Killed LLM calls
In-process with all provider keys scrubbed (`pipelineFailure.test.mjs`): analysis →
`queued` honestly (transcript input preserved, poll spacing doesn't burn attempts) → terminal
`failed` after the 5-attempt ladder, never a fabricated result; generation → deterministic
Stage-2 fallback from stored corrections (never empty); no corrections → honest `failed` state
with its own client line. Live evidence of the same paths: session `3a7a8e81` (honest failed),
runs `4a7a21c9`/`e6522536` (fallback sets under real quota exhaustion, "Basis-Modus" + explicit
regenerate button). The debrief itself degrades to its metrics+LanguageTool fallback — the
pre-Phase-2 "2-sentence" screen exists only in that double-provider-outage corner, clearly
labeled, with the deep analysis arriving independently.

## Item 6 — Bilingual rendering, mobile width (390px, screenshots v-01…v-05)
Real typed interview through the production UI at 390×844. German: debrief → KOMPLETTE ANALYSE
→ DEIN ENGPASS card (evidence strikethrough→fix, runner-up chips, why) → PersonalStep brief +
ERKENNEN options — all render without overflow. Arabic: full RTL debrief/analysis with German
quotes correctly embedded LTR; LLM masri explanations render right-aligned.
- **FAIL FOUND → FIXED:** the PersonalStep overlay inherited RTL in Arabic mode, flipping German
  punctuation (".Ich werde mich sofort darum kümmern", "0 von 15" reversed). The German-primary
  overlay now pins `dir=ltr`; its Arabic lines keep their own `dir=rtl`.
- Cosmetic (accepted): runner-up chips may show the same category label twice with different
  subcodes; the why-line disambiguates, chips show scores.

## Item 7 — Added LLM cost per full daily cycle (prod log measurements, sessions above)
| Call | Tokens (in/out) | Typical |
|------|-----------------|---------|
| Deep analysis (2×4-answer groups) | ~3.9k / ~5.4k | 9.3k |
| Exercise generation | ~1.2k / ~1.0k | 2.2k |
| Re-interview deep analysis | ~3.9k / ~5.4k | 9.3k |
| **Total added per full daily cycle** | | **~21k tokens** |

Cash cost today: **$0** (Groq/Cerebras free tiers; all verification calls served by the Cerebras
failover while Groq's 100k/day was exhausted — `failedGroups=0`). At paid llama-3.3-70b rates
(~$0.59/M in, $0.79/M out): **≈ $0.015–0.02 per learner per full daily cycle**. Practical
constraint is the free-tier daily quota, not money: one full cycle ≈ 21k of Groq's 100k/day
budget when Groq serves it (plus the pre-existing boss/debrief usage) — at real user volume the
failover spreads load, and a paid tier costs cents.

## Residuals (documented, not hidden)
- Boss turns still intermittently throw `realtime_error` on quota-exhausted days (pre-existing,
  both providers momentarily limited); interviews continue and complete.
- The live cross-run novelty diff for two GENERATED same-family sets on consecutive real days
  remains to be observed organically (unit + 0-reuse live evidence stand).
- Personal-step re-entry after closing the overlay = next debrief only (home entry point is an
  owner nav-simplicity decision).
