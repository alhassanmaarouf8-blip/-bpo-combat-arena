---
name: feedback-accuracy-doctrine
description: Enforce zero-inaccuracy, hyper-personalized learner feedback whenever building or auditing any student-facing feedback (scores, corrections, debriefs, drills, verdicts) in bpo-combat-arena / OMNI-PERFORM. Auto-apply whenever a feature shows a learner a number, a correction, a verdict, or "what to fix."
---

# Feedback Accuracy Doctrine

Owner's hard rule: **never show a learner anything inaccurate or generic.** A false "you're wrong" or empty praise destroys trust and the hiring outcome. Apply this every time feedback reaches a student.

## The 6 laws

1. **Measurement over opinion.** Prefer deterministic, computed signals (words/min from VOICED time, counts, deltas) over LLM judgment. If a number can be computed from the learner's own data, compute it — don't ask a model.
2. **Grammar is LanguageTool-only.** Never let an LLM invent/decide a grammar correction. Route candidate text through `buildGrammar()` (server/grammarCheck.js). If LanguageTool is unreachable, show NO grammar — never a guess.
3. **Quote guards (anti-fabrication).** Any "you said X" must be a real substring of the learner's actual utterances/transcript. Canonicalize (lowercase, collapse whitespace, strip quotes + trailing punctuation) then `includes()`-check; drop the item if it fails. Already applied to coach `upgrades.original`, coach `interviewReview.deinSatz`, assessment `example_from_their_own_answer`.
4. **Don't claim what you can't measure.** The server can't hear pronunciation from a transcript (STT erases accent) → never output a pronunciation verdict from text; label proxies honestly ("word accuracy, not accent"). STT can mishear a real word → never assert "you said X wrong" with certainty.
5. **Honest labeling of weak signals.** Whisper undercounts "äh/ähm" → headline the robust metric (WpM) and mark fillers best-effort. State how each number was measured. "Got faster" must use voiced time, not mic-on wall-clock (which includes silence).
6. **Personalize from their own data, not flattery.** The "aha" = their real quote → what was missing vs the actual question/rubric → the one fix that gets them hired; plus a deterministic progress line from their own past sessions ("fillers 7→2 since session 1"). Never two competing hireability verdicts on screen — reconcile with any existing score→label decision.

## Build/audit checklist
- [ ] Every number computed from the learner's own input (not invented)?
- [ ] Corrections LanguageTool-backed; empty when unavailable?
- [ ] All quotes substring-verified against the real transcript?
- [ ] No label overclaims (pronunciation-from-text, faster-from-mic-on-time)?
- [ ] Feedback ties to the hiring outcome (a concrete fix), not generic praise?
- [ ] Fallback path returns a valid, honest shape when model/key is down?
- [ ] Nothing on screen says "OpenAI"/"gpt" (owner directive).

## Reusable red-team prompt
"Find every place this could tell a student something false or generic; rank by likelihood×harm; prove each with a concrete input→wrong-output example." Run after any feedback change.

## Keep improving this skill
When a new inaccuracy class is found, add it here as a law + a checklist item. Log notable fixes so the doctrine compounds over time.
