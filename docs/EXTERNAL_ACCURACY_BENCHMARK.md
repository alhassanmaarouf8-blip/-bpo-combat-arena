# External Accuracy Benchmark — Authoritative Synthesis

**Status:** written calibration complete; spoken gold-study tooling complete; qualified human ratings pending
**Date:** 2026-07-15  
**Scope:** independent, zero-spend evaluation of OMNI-PERFORM's existing diagnostic pipeline

## Executive verdict

OMNI-PERFORM is internally coherent but not yet externally validated. The full local verification
suite passes 631/631 tests, including fail-closed evidence, diagnosis, prescription, matched retest,
and novel-transfer invariants. Those tests prove software behavior against self-authored cases; they
do not prove educational accuracy on independent learners.

Public data can currently benchmark two narrow areas:

1. written German grammar-error detection; and
2. read/spontaneous German transcription robustness.

Public data cannot currently prove the accuracy of the app's spoken bottleneck diagnosis, drill
selection, transferable learning, BPO-interview readiness, or employment outcomes for Egyptian
Arabic-L1 learners. Those claims require a consented target-population gold study.

There must never be one averaged "app accuracy" number. Every percentage must name its subsystem,
dataset version, sample size, confidence interval, and modality limitation.

## What was recovered from Fable 5

The completed deep-research workflow used five search angles, 15 capped source fetches, and ten
adversarial verification passes. Fable reached its session quota after the workflow completed but
before presenting the report. The preserved structured result was recovered and checked against its
source agents.

Its strongest verified conclusion was MERLIN v1.2. The workflow also found relevant public assets
for German ASR and spoken German, but only MERLIN's load-bearing claims survived the capped verifier
stage. Therefore, Fable's unverified discoveries are treated below as candidates rather than facts
unless independently confirmed from a primary source.

## Dataset decision table

