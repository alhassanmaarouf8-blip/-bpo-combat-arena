# Voice Reality Lab — first black-box run

**Date:** 2026-07-17  
**Production tested:** `https://omni-perform.vercel.app/`  
**Purpose:** give the Reality Lab reproducible audible German learner speech without altering any
interviewer voice, persona, microphone policy, Gemini/Deepgram path, or WebSocket format.

## Capacity built

- `scripts/qa/voice-reality-lab.mjs` generates deterministic 24 kHz mono WAV fixtures using the
  installed free local Edge speech tool and FFmpeg.
- Profiles: clean, slow, rushed, quiet, noisy, and clipped.
- Every fixture has a content-derived ID and JSON manifest.
- The same harness can play the WAV through the real computer output for black-box browser QA.
- A second, exact-input adapter is available only in a localhost development build opened with
  `?voiceLab=1`. It accepts a local RIFF/WAVE file, plays it audibly, and gives the same MediaStream
  to the existing AudioRecorder. Production builds have no endpoint, token, or activation path for it.

## Live acoustic journey

| Surface | Fixture | Observed production result | Conclusion |
|---|---|---|---|
| Shadowing | Exact displayed sentence, clean German voice | Transcript matched the displayed sentence. `WORTGENAUIGKEIT · %` omitted its number. | Real voice capture works. QA-V185 compatibility defect confirmed and fixed locally with an honest unavailable fallback. |
| Flow round 1 | 54-word deliberately broken answer, slow profile | Production reported 172 W/min, 54 words, 0 fillers and offered round 2. | End-to-end recording, STT and metric response worked. This run alone does not validate grammar accuracy or the WPM clock. |
| Sag es richtig | Deliberately wrong order-number request | Production rejected it and showed `Könnten Sie mir bitte Ihre Bestellnummer nennen?`; acoustic STT heard only `… Musik …`. | The grading route fails closed, but speaker-to-mic playback is not valid precision evidence because echo cancellation corrupts it. |
| Salma in Sag es richtig | Spoken German question asking why/how to repeat | Production accepted the voice turn and returned a tutor answer. | Voice question transport works. The acoustic transcript was not exposed, so answer relevance cannot be attributed to exact source speech. |

## Evidence boundary

This run proves that Codex can generate audible controlled speech and exercise the real production
microphone path. It does **not** prove phoneme-level pronunciation accuracy. Browser acoustic echo
cancellation materially changed one fixture. Pronunciation counterfactuals must therefore use the
localhost exact-stream adapter or consented human recordings before they can validate the app.

## Verification

- Voice harness contract tests: 3/3 green.
- Production build removes/unexposes the localhost-only control.
- Full suite and production artifact gate are required before the branch can ship.
