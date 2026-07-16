# Diagnostic Truth System

OMNI-PERFORM separates five different claims that must never be collapsed:

1. **Measurement:** a bounded observable value from server-trusted spoken evidence.
2. **Pattern:** whether the same exact criterion repeated in the same simulation archetype.
3. **Cause:** why the pattern occurred. This remains unestablished unless a later validated study can
   distinguish competing explanations.
4. **Treatment hypothesis:** the one BrainGuide drill selected to test and improve the observed
   pattern. Completing it is not evidence of improvement.
5. **Transfer:** a delayed matched retest followed by a novel/pressure retest. This can establish a
   narrow performance change, but not that the drill caused it or that an employer will hire the user.

## Public truth packet

The server emits only bounded enum IDs and already-public numeric observations:

- `state`: measurement, provisional, conflicted, repeated, historical, or no-single-pattern state.
- `patternConfidence`: repeatability of the observable pattern only.
- `causeStatus`: currently always `not_established`.
- `observedFact`: exact criterion, stage, observed value, internal reference, direction, and unit.
- `possibleExplanations`: allowlisted alternatives; never psychology or employer intent.
- `nextDiscriminatorId`: the next comparison that can separate alternatives.
- `limitations`: internal-simulation, non-employer, and non-causal caveats.

The packet never contains transcripts, audio, email, employer text, vacancy text, session IDs, model
prose, or evidence IDs. Salma renders it under “Warum genau das?” and creates no competing action;
BrainGuide remains the single next-action authority.

## What is verified now

- Spoken evidence is server-authoritative and mixed typed/spoken packets fail closed.
- Thin, interrupted, stale, duplicated, contradictory, foreign-archetype, and legacy evidence cannot
  become a high-confidence pattern.
- Speech-recognition confidence never becomes a pronunciation diagnosis without preserving device,
  recognizer, and articulation alternatives.
- Latency, incomplete answers, and fillers never become anxiety, motivation, confidence, or therapy
  diagnoses.
- Exact grammar rules require repeated, fresh, conflict-free support.
- Improvement requires durable matched and novel transfer proof.

## What remains unvalidated

No software test can prove educational or employment validity. Expert transcript/audio adjudication,
multiple real learners, delayed blind transfer tasks, and consented interview outcomes are required
before claiming teacher replacement, causal learning effects, hiring probability, or time-to-employment.
