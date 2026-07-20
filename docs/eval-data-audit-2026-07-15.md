# Evaluation-Data Audit + $0 Benchmark Plan — OMNI-PERFORM
**Date:** 2026-07-15 · **Method:** deep-research workflow (5 search angles → 15 primary-source fetches → 74 claims extracted → top 10 adversarially verified, all 10 survived 1-0) · **Rules obeyed:** no single "app accuracy %"; primary sources only; verbatim licenses; NOT VERIFIED > invented.

**Evidence tiers used throughout:**
- ✅ **VERIFIED** — claim survived an adversarial verifier that independently re-fetched the primary source on 2026-07-15.
- ⚠️ **EXTRACTED, NOT VERIFIED** — a fetch agent read the primary source and quoted it, but the claim was outside the 10-claim verification budget. Treat as probably-true; re-check before acting on it legally.
- 🔍 **SEARCH-ONLY** — surfaced by a search snippet; the source was never fetched (fetch budget cap). Weakest tier.
- ❌ **NOT FOUND** — searched for, no public dataset surfaced.

**Scope disclosure (honesty):** per owner instruction this run was capped at 15 fetch agents and 10 verify agents. All 10 verified claims concern MERLIN. Two whole angles — Arabic-L1/Egyptian learner data and CEFR-labeled SPOKEN performances (Goethe/telc/ÖSD) — were searched but their sources were **never fetched** (15 sources were budget-dropped). Verification was single-verifier (1-0 votes), not a 3-vote panel. 64 of 74 extracted claims are unverified.

---

## 1 · Executive verdict (≤10 lines)

1. **Exactly one fully verified, $0, commercially usable independent benchmark asset exists today: MERLIN v1.2** (CC BY-SA 4.0, public access, verbatim-verified). It covers **S2 (grammar-error detection) and S3 (CEFR signal) — written modality only**.
2. MERLIN's labels are genuinely independent expert ground truth: two trained professional raters per language, CEFR-compliant analytic grid, Rasch-adjusted "fair" per-text levels — **stronger than raw exam grades**, and external to the repo's self-authored corpora. ✅
3. **MERLIN contains zero audio.** It cannot say anything about S1 (accented spontaneous ASR), S4 (spoken fluency), or any spoken-interview claim. Every S2/S3 number derived from it must carry the label "written-exam German, not spoken interview". ✅
4. The two big public spoken-German corpora are **license-dead for you**: DGD/FOLK and GeWiss both restrict to scientific, non-commercial use (verbatim terms quoted below). ⚠️
5. Common Voice German (~1,390 validated hours) is the only large open speech option, but it is **read/scripted 5-second clips** — a total modality mismatch with spontaneous interview speech; usable only as a weak S1 smoke test, never as an S1 claim. ⚠️
6. **No public corpus of Egyptian (or any Arabic-L1) learner German speech was found.** The closest is a 25-subject Syrian-Arabic phonetics study — unusable as a benchmark. ❌
7. Therefore: public data can harden **S2 and S3 (written)** now, and nothing else. **S1, S4, S5, S6 and every population-specific claim still have no independent public benchmark** — they fall to the Phase-4 gold study, which remains the decisive proof and the fastest honest number.

---

## 2 · Dataset table (ranked by scientific usefulness)

