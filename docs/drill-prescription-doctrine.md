# Drill-Prescription Doctrine — how exercises are chosen for a problem

**Owner's demand (2026-07-20, verbatim intent):** "I wanna know how and why those drills or
exercises will be chosen. What is their criteria of choosing these exercises for a given specific
problem? … you have to check what human elite teachers do so you could get inspired on the
mechanism, not copy-paste them. … you guide a student not to a drill and then retest — that's
bullshit — through a SERIES of drills that actually, provenly solve this specific problem for this
specific student."

This document is that criteria. It replaces the old hand-written one-problem→one-drill table with a
researched mechanism. It is written to be challenged: every rule states its source and what it
changes in the app.

---

## Part 1 — What elite teachers actually do (the research, distilled)

Eight findings, each load-bearing. Together they form one mechanism.

1. **The mastery loop (Bloom).** One-to-one tutoring beats classroom teaching by ~2 standard
   deviations. Its engine: diagnose → give a *corrective activity that is different from the
   original teaching* → retest with a *parallel* (new, equivalent) test → repeat until mastered.
   A failed retest never triggers "do the same thing again" — it triggers a *different* corrective
   approach. [Bloom 1984, "The 2 Sigma Problem"]
2. **Elite tutors are indirect (Lepper's INSPIRE studies).** What separates excellent from mediocre
   tutors: they almost never announce "that's wrong, the answer is X." They ask escalating
   questions that make the student produce the correction themselves — protecting motivation while
   forcing the student's brain to do the repair work. [Lepper, Drake & O'Donnell-Johnson 1997]
3. **Prompts beat recasts — measured (Lyster & Saito meta-analysis, 827 learners).** Corrective
   feedback that *elicits* the fix from the learner (prompts) produces larger and more durable
   gains than feedback that just *models* the fix (recasts) — and the advantage shows up precisely
   in free speech, which is what an interview is. [Lyster & Saito 2010, SSLA]
