---
name: auto-research
description: The cached playbook for OMNI-PERFORM "Auto-Research" on a drill (e.g. the nightly free research run). Skip re-exploring and re-searching the web from scratch — this holds the drill→file map, the grounded pedagogy/Arabic-L1 evidence cache (with URLs), the $0 constraints, and the exact output contract. Use whenever asked to research/upgrade any drill (SAG ES RICHTIG, Fluency 4-3-2, Trainingslager, debrief, etc.).
---

# auto-research — research a drill without paying full price twice

Purpose: the recurring "research ONE drill and recommend upgrades" task kept re-globbing the repo
and re-searching the same academic sources every run. This skill caches the stable parts so a run is
mostly synthesis, not re-discovery. **$0 always** (Groq + Deepgram + LanguageTool + free web only).

## Output contract (return ONLY this — no preamble, no report file)
1. A 2–3 line "what the drill does today + what's already good" summary.
2. A ranked list of **≤6** upgrades, ordered impact × low-effort first, across CONTENT / TECHNIQUE /
   STRUCTURE / INTERFACE. Each: **WHAT + WHY it moves the hiring needle + effort (S/M/L)**. Cite sources.
Concrete and specific to the drill. Never generic. Never fabricate metrics.

## Hard doctrine (non-negotiable, from memory + skills)
- Grammar corrections are **LanguageTool-backed, never model-invented** (see `feedback-accuracy-doctrine`).
- **No employer names, ever.** No fabricated metrics. Feedback accurate, never generic.
- Zero new paid service. STT = Groq Whisper (`whisper-large-v3`); grading is **deterministic** (no LLM judge).
- Speech drills can't test punctuation/casing/spelling (`isSpeakableRule` / `PUNCT_RULE` scrub them).

## Drill → file map (read THESE, don't Glob/Explore first)
- **SAG ES RICHTIG** (spoken error-repair, PAID): `server/spokenReview.js` + `client/src/SpokenReview.jsx`.
- **SRS engine** (schedule 1→3→7→14→30d, `addItem`/`dueItems`/`grade`, `seedBPOPhrases`): `server/srs.js`.
- **Grammar = source of truth** (LanguageTool, `buildGrammar`, category/issue-type/punct filters, `example={wrong,right,wrongWord,rightWord,...}`): `server/grammarCheck.js`.
- **Where errors BECOME SRS items** (grammar→`addItem`, vocab, `seedBPOPhrases`): `server/websocketManager.js` ≈ L954–975.
- **Error → lesson-ID tagging** (rule-based keyword map, no AI): `server/errorTags.js`.
- **Fluency 4-3-2 drill**: `server/fluencyDrill.js` + `client/src/FluencyDrill.jsx`.
- **Debrief assembly** (metrics + LT grammar + Groq-written strengths/vocab, honesty-gated): `server/coach.js`.

## SAG ES RICHTIG — cached "today" (spot-check the 2 files above; don't re-derive)
Takes the learner's OWN LanguageTool-flagged interview errors (stored in SRS with `example.wrong/right/rightWord`),
resurfaces them on the spaced schedule, and makes them **SAY the correction aloud**. Groq Whisper transcribes (de);
grading is deterministic + lenient-positive (grammar item = pass if the corrected token `rightWord` is present),
honesty-gated (`voicedDurationMs<600` → retry, never scores silence). Already strong: right pedagogy (pushed spoken
production of personal errors, spaced), $0, no LLM invention, punctuation/casing scrubbed.

## Evidence cache (reuse before re-searching; re-verify only if you need a fresh angle)
Pedagogy:
- Productive retrieval > receptive for productive knowledge; retrieval >> restudy; repeated spaced retrieval ~ large retention gains — https://pmc.ncbi.nlm.nih.gov/articles/PMC3983480/ , https://learninglab.psych.purdue.edu/downloads/2012/2012_Karpicke_CDPS.pdf
- Pushed output forces semantic→**syntactic** processing (Swain) — accuracy lever speaking uniquely trains — https://jalt-publications.org/tlt/articles/2198 , https://files.eric.ed.gov/fulltext/EJ1127288.pdf
- Prompts/**self-correction** (withhold the form, make the learner produce it) engage output & self-repair vs recasts which only model — https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/abs/differential-effects-of-prompts-and-recasts-in-formfocused-instruction/2C69A2DBB417D64B57EC2A7E3FA682BA
- Spacing + interleaving + corrective feedback each add retention; CF timing is context-dependent (no single optimum) — https://pmc.ncbi.nlm.nih.gov/articles/PMC9995700/
Arabic-L1 → German traps:
- Arabic has ONE invariable article "al" (der/die/das not signalled) + **no indefinite article** (indefiniteness = omission) → German gender/article + dropped ein/eine — https://ulb-dok.uibk.ac.at/download/pdf/9407877.pdf
- Arabic present tense has **no copula** (nominal sentence) → learners drop "ist/sind" — https://mountainscholar.org/bitstreams/d189208a-846c-4280-bd93-7b9a7718d615/download
- German **V2 / verb-final in subordinate clauses** (weil/dass) is a top persistent word-order error — https://en.wikipedia.org/wiki/V2_word_order
Credibility on a call:
- **Global** errors (meaning/word-order breakdown) hurt comprehensibility; **local** errors (endings) rarely block it → rank word-order/copula/verb-position drills above article-gender polish — https://www.academia.edu/36709807/ (local vs global)
- Non-native speech judged less credible/competent; **intelligibility (being understood) > perfect grammar** for call work — https://www.customerserv.com/blog/call-center-agent-accents-do-they-really-matter

## Procedure
1. Read the 2–4 mapped files for the target drill (spot-check the cached "today" is still accurate).
2. Synthesize from the evidence cache. Only web-search for a NEW angle the cache doesn't cover.
3. Emit the output contract. Keep every rec tied to a real error-repair mechanism + a cited source.