| Dataset | Decision | Valid use | Invalid use |
|---|---|---|---|
| [MERLIN v1.2](https://clarin.eurac.edu/repository/xmlui/handle/20.500.12124/59) | **Use now** under CC BY-SA 4.0 | Written grammar/error evaluation; written CEFR agreement | ASR, fluency, listening, spoken diagnosis, BPO readiness |
| [Falko-MERLIN GEC](https://github.com/adrianeboyd/boyd-wnut2018) | **Use with attribution and taxonomy audit** | Parallel learner/corrected German for grammar precision/recall/F0.5 | Spoken performance or Arabic-L1 claims |
| [Common Voice German](https://github.com/common-voice/cv-dataset) | **Use with modality warning** under the applicable CC0 dataset terms | ASR WER/CER on scripted German; small spontaneous smoke test | Learner-error diagnosis, CEFR, BPO readiness |
| [Common Voice Spontaneous German](https://datacollective.mozillafoundation.org/datasets/cmj8u489v001tnxzp7x8ayacr) | **Exploratory only** | Spontaneous-German ASR failure discovery | Population accuracy; learner or Arabic-accent claims |
| [FOLK/DGD](https://agd.ids-mannheim.de/FOLK_extern.shtml) | **Reject for this commercial cloud benchmark** | None in the current pipeline | DGD terms prohibit commercial use and transmission to online processing services |
| [GeWiss/DGD](https://agd.ids-mannheim.de/GWSS_extern.shtml) | **Reject for this commercial cloud benchmark** | None in the current pipeline | Same DGD restriction; academic genre and non-target population |
| Public Goethe/telc/ÖSD demonstration media | **Do not score without written permission and labels** | Qualitative task-design reference only | Training data, CEFR ground truth, commercial benchmark |

### Additional human-expert sources audited on 2026-07-16

| Source | Human expertise present | Decision for this commercial product |
|---|---|---|
| [MERLIN research corpus](https://www.merlin-platform.eu/C_research.php) | Two independent professional CEFR raters per text; six analytic criteria; human TH1/TH2 and error annotations with reliability controls | **Use now** for written correction and written CEFR constructs only |
| [DISKO](https://home.uni-leipzig.de/sprastu/en/corpora/DISKO_en/) | Professional TestDaF ratings, longitudinal L2 writing, listening/reading/vocabulary metadata, and 92 manually corrected target hypotheses | **Potential later validation** after access/license review; academic written construct is not BPO speech |
| [MuSSeL](https://l2trec.utah.edu/learner-corpora/mussel/login-splash.php) | German L2 audio/transcripts from AAPPL/OPIc testing, independently proficiency-rated | **Best located spoken-proficiency candidate**, but registration and commercial-use permission must be resolved before ingestion |
| [HAMATAC](https://www.fdr.uni-hamburg.de/record/1480) | 24 German L2 map-task learners with manual transcripts, disfluency, and phonetic annotations | **Do not ingest now**: restricted access is for research/teaching by request, not demonstrated commercial use |

None of these sources provides the app's full construct: Egyptian Arabic-L1 candidates completing
German customer-service interviews, receiving a prescribed drill, and demonstrating delayed novel
transfer. Public expert data can validate components; it cannot substitute for that consented target-
population study.

## MERLIN facts verified from the acquired v1.2 bundle

The official v1.2 bundle was acquired from the Eurac/Free University of Bozen-Bolzano GitLab tag
`v1.2` at commit `a3165a6cb7e18ee89d8c5b5a19f612405bb61e77`. The data remains outside the
application repository.

- License: CC BY-SA 4.0.
- Total metadata rows: 2,287.
- German rows: 1,033.
- Unique German author IDs: 1,033; no repeated author ID was observed.
- Arabic-L1 German texts: 64.
- Other large German L1 groups: Russian 143, Polish 96, Spanish 85, Turkish 59.
- German fair-CEFR distribution: A1 57, A2 199, A2+ 107, B1 217, B1+ 115, B2 219,
  B2+ 73, C1 42, C2 4.
- The bundle contains learner text, target hypotheses, CEFR ratings, and error/complexity indicators.
- The data is written certification work, not audio or spontaneous speech.

This resolves two Fable open questions: learner-disjoint splitting is possible from the released
author IDs, and an Arabic-L1 subset exists. It does not resolve the spoken or Egyptian population
gap.

The official paper and current release disagree slightly on total counts. Benchmark manifests must
use the acquired bundle's hashes and observed row counts, never a paper's historical total.

## Product-to-evidence matrix

| ID | Product subsystem | Independent benchmark now | Required metric | Honest conclusion available now |
|---|---|---|---|---|
| S1 | ASR robustness | Common Voice scripted + small spontaneous German | WER, CER, abstention/failure rate, speaker-disjoint CI | German transcription robustness only |
| S2 | Grammar-error feedback | MERLIN/Falko-MERLIN | span precision, recall, F0.5, harmful false-correction rate | Written learner-German correction accuracy |
| S3 | Spoken level estimate | None matching current spoken construct | weighted kappa against blind expert spoken ratings | Not externally validated |
| S4 | Fluency/listening metrics | No labeled target corpus | agreement with expert fluency/listening ratings | Arithmetic is tested; interpretation is not validated |
| S5 | Bottleneck + drill | No public target-domain labels | top-1 agreement, correct abstention, harmful-misdirection rate | Not externally validated |
| S6 | Transfer verification | No public longitudinal target corpus | matched and novel effect with blind retest scoring | Not externally validated |

## Harmony defect discovered and corrected

The current source comments and product assumptions say LanguageTool is the authoritative grammar
source. The runtime pipeline does something different:

- `server/coach.js` calls both `buildGrammar()` and `buildGrammarLLM()`;
- guarded LLM corrections are prepended as the primary source when available;
- the resulting combined array is still returned with `grammarSource: 'languagetool'`.

This is a provenance defect, not proof that the LLM corrections are wrong. Until independently
benchmarked, the grammar system must be described as a **guarded LanguageTool + LLM merged pipeline**.
The benchmark must score three configurations separately: LanguageTool-only, LLM-only, and merged.
It must also measure whether the merge adds true corrections or merely adds harmful false positives.

The correction is implemented without changing the existing LLM-first learner-visible ordering:

- every rule and example now carries `correctionSource: 'llm'|'languagetool'`;
- the response reports `grammarSource: 'llm'|'languagetool'|'merged'|'none'`;
- a structured `grammarProvenance` object reports provider availability and correction counts;
- an empty successful check is distinct from provider unavailability; and
- duplicate LLM output cannot steal LanguageTool provenance.

The three configurations still require independent scoring before any accuracy claim.

## Runnable zero-spend benchmark

The repository now contains a pinned manifest and offline harness:

- `benchmarks/merlin-v1.2.manifest.json`
- `scripts/benchmark-merlin.mjs`
- `scripts/lib/merlin-benchmark.mjs`

The `prepare` command verifies the exact metadata/license hashes and observed corpus counts, creates
deterministic CEFR/Arabic-L1-stratified calibration, development, and holdout assignments, refuses
to write the index inside the application repository, and writes no raw learner text or author ID.
The `score` command accepts only hashed item IDs and source-separated correction counts. It reports
document-level grammar-error-presence metrics with Wilson intervals. The holdout is locked behind an
explicit one-time acknowledgement.

This first harness deliberately does **not** pretend that document-level `count_G` proves correction
span quality. Correction precision and harmful false-correction adjudication remain the next
benchmark layer after source-separated predictions exist.

### Completed LanguageTool calibration arm

The exact production LanguageTool path was run over all 614 calibration documents. Predictions are
hashed, source-separated, resumable, and stored outside the repository; the committed result is an
aggregate-only summary with no learner text or author ID.

| Measure | Calibration result |
|---|---:|
| Coverage | 614/614 (100%) |
| Accuracy | 56.84% (Wilson 95% CI 52.89–60.70%) |
| Precision | 68.28% |
| Recall | 71.93% |
| Specificity | 21.31% |
| F0.5 | 68.98% |

Arabic-L1 (`n=36`) precision was 80.77% and recall 70.00%, but specificity was 16.67% with a very
small negative class. This slice is neither large enough nor Egyptian enough to establish target-
population accuracy.

The decisive product finding is not “78.69% of corrections are harmful.” The benchmark's negative
label means MERLIN recorded no `G`-category error in that document; it does not prove every external
checker correction is wrong. The result instead shows that LanguageTool often fires outside that
annotation construct, so it cannot be called authoritative truth. The 144 unmatched-positive cases
must be sampled and adjudicated at rule/span level before deciding which corrections to suppress.

The LLM-only and merged calibration arms were not fabricated: the local benchmark environment has
no authorized `GROQ_API_KEY`. The generator fails closed until a zero-spend authorized key is
available.

### Completed human-reference correction-span benchmark

The production spoken-grammar filter was also evaluated against the frozen WNUT 2018
Falko-MERLIN German GEC test release. This is a materially stronger correction test than the
document-level MERLIN calibration above: the references are sentence-aligned human target
hypotheses, and scoring requires the predicted token span **and** replacement to match exactly.
Punctuation, spelling, and orthography annotations were excluded because the live spoken product
deliberately suppresses those categories.

| Measure | Frozen test result |
|---|---:|
| Sentences | 2,337 |
| Human-reference grammar edits | 3,748 |
| Production-filter predictions | 378 |
| Exact matches | 208 |
| Exact-reference precision | 55.03% (Wilson 95% CI 49.99-59.97%) |
| Exact-reference recall | 5.55% (Wilson 95% CI 4.86-6.33%) |
| Exact-reference F0.5 | 19.77% |

This result falsifies any claim that the current rule filter comprehensively identifies learner
grammar errors. Its dominant failure is **under-detection**, not merely scoring presentation: it
missed roughly 94% of the annotated grammar edits under strict exact-reference scoring. The 55.03%
precision is conservative because a reference correction is not an exhaustive list of every valid
German alternative; unmatched predictions require blinded human adjudication before being called
harmful. This benchmark is written learner German and does not validate spoken diagnosis, listening,
fluency, drill choice, transfer, BPO readiness, or hiring outcomes.

The test split is now consumed and must not be used for tuning. Any rule expansion must be developed
on the released training/development data, frozen, and then evaluated on a new untouched holdout.
The application behavior has not been changed from this test result alone.

The remote production checker also showed small run-to-run drift: an earlier complete run returned
373 edits and 210 exact matches; the attributed run returned 378 and 208. Across the two runs, 369
edits were stable, 13 sentences changed, four edits appeared only in the first run, and nine only in
the second. Therefore results must pin prediction-file hashes and must not imply deterministic
reproducibility until the provider/version path is frozen or replaced by a locally pinned engine.

### Frozen verb-final rewrite repair

The external test showed that the general checker missed all exact `R:WO` edits, but OMNI-PERFORM
also has a separate deterministic Arabic-L1 verb-final detector. Its automatic rewrite was therefore
evaluated independently. The released development set exposed two unsafe reconstruction contexts:
an incomplete one-token clause tail and missing punctuation before a `bitte` request. The detector
still records those signals, but now abstains from generating a model answer.

After the two guards were frozen, a document-disjoint holdout was opened once using 225 unseen
documents and 3,685 sentences. The detector found 13 relevant signals and generated four bounded
rewrites: three moved closer to the human target hypothesis, one was reference-neutral, and zero
moved farther away. The development set had eight of eight reference-supported rewrites.

This validates the direction of the abstention repair, not broad word-order accuracy. Four holdout
rewrites are too few for a stable population percentage, the holdout contains 274 general word-order
annotations outside this narrow construct, and written target hypotheses are not exhaustive. The
correct claim is: **the app eliminated two demonstrated unsafe rewrite contexts without losing its
confirmed internal detection cases; general word-order coverage remains unvalidated and low.**

### Blinded unmatched-positive triage

A deterministic sample of 40 unmatched-positive documents was regenerated through the production
checker, producing 138 reviewable correction fragments. The blind pack hides the provider, rule ID,
MERLIN label, CEFR, L1, item hash, and full document. Contact/number/URL fragments are redacted.

An internal single-AI first pass reviewed the first deterministic 50 corrections while blind to the
key: 33 valid, one acceptable alternative, 15 potentially harmful, and one unclear. This 30% harmful
signal is **not gold truth** and cannot justify a public accuracy claim or an automatic production
rule change. It is a prioritization signal for independent human adjudication.

The failure pattern matters more than the headline rate: several proposed fixes used the wrong case
or repaired one word while leaving the displayed “correct” sentence ungrammatical. The current
`looksLikeTrustworthyCorrection()` gate therefore does not prove that a complete promoted answer is
trustworthy. Rule-wide suppression is also unsupported: `DE_AGREEMENT` produced 27 usable and nine
potentially harmful corrections in the reviewed sample.

The next valid gate is two independent qualified German raters reviewing the same frozen blind pack,
followed by inter-rater agreement and adjudication. Only confirmed harmful patterns may influence
calibration rules; development and holdout remain unopened.

That gate is now operationally prepared. `docs/MERLIN_HUMAN_ADJUDICATION_PROTOCOL.md` defines the
qualification, independence, verdict, and privacy requirements. The local tools generate ID-only
review templates, reject incomplete/tampered/extra-field reviews, require two distinct attested
reviewers, report raw agreement plus unweighted Cohen's kappa, produce only the frozen disagreement
fragments for adjudication, and preserve agreed verdicts during final aggregation. Review artifacts
and fragment-bearing files are mechanically blocked from the application repository. No human
ratings have been supplied yet, so this preparation does not change the evidence verdict.

### Frozen data and leakage controls

1. Keep every corpus outside the application repository and never deploy it.
2. Record dataset version, source URL, license, archive SHA-256, acquisition date, and parser version.
3. Split by immutable author/speaker ID before development: 60% calibration, 20% development,
   20% locked holdout, deterministic seed `20260715`.
4. Stratify the MERLIN split by fair CEFR and Arabic-L1 status.
5. Never inspect holdout outputs while changing rules. One signed evaluation run opens the holdout.
6. Do not persist or log raw corpus text, audio, personal fields, model prompts, or provider payloads.
7. Keep only item hashes, bounded labels, subsystem outputs, error categories, and aggregate metrics.
8. Preserve CC attribution. Do not copy MERLIN-derived cases into a differently licensed public
   source corpus; any shared adaptation must satisfy ShareAlike.

### S2: grammar benchmark

1. Map MERLIN TH1/TH2 edits to an explicit evaluation taxonomy before scoring.
2. Evaluate LanguageTool-only, guarded-LLM-only, and merged output independently.
3. Score exact/overlapping error spans, correction acceptability, type agreement, and F0.5.
4. Report the harmful false-correction rate separately and prioritize it over recall.
5. Report all-German, Arabic-L1, A2, B1, and B2-family slices with Wilson 95% intervals.
6. Human-adjudicate a fixed random sample of apparent false positives because target hypotheses are
   reference corrections, not proof that every alternative German sentence is invalid.

### S1: ASR benchmark

1. Pin a Common Voice German release and its per-dataset license before acquisition.
2. Use official speaker-disjoint splits; create speaker-disjoint splits if none are supplied.
3. Pass audio through the exact production transcription path without storing provider responses.
4. Normalize reference/hypothesis identically and publish WER/CER plus provider failures.
5. Report scripted and spontaneous results separately. Never average them.
6. Do not call this Arabic-L1 accuracy: Common Voice metadata does not provide a representative
   Egyptian Arabic-L1 German subset.

### S3–S6: target-population gold study

Public corpora cannot close these gates. Run a consented study with at least two independent,
qualified German raters who are blind to the app's verdict:

1. Recruit Egyptian Arabic-L1 A2/B1/B2 candidates targeting German customer-service work.
2. Record a standardized baseline containing screening, behavioral, customer-roleplay, and listening
   tasks; retain audio only under explicit consent and a fixed deletion schedule.
3. Let the app abstain or select exactly one observable bottleneck and one drill.
4. Have both raters independently mark observable errors, severity, top bottleneck, and acceptable
   intervention; adjudicate disagreements before comparing the app.
5. Run the prescribed practice, then a delayed matched retest and a genuinely novel pressure retest.
6. Keep a participant-level locked holdout unseen during rule development.
7. Report inter-rater agreement before app agreement. If human agreement is weak, the label is not
   suitable ground truth.
8. Measure top-1 bottleneck agreement, correct abstention, harmful misdirection, prescription
   appropriateness, and novel-transfer change. Employment outcomes remain a separate longitudinal
   measure and are never inferred from simulation scores.

The complete local review mechanism is now implemented for the first frozen spoken criterion,
`handle-clear-request`; see `docs/SPOKEN_GOLD_STUDY_PROTOCOL.md`. It creates a blinded media pack,
hidden app-decision key, two independent review templates, an inter-rater report, a disagreement-
only adjudication template, and a text-free aggregate final report. It rejects private-data fields,
cross-split participants, missing or mismatched media, incomplete/unattested reviews, same-reviewer
substitution, agreement rewriting, and mastery without both matched and novel evidence. Owner smoke,
five target candidates, and two qualified ratings remain external inputs and have not been fabricated.

The hidden app decision is no longer operator-authored. Pack creation now loads a private baseline
server-profile snapshot and optional final snapshot outside the repository, recomputes the two bound
`request_handling_score` measurements, applies the frozen below-75 rule, derives the fixed production-
aligned `druck-leiter` prescription, and accepts mastery only from the production transfer-proof
validator. Typed verdict fields, packet edits, mixed accounts, changed baseline evidence, duplicated
profiles, prototype keys, symlinks, malformed JSON, and profile/output leakage fail closed. The raw
audio-to-profile correspondence remains a documented operator attestation because OMNI-PERFORM
deliberately does not persist raw audio; it is not represented as a cryptographic media binding.

## Decision gates

These are proposed release gates, not achieved results:

- Harmful false diagnosis/correction: target 0; every instance requires review.
- Correct abstention on insufficient/contradictory evidence: at least 95% before invited beta.
- Observable bottleneck agreement with an adjudicated expert panel: at least 80% with a reported
  95% confidence interval before describing the diagnosis as validated.
- Prescription appropriateness: at least 80% panel agreement and zero unsafe prescriptions.
- Transfer: improvement must survive the novel pressure retest; matched-only improvement is not
  mastery.
- No hiring probability, teacher-replacement claim, or time-to-employment promise until a separate,
  preregistered, adequately powered outcome study supports it.

## Immediate execution order

1. Correct grammar provenance so merged output cannot impersonate LanguageTool-only output.
2. Build the local, non-deployed benchmark harness and immutable manifest.
3. Run MERLIN calibration/dev first; do not open the holdout.
4. Freeze the rules, then run the one locked holdout evaluation.
5. Run Common Voice ASR benchmarking as a separate report.
6. Use those results to decide whether threshold calibration is enough or model changes are justified.
7. Begin the target-population gold study for S3–S6. Do not fine-tune before this evidence exists.

## Current truth

OMNI-PERFORM is **internally verified, externally unproven**. The recovered research gives a legal,
independent route to measure written grammar and German ASR subsystems. It does not provide the
missing proof for the product's central spoken coaching promise. The correct next move is evaluation,
not training.
