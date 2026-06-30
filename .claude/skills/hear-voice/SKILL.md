---
name: hear-voice
description: Evaluate the boss interview VOICE objectively — synthesize the Aura voice, transcribe it back to measure intelligibility, report speech-rate/loudness, and save WAVs to listen to. Use when assessing voice quality or "does it sound fake/robotic".
---

# hear-voice — give yourself ears (free, uses the existing Deepgram key)

Run: `node scripts/qa/voice-check.mjs ["optional custom German line" ...]`
(reads `DEEPGRAM_API_KEY` from `server/.env`; defaults to 3 sample boss lines).

Reports per line: duration, ~words/min, peak loudness, the STT transcript heard back, and an
**intelligibility %** (synth → speech-to-text round-trip — 100% means the voice is perfectly clear).
Saves `boss_1.wav`… for a human to actually listen to.

Honest limit: this proves **clarity + pacing + loudness** objectively; subjective *timbre/naturalness*
still needs the owner's ear (that's what the WAVs are for). The voice is Aura-2 (free-tier, blue-chosen
over paid ElevenLabs) — realism is driven by the spoken-register boss prompt, not paid TTS.
