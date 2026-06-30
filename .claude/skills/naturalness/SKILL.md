---
name: naturalness
description: The playbook for making the OMNI-PERFORM AI interviewer feel MORE alive than a human — within the first 10 seconds. Use whenever working on the live interview's words, voice, timing, memory, or personality, or when the owner says it "sounds like a bot / reads scripted lines / Angemessenheit is off". $0 only (Groq + Deepgram).
---

# naturalness — make the interviewer feel human ($0)

The interview IS the product. It must feel like a real person, not pre-programmed lines read in sequence. Five orthogonal levers — fix the one that matches the complaint, but the real wins are CROSS-lane (one shared state driving several).

## The core idea: give the boss an *Innenleben* (one living per-session state)
Don't add disconnected tweaks. Drive everything from ONE evolving state per session:
- **`bossEmotion`** (warmth/arousal, drifts toward the persona baseline, nudged each turn by the candidate's score) → the candidate can "win the room." DELIVERY ONLY — the scorer stays mood-blind so it's never unfair. Wire it like `requestCorrection`: a pending flag the gateway sets after scoring, consumed by `respond()` next turn (realtimeClient.js).
- **`claimLedger`** (deterministic capture of the candidate's concrete words: role/employer/number/named situation) → forces CALLBACK (reuse their exact word later), CONTRADICTION ("vorhin X, jetzt Y"), THREAD (next question grows from their answer). Token-NEGATIVE if you trim the unbounded transcript replay in exchange.

## The five lanes (levers)
1. **Words** (realtimeClient.js TURN_RULE, scenarios.js, interviewer-characters.json): sampling penalties + temp on Groq ONLY (not the Cerebras reasoning failover); real Modalpartikeln (denn/doch/mal); ban worn openers ("Das ist interessant"); rolling anti-repeat from the boss's own last turns; seeded per-session idiolect; few-shot examples must MATCH the rules (they teach harder than rules).
2. **Voice** (Deepgram Aura-2, transcribeRouter.js): Aura has NO SSML and REJECTS `?speed=` (verified 400 — see [[verify-empirically]]). Real free levers = client `audio.playbackRate`+`preservesPitch`, clause-by-clause synthesis with punctuation-derived silence gaps, a cached non-lexical "Hm… also…" onset, preserving `. . .` breath cues in cleanForTTS.
3. **Timing** (websocketManager loop, App.jsx VAD): fill the 1.5-3s LLM "thinking" silence with a pre-synthed backchannel; jittered (non-metronome) latency; barge-in (BargeInMonitor.js is written but UNWIRED).
4. **Memory** (the claimLedger above) + tell the boss its current stage+goal each turn.
5. **Personality** (scenarios.js MOODS, personas): emotion must reach the WORDS (it was HUD-only); mood should DRIFT not freeze; per-persona register = **Angemessenheit** (a strict director must NOT say casual "gibt's/ne?").

## Hard rules
- $0 only: Groq (free) + Deepgram (existing). NO new service — see [[never-spend-money]].
- Register must fit the persona (Angemessenheit) — never one casual tone for all.
- "Alive" must stay FAIR: affect/mood touches delivery only; the scorer never reads it.
- Boss German must pass `check-german`; verify the actual generated feel with `hear-voice`.
- Audio-loop changes (barge-in, mic-during-boss) are the ONE high-risk area — they break the half-duplex anti-echo gate (boss voice transcribed as the user on weak-AEC Android). Ship behind an OFF-by-default flag + owner live-test. See `fix-echo`.
- Verify before shipping ([[verify-empirically]]); ship via `ship`; track in the [[naturalness-innenleben-plan]] notes.