| # | Dataset | Verdict | License (tier) | Modality | Best for | One-line reason |
|---|---------|---------|----------------|----------|----------|-----------------|
| 1 | **MERLIN v1.2** (Eurac CLARIN) | **USABLE NOW** | CC BY-SA 4.0, access "PUB" — verbatim ✅ | Written exam texts | S2, S3 | The only verified independent expert-labeled learner-German asset; 1,035 German texts, fair-CEFR A1–C2, FALKO-style target hypotheses + error spans. |
| 2 | **Falko-MERLIN GEC corpus** (Boyd 2018, github.com/adrianeboyd/boyd-wnut2018) | USABLE — pending license check | Inherits Falko + MERLIN terms; **Falko terms NOT VERIFIED** ⚠️ | Written | S2 | Ready-made benchmark: 24k sentences / 381k words, train/dev/test splits, 56 error types — saves you building splits yourself. |
| 3 | **Mozilla Common Voice German, cv-corpus-26.0** (2026-06-12) | USABLE WITH RESTRICTIONS | CC0 per listing — **not verbatim-verified** ⚠️ | **Read/scripted**, avg clip 5.27 s | S1 smoke test only | 1,489.78 total / 1,392.36 validated hrs, 20,529 contributors, accent/age/gender metadata ⚠️ — but read short sentences ≠ spontaneous interview speech; share of L2/Arabic-accented speakers unknown. Note: the "Scripted Speech 25.0" Data Collective page 404s — use current release. ⚠️ |
| 4 | Goethe/telc/ÖSD published speaking-exam samples (e.g. Goethe B1 Modellsatz ~13-min Sprechen video) | **NOT VERIFIED — highest-value open lead** | Unknown 🔍 | Spoken exam performance | S3 (spoken calibration) | Never fetched (budget cap). If any carry official ratings + usable terms, this is the only $0 route to CEFR-labeled German speech. |
| 5 | **DGD / FOLK** (IDS Mannheim, v2.26: 459 events, 1,468 speakers, 401 h) | **REJECT for this use** | "wissenschaftliche und nicht-kommerzielle Nutzung für Forschung, Lehre oder Studium" ⚠️ (verbatim from official terms) | Spontaneous native German | — | Scientifically ideal for S1/S4, legally dead: non-commercial academic use only; commercial evaluation of a paid product doesn't qualify. |
| 6 | **GeWiss** (276 events, 92 h, 480 speakers, incl. L2 academic German) | **REJECT under default terms** | Private/non-commercial; "Testzwecke" (test purposes) require operator permission (Herder-Institut, Uni Leipzig) ⚠️ | Spoken academic | — | A written permission from the operator is the only route — possible but not $0-certain and not now. |
| 7 | Syrian Arabic learners of German — intonation study (MDPI Languages, 2025) | REJECT as benchmark | Unknown 🔍 | Elicited read sentences | — | N=25 learners, elicited SVO sentences, phonetics focus — fails the <10-speaker-adjacent bar for any population claim and the spontaneity bar. Only value: proof that Arabic-L1 German speech data barely exists publicly. |
| 8 | Mozilla "Spontaneous Speech 2.0" (Dec 2025, 62 datasets) | NOT USABLE (no German shown) | — | Spontaneous | — | Release post never names German among the 62; no evidence a German spontaneous set exists. ⚠️ |

---

## 3 · Claim-to-dataset matrix (per subsystem)

| Subsystem | Best independent data | Reference label | Metric | Biggest limitation (one sentence) |
|-----------|----------------------|-----------------|--------|-----------------------------------|
| **S1** ASR robustness | ~~none usable~~ (CV-DE as smoke test only) | CV validated transcripts | WER on read speech, reported as "read-speech WER", never "interview WER" | Read 5-second clips share almost nothing with accented spontaneous interview speech, and the Arabic-accent subset size is unknown. |
| **S2** Grammar-error detection | **MERLIN v1.2** (+ Falko-MERLIN GEC splits if Falko license clears) | Manually annotated error spans anchored to TH1 target hypotheses (TH2 for A2/B2 core subset) | Span-level precision / recall / F1 vs LanguageTool output; plus correct-abstention rate | MERLIN's error taxonomy ≠ LanguageTool rule categories — a documented mapping must be built first, and unmapped MERLIN spans are "expected misses", not false negatives. |
| **S3** CEFR/level signal | **MERLIN v1.2** (German subcorpus) | Rasch-adjusted "fair" CEFR level per text (two trained raters) | Weighted kappa (quadratic) between OMNI level estimate and fair level; report per-level | Written essays ≠ spoken interviews — this calibrates the written proxy only, and C1 (n=42) / C2 (n=4) tails are too thin to claim anything above B2+. |
| **S4** Fluency/listening metrics | none | — | (unit-test determinism only, self-authored) | No legally usable spoken corpus with fluency ground truth exists; deterministic code correctness ≠ metric validity. |
| **S5** Bottleneck diagnosis | none | — | top-1 bottleneck agreement + harmful-false-diagnosis rate — **measurable only in the gold study** | No public dataset pairs learner sessions with expert bottleneck diagnoses; this is inherently gold-study territory. |
| **S6** Improvement verification | none | — | agreement with blind-rater improvement verdicts — **gold study only** | Requires longitudinal matched retests of the same learners; no such public German corpus surfaced. |

