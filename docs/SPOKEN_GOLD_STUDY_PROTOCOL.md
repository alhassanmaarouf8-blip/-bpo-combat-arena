# Spoken Diagnosis-to-Transfer Gold Study

**Status:** profile-derived tooling complete; owner smoke and qualified human ratings not yet supplied
**Frozen protocol:** `clear-request-handling-v1`
**Accuracy claim:** none until the complete target-population gate is measured

This protocol validates one observable criterion at a time. It cannot validate employment odds,
teacher replacement, psychology, confidence, therapy needs, or why a candidate made an error.

## Frozen first criterion

| Field | Frozen value |
|---|---|
| Interview archetype | German customer-service candidate handling a clear customer request |
| Stage | customer roleplay |
| Observable criterion | `handle-clear-request` |
| Failure | fewer than three ordered acts: confirm/clarify the request, take ownership or a concrete action, then state a concrete next step |
| App threshold | below 75/100 |
| Required evidence | exactly two distinct, server-recorded, reliably transcribed spoken opportunities under Evidence Contract v2 |
| Abstain | typed input, interruption/truncation, low-confidence transcription, duplicate media, fewer than two opportunities, or conflicting evidence |
| Base prescription candidate | one `druck-leiter` block; five rungs; ten minutes; retry the failed response before the rung; matched retest after the prescribed spacing; later novel roleplay |

This is a simulation criterion, not an employer decision. The rule remains frozen until two blind,
independent, qualified German raters review the same evidence and disagreements are adjudicated.

## Required order

1. **Owner smoke only:** the owner completes two baseline roleplay opportunities, the prescribed
   drill, a delayed matched retest, and a later novel retest. This checks capture, provenance,
   diagnosis display, BrainGuide routing, Salma explanation, drill execution, and retest binding.
   The owner case is mechanically excluded from every accuracy percentage.
2. **Five consenting target candidates:** Egyptian A2/B1/B2 candidates seeking German customer-
   service work. Use three calibration participants, one development participant, and one locked
   participant holdout. A participant may never cross splits.
3. **Two blind ratings:** both raters independently review the same opaque media files. They must not
   see the app decision, score, participant identity, split, or the other rater's work.
4. **Inter-rater report first:** raw agreement and nominal Cohen's kappa are generated before any
   app comparison.
5. **Adjudication:** a qualified adjudicator resolves only generated disagreements and cannot change
   agreements.
6. **App comparison:** only after adjudication does the hidden key reveal the app decision for
   aggregate scoring.

## Human qualification and independence

A rater must attest to professional German-language assessment, DaF/DaZ teaching, or equivalent
German interview-evaluation experience. Raters use distinct opaque IDs, work independently, and do
not see app outputs or each other's verdicts. AI labels, synthetic learners, the owner, and app tests
are never gold truth.

Each rater records, per blinded case:

- whether baseline evidence is sufficient, insufficient, or conflicting;
- the single observable top bottleneck, or an explicit abstention;
- every acceptable existing drill for that bottleneck;
- matched-retest pass/fail/insufficient status;
- novel-pressure pass/fail/insufficient status; and
- an optional bounded note.

## Privacy boundary

- Raw audio and review files stay outside the application repository and are never deployed.
- The app repository stores no transcript, audio, name, email, phone, employer, session identifier,
  URL, or participant identifier.
- Media is referenced only by opaque relative filenames such as `p01_baseline_a.wav`.
- Pack creation verifies that every referenced clip exists beside the private input, is a regular
  non-linked 512-byte-to-100-MB file, and has a WAV/MP3/M4A/Ogg header matching its extension.
- Every case requires versioned consent and a deletion date.
- The hidden key stores only a one-way participant hash, split, deletion date, and bounded app
  decision derived from the private server snapshots. The aggregate report stores no participant
  hash, profile path, account identifier, evidence identifier, or decision binding.
- The operator cannot type an app score, diagnosis, prescription, or mastery claim. Pack creation
  loads an exact baseline server-profile snapshot and optional final snapshot from the private study
  directory, verifies their immutable account identity, recomputes both baseline measurements, and
  accepts mastery only from the production matched-plus-novel transfer validator.
- Because the product intentionally does not persist raw audio, the operator must attest that each
  blinded recording is the chronological capture of the exact server session represented by the
  adjacent private snapshot. This is a procedural provenance boundary, not a cryptographic audio
  binding; any uncertain mapping invalidates the case.
- Duplicate media, cross-split participants, unknown fields, absolute paths, and private-data field
  names fail closed.

## Local commands

All arguments and outputs below must point outside the repository.

