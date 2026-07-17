# Pronunciation and professional-clarity truth contract

Status: foundation implemented; all phoneme categories remain **unvalidated and disabled**.

The existing Deepgram/Whisper path measures recognition and supplies transcripts. It is not a phoneme judge.
The pronunciation subsystem keeps four outputs separate: recording quality, phone intelligibility, phoneme
production, and professional prosody. Recording failure vetoes language claims and never becomes a learner defect.

`server/pronunciationRegistry.js` is the frozen claim boundary. Merely listing a category does not enable it.
A category becomes usable only through a release artifact bound to the same protocol version and passing all
expert-gold gates. Unknown categories, harmless variants, conflicting models, poor audio, unsupported surfaces,
missing versions, and unavailable detectors abstain.

## Validation sequence

1. Build offline candidate detectors; never connect an unvalidated detector to learner state.
2. Smoke-test with controlled audio and Common Voice for recognition robustness only.
3. Collect consented Egyptian Arabic-L1 A2/B1/B2/pseudo-C1 evidence, with two independent qualified raters.
4. Freeze detector, rubric, thresholds, protocol, and participant-disjoint holdout.
5. Evaluate each deviation category separately. Missing denominators fail.
6. Create a signed category release only after every gate passes.
7. Owner beta, then 5–10 consenting learners. Prompted tasks precede spontaneous interpretation.

No raw audio, transcript, identity, or employer data belongs in release reports. Synthetic and owner audio are
smoke evidence only. Matched improvement is not mastery without a novel pressure transfer pass.

