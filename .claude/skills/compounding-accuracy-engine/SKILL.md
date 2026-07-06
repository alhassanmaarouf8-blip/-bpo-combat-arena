---
name: compounding-accuracy-engine
description: The universal structure for making ANY learner-facing core functionality in OMNI-PERFORM self-improving, verifiable, and zero-hallucination — it compounds toward its highest accuracy over time and can never regress. Apply when building or hardening grammar, scoring/CEFR, bottleneck detection, STT trust, drill targeting, or any feedback the student sees. Owner directive 2026-07-05: "structured so it's dynamic, learns from itself, compounds — generalize it across the core functionalities."
---

# The Compounding Accuracy Engine

One pattern, applied to every core functionality. Each functionality gets **three artifacts that only ever grow**, plus **one loop that feeds them**.

## The three artifacts (per functionality)

1. **Ground-Truth Corpus** — labeled real cases: an input + the KNOWN-correct output, next to **guard-negatives** (inputs that must NOT trigger the behavior). Lives as a `*.test.mjs` under `server/`. Every confirmed real case is appended forever → knowledge grows monotonically. (Reference impl: `server/scoring/grammarAccuracy.test.mjs`.)
2. **Regress-Guard** — the test asserting two invariants:
   - **ZERO-HARM invariant (HARD FAIL):** the thing that must never happen (flag correct German / a false hire-verdict / blame a mis-heard turn) has count **0**. A change that breaks it can never be committed.
   - **RATCHET invariant:** the quality number (recall / accuracy) is pinned to a **floor that only rises**. A regression fails the build.
3. **Rulebook** — the deterministic logic (rules/detectors/thresholds). Deterministic is the only *provably* zero-hallucination kind — an LLM can be tested on a sample but never proven safe on unseen input, so LLMs are only ever **candidate generators**, never the authority.

## The loop (nightly, on the routine fleet — the system learns from itself)

```
OBSERVE  mine recent real sessions for what the Rulebook MISSED (false neg) or wrongly did (false pos)
PROPOSE  an LLM proposes {new rule + labeled corpus cases (positive + guard-negatives)}  ← candidate only
VERIFY   run the FULL corpus with the proposal. Accept ONLY IF zero-harm stays 0 AND the ratchet climbs.
COMPOUND commit rule + cases. Baseline is now permanently higher. Repeat.
```
The LLM proposes; the corpus disposes. Learns like an AI, proves like a test.

## Generalization map — apply to each core functionality

| Functionality | Corpus (input → known output) | ZERO-HARM invariant (must be 0) | Ratchet metric |
|---|---|---|---|
| **Grammar** (done: foundation) | learner sentence → error class / correct | flag correct German | recall on error classes |
| **CEFR grade / verdict** (done 07-05: `server/scoring/hireReadinessAccuracy.test.mjs`) | feature-vector → known level+hireReady+limitingSkill | false "hireable" OR false "fail" flip (guards the hire gates) | level + limiting-skill match |
| **Bottleneck / priorityFix** (done 07-05: `server/scoring/bottleneckAccuracy.test.mjs`) | transcript → known #1 weakness (`topL1Pattern`) | MISDIRECT (name a non-dominant weakness) or HALLUCINATE (invent one) | top-1 bottleneck recall |
| **STT trust (law 7)** (done 07-05: `server/scoring/sttTrustAccuracy.test.mjs`) | turn text → cut-off flag (`looksTruncatedDE`) | miss a COVERED-class cut-off → graded as learner weakness | fragment-recall + complete-specificity |
| **Drill targeting** | named weakness → correct drill | drill that doesn't address the weakness | weakness→drill match |
| **Naturalness / scoring** | utterances → known band | penalize correct/natural speech | band-match rate |

## How to apply it to a new functionality (checklist)

- [ ] Write `server/**/<name>Accuracy.test.mjs` with a CORPUS array (start with the cases you can hand-label now — even 15 is enough to lock the invariant).
- [ ] Assert the ZERO-HARM invariant = 0 (HARD). Report the ratchet metric; pin a floor.
- [ ] Make the deterministic Rulebook the authority; any LLM is a labeled, non-authoritative candidate generator behind the corpus gate.
- [ ] Add a nightly fleet routine that runs OBSERVE→PROPOSE→VERIFY→COMPOUND and only patches when the corpus still passes.
- [ ] Wire Guardian/CI to run these `*Accuracy.test.mjs` so accuracy can never silently regress on any commit.

## Why this is the whole answer
Every core functionality becomes: **provably safe (zero-harm invariant), monotonically better (ratchet), self-improving (the loop), and 100% verifiable (every point is a command you run).** Accuracy is no longer something we claim — it's something the build enforces and time increases.