4. **Noticing comes first (Schmidt).** A learner cannot fix a pattern they have never consciously
   seen in their own output. Awareness of the exact gap ("here is your sentence, here is where the
   verb should be") is the entry condition for everything that follows. [Schmidt 1990]
5. **Skill is built in three stages (DeKeyser).** Declarative ("I know the rule") →
   proceduralized ("I can apply it slowly and deliberately") → automatized ("I do it fast, under
   pressure, without thinking"). **Practice at each stage looks different.** Slow, isolated,
   accuracy-focused exercises build stage 2; they do NOT build stage 3. Fast, communicative,
   time-pressured exercises build stage 3; they are wasted (or harmful) at stage 1. This is THE
   reason a single drill type per problem is wrong. [DeKeyser 1997/2025]
6. **Automatization needs repetition + shrinking time (Nation's 4/3/2).** Saying the same content
   4 → 3 → 2 minutes measurably raises speech rate and cuts pauses. Fluency exercises are
   automatization tools, not accuracy tools — prescribing them for an accuracy problem is a
   category error, and vice versa. [Nation 1989; Boers 2014; Saito 2021]
7. **Practice conditions must converge on use conditions (Lightbown, transfer-appropriate
   processing).** What transfers is what was practiced *under the conditions of use*. A grammar
   pattern drilled only in writing, or only in calm isolated sentences, will not survive a live
   spoken interview. The LAST exercises in any series must look like the interview itself: spoken,
   timed, conversational. [Lightbown 2008]
8. **Teach only what the student is ready for (Pienemann's teachability hypothesis).** German word
   order is acquired in a fixed staircase — roughly: basic subject-verb-object → fronted adverbs →
   separable verbs → inversion → **verb-final in subordinate clauses (last)**. Instruction aimed
   above the learner's current stage does not stick. So even when verb-final is the top-ranked
   problem by impact, the *series entry point* must respect where the student stands on the
   staircase. [Pienemann 1989/2015]

Plus, already in the harness evidence base (auto-research skill): producing from memory beats
re-reading (retrieval practice, Karpicke); spaced repetition beats massed; forced speaking pushes
the brain from "meaning only" into syntax (Swain's pushed output); errors that break understanding
(word order, missing verb) outrank errors that don't (endings, articles) for employability.

---

## Part 2 — The selection criteria (the fixed rules)

An exercise may be prescribed for a problem **only if it passes every applicable rule**:

- **K1 · PRODUCE, not recognize.** The student must *say or build* the target form. Multiple-choice
  and "read the rule" surfaces are allowed only inside Stage A (noticing). (Retrieval practice;
  pushed output.)
- **K2 · UNAVOIDABLE.** The exercise must be impossible to pass while dodging the problem. If a
  student can complete the drill without ever producing a weil-clause, it is the wrong drill for
  verb-final. (Task essentialness.)
- **K3 · ELICIT, don't announce.** The exercise withholds the correction and prompts the student to
  produce it — escalating hints before reveal. (Lyster & Saito; Lepper.)
- **K4 · STAGE-MATCHED.** The series climbs a fixed ladder, and the exercise is chosen by the
  student's *current stage on this problem*, not by the problem name alone:
  - **Stage A — NOTICE:** the student sees their OWN recorded sentence and must find the error in it.
  - **Stage B — CONTROLLED:** slow, isolated, accuracy-first production of the corrected form.
  - **Stage C — AUTOMATIZE:** fast production under time pressure / interruption, form embedded in
    meaningful answers.
  - **Stage D — TRANSFER:** the disguised probe inside the next REAL interview. Never announced.
- **K5 · OWN-ERROR CONTENT.** Exercise material is built from the student's own recorded, verified
  errors (the LanguageTool-flagged sentences from their interviews) — textbook sentences only to
  top up when the personal corpus is thin. (Bloom's corrective specificity.)
- **K6 · CONVERGE ON THE INTERVIEW.** Each stage moves conditions closer to the real thing; Stage C
  is always spoken and timed; Stage D is the interview. (Transfer-appropriate processing.)
- **K7 · READINESS-GATED.** Word-order prescriptions respect the German acquisition staircase: a
  student whose speech shows no inversion yet enters the word-order series at inversion, not at
  verb-final. (Pienemann. Detection for this = the syntax dial-deepening already specced in the v2
  plan.)
- **K8 · MASTERY-GATED + PROVEN.** Advancing a stage requires the stage's success gate (already
  defined per drill in `salmaCoachCore` PROTOCOLS). "Solved" means exactly one thing: **the error
  rate on that rule drops in the disguised Stage-D retest inside a real interview** (the matched
  24h retest + 7-day transfer retest with per-skill minimum deltas — already coded, currently
  switched off). A failed retest sends the student back ONE stage into a *different variant*, never
  the same exercise again. (Bloom.)
- **K9 · SPACED.** Minimum spacing between series sessions (already in PROTOCOLS:
  `minimumSpacingMinutes`); the SRS engine is the scheduler across days.

Honesty boundary (unchanged law): a passed retest proves the observed change, never causality, and
never an employer's decision. No metric is ever invented; unmeasured stays unmeasured.

---

## Part 3 — The problem-class → series map

Existing drill inventory and where each one truly belongs on the ladder:

| Drill (exists today) | What it really is | Ladder stage |
|---|---|---|
| SAG-ES-RICHTIG (say your own corrected sentence aloud) | prompted own-error repair | B (→ C with time pressure) |
| SATZBAU-SCHMIEDE (build the sentence) | controlled word-order construction | B |
| FLOW-DRILL (4/3/2) | repetition under shrinking time | C |
| DRUCK-LEITER (pressure ladder) | answers under escalating pressure | C |
| SHADOWING | imitate native rhythm/sounds | B (pronunciation) |
| HÖR-CHECK | listening verification | B (listening) |
| SRS | spacing scheduler | across stages |
| Interview probe (`probeTarget` — exists, wired) | disguised retest in the real interview | D |

**Missing and must be built:** Stage A (FINDE-DEN-FEHLER: the student's own sentence on screen,
find + speak the fix — reuses the SpokenReview surface, no new paid anything), Stage-C *variants*
of SAG-ES-RICHTIG (timed version), and the **series state machine** that remembers which stage each
student is on per problem.

The series per rankable problem class:

- **Verbstellung im Nebensatz** (verb-final; top impact tier):
  A FINDE-DEN-FEHLER on own weil/dass sentences → B SATZBAU-SCHMIEDE (build the clause) →
  B SAG-ES-RICHTIG (speak own corrected clauses) → C SAG-ES-RICHTIG timed + DRUCK-LEITER answers
  that *require* a weil-justification (K2) → D disguised probe ("Warum…?" questions in the next
  interview force weil-clauses). K7 gate: staircase check first; if inversion is absent, enter at
  inversion exercises instead.
- **Dativ/Akkusativ + Wechselpräpositionen:**
  A find-the-case-error in own sentences → B SAG-ES-RICHTIG on own case errors → C timed variant
  embedded in service answers (package/address/invoice contexts force prepositional phrases, K2) →
  D probe: the interview asks a where/whereto question chain.
- **Artikel/Genus + Adjektivendungen** (low impact tier — prescribed only when nothing above ranks):
  A notice in own text → B SRS of own noun+article pairs → C spoken production in answers → D probe.
- **Zeitformen (Perfekt/Präteritum):**
  A find-the-tense-error → B SAG-ES-RICHTIG own past-tense sentences → C DRUCK-LEITER "erzählen Sie
  von einem Mal, als…" (forces past narration, K2) → D probe: experience questions.
- **Tempo/Flüssigkeit** (a skill, not knowledge → starts at C by definition; A/B don't apply):
  C FLOW-DRILL 4/3/2 on the student's own interview answers (not generic topics — K5) →
  D measured WpM + pause rate in the next interview.
- **Antwort-Abbruch / Einfrieren (continuity):**
  B scripted answer skeletons (STAR pattern) spoken → C DRUCK-LEITER with interruptions →
  D continuity score in the next interview.
- **Aussprache:** series defined (A hear-the-difference → B SHADOWING → C in-answer production →
  D intelligibility in interview) but **prescription stays OFF** until the pronunciation
  measurement passes its external gold study (standing honesty gate — we do not grade what we
  cannot measure).

Every series ends in D, and D is always disguised (the student is never told "this question is your
retest") — announced tests measure test-performance, not skill (transfer-appropriate processing).

---

## Part 4 — What this changes in the code (the build phase, needs its own GO)

One bounded ship, in this order:

1. **`server/brain/drillSeries.mjs`** — the series definitions above as data + a pure
   `nextStage(problemId, seriesState, evidence)` function. Deterministic, no LLM, unit-tested
   against every rule K1–K9 (each rule = a pinned test).
2. **Engine wiring** — `engine.js` prescription for a ranked problem asks the series for the
   student's current stage instead of reading the static `drill:` field from the skill graph
   (which remains as fallback). The directive gains `seriesStage` so the UI can say honestly:
   "Schritt 2 von 4 gegen dein größtes Problem."
3. **Turn ON the mastery ladder** (`SALMA_COACH_MODE`) — the practice → wait → matched-retest →
   transfer-retest loop is the K8 proof engine and it is already coded and dark. Flag flip +
   prove-it. (Render env = owner-typed or Chrome-dashboard flow.)
4. **FINDE-DEN-FEHLER Stage A** — smallest possible version inside the existing SpokenReview
   surface: show the student's own flagged sentence, they speak the corrected version; pass =
   corrected token present (same deterministic grader as SAG-ES-RICHTIG).
5. **Timed Stage-C variant** of SAG-ES-RICHTIG (a countdown on the existing surface; pass gate
   unchanged + within time).

Explicitly OUT of this ship (each its own approved phase later): the 7.5-minute session structure
(first block = general interview, then drills, return visit = second interview testing the trained
things), the field-picker (oil/telecom/…), and the pronunciation gold study.

**Prove-it for the build phase (owner-run, live):** finish a real interview with weil-errors → home
prescribes Stage A on YOUR OWN sentence → complete it → next prescription is Stage B (not a random
drill) → next real interview contains a disguised warum-question → Fortschritt shows the
verb-final error rate before/after. Zero spend, zero new dependencies, all graders deterministic.

---

## Sources

- Bloom (1984), The 2 Sigma Problem — https://gwern.net/doc/psychology/1984-bloom.pdf
- Lepper et al., INSPIRE expert-tutor model — https://www.eoas.ubc.ca/research/cwsei/resources/INSPIRE-Guidelines.pdf
- Lyster & Saito (2010), Oral Feedback in Classroom SLA: A Meta-Analysis — https://eric.ed.gov/?id=EJ892626
- Schmidt (1990/2010), Noticing hypothesis — https://nflrc.hawaii.edu/PDFs/SCHMIDT%20Attention,%20awareness,%20and%20individual%20differences.pdf
- DeKeyser & Suzuki (2025), Skill Acquisition Theory — https://onlinelibrary.wiley.com/doi/abs/10.1002/9781405198431.wbeal0067
- Nation 4/3/2 + Saito (2021) replication — http://kazuyasaito.net/LTR2021.pdf
- Lightbown (2008), Transfer-Appropriate Processing — https://www.researchgate.net/publication/292461381
- Pienemann (1989/2015), Teachability / Processability — https://onlinelibrary.wiley.com/doi/10.1111/lang.12095
- Harness evidence cache (retrieval practice, pushed output, spacing, global-vs-local): `.claude/skills/auto-research/SKILL.md`