### CANNOT-PROVE list (with public data, as of 2026-07-15)
- Bottleneck-diagnosis accuracy (S5) on any population, let alone Egyptian Arabic-L1.
- Written→spoken-interview transfer of any S2/S3 result.
- Any spoken-modality metric for the target population (S1 accented-spontaneous WER, S4 fluency validity).
- Improvement verification (S6) against independent raters.
- **Anything about employability or hiring outcomes.** (Never claim it.)
- Population match: no verified claim even establishes whether MERLIN's German subcorpus contains a single Arabic-L1 learner (metadata check required at download).

---

## 4 · Runnable $0 benchmark spec (S2 + S3, the provable part)

**Acquisition (legal, verified route):**
1. Landing page is behind an Anubis anti-bot wall — acquire via the **GitLab data bundle**: `gitlab.inf.unibz.it/commul/merlin-platform/data-bundle`, tag **v1.2** (ships the CC BY-SA 4.0 LICENSE inside), or the CLARIN OAI-PMH record (handle `20.500.12124/59`).
2. On download, re-verify: exact text counts (primary sources disagree — 2,290 vs 2,262 vs 2,286), presence of per-text learner IDs and L1 metadata, and v1.1→v1.2 annotation-coverage diffs. These are **known open questions**, not assumptions to silently make.

**License compliance (the one trap):** CC BY-SA's ShareAlike clause triggers on **redistribution of adapted material**. If MERLIN-derived fixtures were committed to the repo, the repo would carry BY-SA obligations. **Rule: never commit MERLIN data.** The benchmark script downloads the bundle at run time into a git-ignored `server/scoring/external/` cache; only aggregate metrics (numbers, not texts) are committed. Attribution line in the benchmark README: MERLIN project, Eurac Research CLARIN, CC BY-SA 4.0.

**Inclusion/exclusion:** German subcorpus only; exclude texts whose fair-CEFR level is C1/C2 (n=46, too thin) from headline metrics; report them separately. For S2 class-level F1, use only spans coverable by the MERLIN→LanguageTool category mapping (publish the mapping file alongside).

**Split:** learner-disjoint (by learner ID from metadata — if IDs are absent, fall back to text-level split and SAY SO) · 60% calibration / 40% **LOCKED holdout**, fixed seed 20260715, holdout hashes committed before any tuning run. The holdout is opened once per release, never during development.

**Mapping to OMNI-PERFORM inputs:**
- S2: MERLIN raw learner text → the exact text path LanguageTool receives in `server/scoring` (same normalization); expected output = MERLIN error spans (TH1-anchored; TH2 layer only for the A2/B2 core subset).
- S3: MERLIN raw text → the level-estimation input; expected output = fair CEFR level. **These append to the existing `server/scoring/*Accuracy.test.mjs` ratchet corpora as a separate `external-merlin` suite with its own ratchet** — never merged into the self-authored fixtures, so independent and self-authored evidence stay distinguishable.

**Reporting rules:** every percentage ships with n and a 95% CI (Wilson for proportions); per-CEFR-level breakdown, never one pooled number; each result labeled "written-exam German (MERLIN), not spoken interview". Harmful-false-diagnosis rate (S2 flagging correct German as wrong) reported beside recall.

**Redaction/deletion:** MERLIN is distributed pseudonymized; obligation = don't attempt re-identification, delete local cache on request/termination of use. No learner PII enters the repo (nothing is committed at all).

---

## 5 · Minimal gold-standard study (the decisive proof — 1 page)

**Purpose:** the only honest route to numbers for S1, S4, S5, S6 and to *any* claim about Egyptian Arabic-L1 spoken German. Public data cannot substitute (see §3).

