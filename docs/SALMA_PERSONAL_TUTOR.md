# Salma Personal Interview Tutor

Salma is an evidence-driven explanation layer around BrainGuide. BrainGuide remains the only source
of the learner's next action. Salma may explain that action, give its exact dose, answer a bounded
question, or surface one verified correction between attempts. She does not diagnose independently,
represent an employer, book interviews, or claim that drill performance proves mastery.

## Release controls

All switches fail closed and default off:

- `SALMA_COACH_MODE=off|beta|on`
- `SALMA_COACH_BETA_ACCOUNT_IDS=` comma-separated immutable account IDs
- `SALMA_COACH_AI_ENABLED=false`
- `SALMA_COACH_VOICE_ENABLED=false`
- `SALMA_MASRI_PACK_VERSION=`

AI and voice cannot activate unless the master mode is enabled. Masri stays unavailable even when a
pack version is configured until the reviewed phrase-pack implementation is separately shipped.
`SALMA_LIVE` remains the existing client-side emergency control for Salma surfaces.

## Data boundary

Only preferences, evidence-hashed prescriptions, bounded repetition progress, acknowledgements, and
the last meaningful retest session ID are stored under the immutable account profile. Questions,
audio, transcripts, emails, raw learner answers, and generated free-form text are not stored in the
tutor state. A meaningful live-interview debrief is the only mastery confirmation path.

## Rollout

Keep every switch off for the initial release. Then use an owner account in beta mode, verify five B1
learners receive accurate and different prescriptions, and add Masri only as native-owner-approved,
hashed audio assets. Production voice and Masri remain off until ear, mobile, microphone, and overlap
tests pass.
