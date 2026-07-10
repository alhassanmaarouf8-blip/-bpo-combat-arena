---
name: feedback-accuracy-doctrine
description: Enforce zero-inaccuracy, hyper-personalized learner feedback whenever building or auditing any student-facing feedback (scores, corrections, debriefs, drills, verdicts) in bpo-combat-arena / OMNI-PERFORM. Auto-apply whenever a feature shows a learner a number, a correction, a verdict, or "what to fix."
---

# Feedback Accuracy Doctrine

Owner's hard rule: **never show a learner anything inaccurate or generic.** A false "you're wrong" or empty praise destroys trust and the hiring outcome. Apply this every time feedback reaches a student.

## The 7 laws

1. **Measurement over opinion.** Prefer deterministic, computed signals (words/min from VOICED time, counts, deltas) over LLM judgment. If a number can be computed from the learner's own data, compute it — don't ask a model.
2. **Grammar is LanguageTool-only.** Never let an LLM invent/decide a grammar correction. Route candidate text through `buildGrammar()` (server/grammarCheck.js). If LanguageTool is unreachable, show NO grammar — never a guess.
3. **Quote guards (anti-fabrication).** Any "you said X" must be a real substring of the learner's actual utterances/transcript. Canonicalize (lowercase, collapse whitespace, strip quotes + trailing punctuation) then `includes()`-check; drop the item if it fails. Already applied to coach `upgrades.original`, coach `interviewReview.deinSatz`, assessment `example_from_their_own_answer`.
4. **Don't claim what you can't measure.** The server can't hear pronunciation from a transcript (STT erases accent) → never output a pronunciation verdict from text; label proxies honestly ("word accuracy, not accent"). STT can mishear a real word → never assert "you said X wrong" with certainty.
5. **Honest labeling of weak signals.** Whisper undercounts "äh/ähm" → headline the robust metric (WpM) and mark fillers best-effort. State how each number was measured. "Got faster" must use voiced time, not mic-on wall-clock (which includes silence).
6. **Personalize from their own data, not flattery.** The "aha" = their real quote → what was missing vs the actual question/rubric → the one fix that gets them hired; plus a deterministic progress line from their own past sessions ("fillers 7→2 since session 1"). Never two competing hireability verdicts on screen — reconcile with any existing score→label decision.
7. **Never blame the learner for the system's failure (truncation-awareness).** The half-duplex, silence-timer interview can CUT OFF a turn mid-sentence; an interrupted or STT-garbled turn is stored identically to a freely-chosen short one. NEVER let a scorer read app-truncation as the learner "freezing / collapsing under pressure / having no result / no example / being unsicher" — that is a false, disqualifying verdict for the app's bug. Detect cut-off turns deterministically from the text (`server/scoring/turnQuality.js`: `looksTruncatedDE` — dangling aux/conj/article/prep, "habe ich", 1–2-word scrap; `sessionSubstance` → `tooThinToJudge`). Then: mark cut-off turns in any transcript sent to a model + instruct it to judge ONLY completed turns; never quote a fragment back; don't send fragments to LanguageTool; and on a too-thin/mostly-cut-off session, emit an HONEST "too short/interrupted to judge — do a full run" (metrics + grammar, still one next step) instead of a manufactured verdict/luecke.

8. **Never score what the machine hallucinated (ASR-hallucination guard, 2026-07-10).** Gemini Live's input transcriber invents "user" turns from speaker echo and noise: German written phonetically in the WRONG SCRIPT (Telugu/Arabic), repeat-loops ("Hallo."x5), and verbatim echoes of the boss's own line (AEC residue). Every one was scored as a learner answer until `server/transcriptGuard.js` (wrong_script <50% Latin letters / repeat_loop >=4 tokens <=2 distinct / boss_echo = normalized verbatim containment vs the PREVIOUS boss line only). Rules must stay conservative — keep when in doubt; a clarifying human rephrase or "Nein, nein, nein" must never be filtered. Wiring gotcha: capture the previous boss line BEFORE pushing this turn's reply, or the echo rule compares against the wrong line and eats mirrored genuine answers (review-caught).

## Build/audit checklist
- [ ] Every number computed from the learner's own input (not invented)?
- [ ] Corrections LanguageTool-backed; empty when unavailable?
- [ ] All quotes substring-verified against the real transcript?
- [ ] No label overclaims (pronunciation-from-text, faster-from-mic-on-time)?
- [ ] Feedback ties to the hiring outcome (a concrete fix), not generic praise?
- [ ] Cut-off / fragmentary turns detected and NEVER scored as a weakness/collapse (law 7)? Too-thin session → honest "do a full run", not a manufactured verdict?
- [ ] Hallucinated/echoed turns filtered BEFORE scoring (law 8, transcriptGuard) — and the filter tested for false positives on genuine turns?
- [ ] Fallback path returns a valid, honest shape when model/key is down?
- [ ] Nothing on screen says "OpenAI"/"gpt" (owner directive).

## Reusable red-team prompt
"Find every place this could tell a student something false or generic; rank by likelihood×harm; prove each with a concrete input→wrong-output example." Run after any feedback change.

## Keep improving this skill
When a new inaccuracy class is found, add it here as a law + a checklist item. Log notable fixes so the doctrine compounds over time.
