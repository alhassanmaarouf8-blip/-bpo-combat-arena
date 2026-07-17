# Expert-Gold Accuracy Harness

This private, offline harness compares OMNI-PERFORM's server-derived learning decisions with two
independent qualified German raters and a third adjudicator only where the raters disagree. It does
not calculate a single "app accuracy" score and must not be used to claim hiring probability.

## Frozen protocols

The versioned registry covers clear-request handling, service recovery, professional `Sie` register,
response continuity, sustained pace, phone intelligibility, three exact grammar-control families,
and clear/telephone listening. Each protocol freezes its evidence requirement, observable threshold,
allowed production drills, dose, rating scales, abstention behavior, and transfer requirement.

## Private directory

All inputs and outputs must be direct files in a directory outside the repository. Raw audio,
profile snapshots, Salma text, hidden keys, reviews, adjudication, and reports must never be committed
or deployed. The owner snapshot contains only allowlisted session, listening, and transfer-proof
fields. It excludes contact data, transcripts, raw answers, payment data, vacancy data, and audio.

## Workflow

```text
npm run study:expert-gold -- create --input <absolute-input.json> --dir <absolute-private-dir>
npm run study:expert-gold -- validate --input <absolute-input.json> --dir <absolute-private-dir>
npm run study:expert-gold -- compare --dir <absolute-private-dir>
npm run study:expert-gold -- adjudicate --dir <absolute-private-dir>
npm run study:expert-gold -- finalize --input <absolute-input.json> --dir <absolute-private-dir>
```

`create` freezes a blinded pack, hidden authoritative key, and two blank review forms. Raters see only
opaque IDs, media filenames, level band, phase, and the frozen rubric. They never see app decisions,
scores, participant identity/split, account/session IDs, previous reviews, or selected prescriptions.

`compare` validates two complete, independently attested reviews from distinct raters and reports
inter-rater agreement before any app comparison. `adjudicate` accepts exactly the disagreement set
and validates the complete third-rater decision. `finalize` re-derives every app decision from the
authoritative snapshots, verifies all content hashes, excludes owner/synthetic smoke, writes separated
metrics and Wilson intervals, and permanently writes a holdout-opening receipt. A second holdout
finalization fails closed.

## Interpretation

Reports remain `pilot-evidence-only` below 30 participant-disjoint target learners or below ten
participant-disjoint cases for any protocol included in the frozen pack. Missing denominators fail
their gates. Every metric is also emitted by criterion, modality, level, protocol, and task
archetype; aggregate success cannot hide a failing slice.

The software can be verified at zero cost. Actual expert-gold accuracy remains unknown until two
qualified independent humans voluntarily rate consented, anonymized evidence and disagreements are
adjudicated. Synthetic audio, Codex journeys, the owner, and AI judgments are smoke evidence only.