The first owner-smoke `input.json` uses this exact shape. The four media files and two private server
profile snapshots sit beside it. The baseline profile must be captured immediately after the second
study opportunity and contain exactly those two customer-service baseline opportunities. The final
profile is captured after the matched and novel retests. Use opaque participant and file IDs; never
add a transcript, name, email, phone, employer, session ID, URL, app verdict, or raw media field to
the manifest.

The production admin panel now exposes an owner-only **spoken gold snapshot** download for the
account selected in User detail. The request is a protected POST, is marked `no-store`, and returns
only the immutable account ID, allowlisted server-recorded session evidence, and bounded Salma
transfer-proof state. It excludes contact, payment, push, vacancy, free-form feedback, and raw
transcript fields. Download once after the second baseline opportunity and again after the novel
retest; rename the two files to the opaque filenames referenced by the manifest.

```json
{
  "schemaVersion": 1,
  "protocol": {
    "protocolId": "clear-request-handling-v1",
    "criterionId": "handle-clear-request",
    "archetypeId": "clear_customer_request",
    "stageId": "customer_roleplay",
    "failureThreshold": 75,
    "minimumReliableOpportunities": 2,
    "evidenceContractVersion": 2,
    "frozenAt": "2026-07-16T12:00:00.000Z"
  },
  "cases": [{
    "participantId": "owner_smoke_001",
    "split": "owner_smoke",
    "levelBand": "b1",
    "consentAttested": true,
    "consentVersion": "spoken-gold-v1",
    "captureBindingAttested": true,
    "deleteBy": "2026-08-15",
    "baselineArtifacts": ["owner_001_baseline_a.wav", "owner_001_baseline_b.wav"],
    "matchedArtifact": "owner_001_matched.wav",
    "novelArtifact": "owner_001_novel.wav",
    "baselineProfileArtifact": "owner_001_baseline_profile.json",
    "finalProfileArtifact": "owner_001_final_profile.json"
  }]
}
```

This is a structural example, not participant evidence. The pack creator derives the hidden app
decision itself. It rejects manually supplied `appDecision` fields, mixed accounts, changed baseline
packets, profile reuse, prototype keys, non-canonical paths, symlinks, malformed JSON, or profiles
outside the size bound. If either baseline opportunity is typed, interrupted, duplicated, tampered,
or otherwise ineligible, the derived verdict abstains. If one reliable opportunity passes and the
other fails the frozen threshold, it abstains as conflicting evidence.

```powershell
npm run study:spoken:create -- `
  --input C:\private-study\input.json `
  --out-pack C:\private-study\blind-pack.json `
  --out-key C:\private-study\hidden-key.json `
  --out-review-a C:\private-study\rater-a.json `
  --out-review-b C:\private-study\rater-b.json

npm run study:spoken:compare -- `
  --pack C:\private-study\blind-pack.json `
  --rater-a C:\private-study\rater-a.json `
  --rater-b C:\private-study\rater-b.json `
  --out-report C:\private-study\inter-rater-report.json `
  --out-disagreements C:\private-study\disagreements.json

npm run study:spoken:finalize -- `
  --input C:\private-study\input.json `
  --pack C:\private-study\blind-pack.json `
  --key C:\private-study\hidden-key.json `
  --rater-a C:\private-study\rater-a.json `
  --rater-b C:\private-study\rater-b.json `
  --resolution C:\private-study\disagreements.json `
  --out C:\private-study\aggregate-final.json
```

The generated review templates are deliberately incomplete. A template, an AI-filled review, or an
unattested review contributes no evidence.

Finalization reloads the original private snapshots, re-derives every hidden verdict through the
production measurement and transfer validators, re-verifies the media files, and rejects any edited
pack or hidden key before calculating the aggregate. The aggregate stores hashes of all source
artifacts for auditability but contains no profile path, account ID, evidence ID, or decision binding.

## Beta gates

The finalizer reports inter-rater agreement before app agreement and enforces:

- at least five target participants, excluding owner smoke;
- the frozen three-calibration, one-development, one-holdout participant split;
- at least 95% correct abstention on insufficient/conflicting cases;
- at least 80% agreement with the adjudicated expert bottleneck;
- at least 80% agreement that the prescribed drill is appropriate;
- zero harmful misdirection;
- zero mastery claims lacking both matched and novel expert passes; and
- separate matched and novel transfer rates with Wilson 95% intervals.

A missing denominator is not a pass. A failed gate names the next layer to repair; it is never
hidden, averaged away, or converted into a broad “app accuracy” percentage.

## Current honest blocker

The software package can enforce privacy, blinding, independence, adjudication order, and aggregate
metrics. It cannot manufacture the owner's spoken smoke case, five consenting target candidates, or
two qualified human judgments. Until those inputs exist, OMNI-PERFORM remains internally verified
and externally unproven for spoken bottleneck selection, prescription quality, and transfer.