- **Participants:** 20–30 consenting Egyptian Arabic-L1 candidates, A2–B2 self-or-test-placed, recruited from the existing user base / training-center contacts. Written informed consent covering recording, rating, retention, deletion-on-request, anonymized aggregate publication. No payment claims, no hiring promises.
- **Tasks:** standardized BPO interview simulation (fixed scenario bank, counterbalanced), plus one speaking and one listening task per session. Two sessions per candidate: baseline → (training interval) → **matched retest + one novel/pressure retest** (S6).
- **Raters:** two independent, qualified German raters (C2/native, teaching/assessment background), **blind** to session order, candidate identity, and app scores. Disagreements ≥1 CEFR band → adjudication by a third rater. Report inter-rater agreement (quadratic weighted kappa) **before** any app-vs-rater number.
- **Measures:** S1 — WER of the app's transcription vs human transcript on the interview audio. S3 — app level vs adjudicated rater level (weighted kappa). S4 — app fluency metrics vs rater fluency sub-scores (correlation, direction only). S5 — top-1 bottleneck agreement between app diagnosis and raters' independently written "single biggest weakness", plus harmful-false-diagnosis rate. S6 — app improvement verdict vs rater improvement verdict on matched + novel retests.
- **Holdout discipline:** a locked subset of recordings (25%) is scored by the app only once, after all prompt/threshold tuning is frozen.
- **What n=20–30 supports:** a **pilot estimate** with wide CIs — honest for internal ratchets and a "piloted with n=…" line; **not** a public accuracy claim. A public claim needs a pre-registered replication at larger n.
- **Privacy:** audio stored encrypted, keyed by pseudonym; deletion on request; raters sign confidentiality; no employer names anywhere (standing rule).

---

## 6 · NOT-FOUND list (gaps requiring newly collected data)

As of 2026-07-15, this bounded sweep (5 angles; note: Arabic-L1 and CEFR-spoken angles searched but not deep-fetched) found **no legally usable public corpus of**:
1. Egyptian Arabic-L1 German learner speech — at any level, any modality. ❌
2. Arabic-L1 German learner speech of benchmarkable size (best found: N=25 Syrian elicited-sentence study). ❌
3. CEFR-labeled spontaneous German **speech** with commercial-evaluation-compatible terms. ❌ (Goethe/telc/ÖSD samples = unverified lead, §2 row 4.)
4. German **interview/service dialogues** with transcripts under open license. ❌
5. Longitudinal learner-German retest data (S6-shaped). ❌
6. Learner-session → expert-bottleneck-diagnosis pairs (S5-shaped). ❌

Each of these is exactly what the §5 gold study generates for the population that matters.

---

## 7 · Recommended sequence (decision, not menu)

1. **Now ($0, ~1 day of work):** MERLIN v1.2 download → metadata check (learner IDs? L1s? counts?) → locked split → `external-merlin` S2/S3 ratchet suite beside the existing self-authored ones.
2. **Next (30 min):** verify the two cheap leads this run couldn't reach — Goethe/telc/ÖSD sample-performance terms, and Falko's license (unlocks the ready-made Falko-MERLIN GEC splits).
3. **The decisive move:** run the §5 gold study. The dataset work above hardens two subsystems; the gold study is the only thing that produces an honest, sellable, population-true accuracy story. **Do not let dataset research postpone it.**

---

### Appendix — provenance & run stats
- Workflow: 32 agents (1 scope, 5 search, 15 fetch, 10 verify, 1 synthesize), 0 errors, ~5.4 min, ~572k subagent tokens. 74 claims extracted; 10 verified (all survived, 1-0 single-verifier votes); 64 unverified; 15 sources budget-dropped unfetched (owner-set caps: 15 fetch / 10 verify).
- Key verified sources: CLARIN Eurac handle 20.500.12124/59 (license re-fetched live 2026-07-15); LREC 2014 MERLIN paper (lrec-conf.org/proceedings/lrec2014/pdf/606_Paper.pdf, Table 1 + §3.2 read in full); merlin-platform.eu corpus/annotation/research pages; GitLab data-bundle v1.2 LICENSE.
- Key unverified-but-quoted sources: DGD terms (dgd.ids-mannheim.de), AGD FOLK v2.26 + GWSSin stats (agd.ids-mannheim.de), GeWiss Handbuch (gewiss.uni-leipzig.de), cv-dataset 26.0 (github.com/common-voice/cv-dataset), Mozilla Discourse Spontaneous Speech 2.0 post.
- Full agent-level evidence: session workflow journal `wf_65bb1717-3a5/journal.jsonl`.
