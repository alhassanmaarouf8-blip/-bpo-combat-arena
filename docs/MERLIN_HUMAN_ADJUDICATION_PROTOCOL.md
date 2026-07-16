# MERLIN correction adjudication protocol

## Purpose

This protocol measures whether each proposed written-German change is acceptable and safe. It does
not validate spoken German, CEFR, interview readiness, learning transfer, or hiring outcomes.

## Reviewer requirements

Use two distinct reviewers who can independently judge standard written German at an advanced
professional level. Each reviewer must attest that they:

- are proficient enough to explain German grammar corrections reliably;
- completed the review without seeing the provider, rule ID, MERLIN label, CEFR, L1, item hash, or
  the other reviewer's answers; and
- disclosed uncertainty as `unclear` rather than guessing.

Record evidence of reviewer qualification and conflicts separately under owner control. Do not put
names, email addresses, credentials, or employment details in the benchmark files.

## Frozen material

Both reviewers receive the same frozen blind-pack bytes. The pack contains only short redacted
`before` and `after` fragments. It does not contain full learner documents. Do not add context from
the hidden key or search for the original learner text.

## Verdicts

- `valid`: the change is necessary and the resulting fragment is correct.
- `acceptable_alternative`: the original is acceptable, but the proposed result is also correct and
  does not distort meaning.
- `harmful`: the change introduces an error, changes meaning unjustifiably, or presents a partial
  repair as a correct answer while the resulting fragment remains wrong.
- `unclear`: the redacted fragment lacks enough context for a reliable judgment.

Judge the entire displayed `after` fragment, not merely the replaced token. Use a short reviewer
note for `harmful` and `unclear` verdicts. Do not infer learner ability or intent.

## Independent workflow

1. Generate one ID-only review template per reviewer with
   `npm run benchmark:merlin:create-review -- --pack <pack> --reviewer-id <opaque-id> --out <file>`.
2. Reviewers work separately and fill every verdict. They set both attestation fields to `true` only
   after completing the independent review.
3. Compare completed files with
   `npm run benchmark:merlin:compare-adjudicators -- --pack <pack> --rater-a <file-a> --rater-b <file-b> --out-report <report> --out-disagreements <pack>`.
4. Report raw agreement and unweighted Cohen's kappa before resolving disagreements.
5. A qualified adjudicator resolves only the generated disagreement pack with a brief rationale.
6. Finalize the aggregate with
   `npm run benchmark:merlin:finalize-adjudication -- --pack <pack> --key <key> --rater-a <file-a> --rater-b <file-b> --resolution <resolved-pack> --out <final-report>`.
7. Keep review files and fragment-bearing disagreement material outside the application repository.
   Only aggregate, text-free results may be committed.

## Decision safety

Do not change a production rule because of a single reviewer, the internal AI triage, or a small
rule slice. Calibrate only confirmed harmful patterns on calibration data, rerun independent review
where behavior changes, then freeze the rules before development and locked-holdout evaluation.
