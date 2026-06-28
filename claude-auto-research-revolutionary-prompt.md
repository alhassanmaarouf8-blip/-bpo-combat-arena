# Claude Code Auto-Research Prompt — Revolutionary Improvements for OMNI-PERFORM / bpo-combat-arena

PASTE THE BLOCK BELOW DIRECTLY INTO CLAUDE CODE'S AUTO-RESEARCH / AUTO-REFRESH FEATURE AS THE RESEARCH PROMPT. DO NOT SUMMARIZE IT.

---

PRODUCT: OMNI-PERFORM (repo: bpo-combat-arena) — a German voice interview trainer in a boss-fight format. Target users are Egyptian BPO agents aiming to pass German-language job interviews (YNAP, Comcast, Verizon, TravelPerk, VRBO, etc.). Core loop: student speaks German → Deepgram STT → Groq/Cerebras LLM generates interviewer response → ElevenLabs/Deepgram TTS → boss speaks back.

CURRENT STACK: Node.js server (Express + WebSocket), client-side Vite/React, Postgres + file k/v store, Deepgram streaming STT, Groq/Cerebras LLM, ElevenLabs/Deepgram Aura-2 TTS, Deepgram Voice Agent (Gemini) for boss AI.

NON-NEGOTIABLE CONSTRAINTS:
- Post-speech response MUST stay under 2 seconds end-to-end (user rejects 5–6s delays)
- Zero-API-cost preference; keep voice/Realtime intact
- Keep the "hard data → evidence-based fixes" ethos already embedded in the codebase
- Do NOT spend money without explicit go
- In-memory latency buffer is capped at 80 turns; client-side instrumentation for TTS/playback is not yet measured

TUNNEL-VISION FOCUS (the ONE mission):
Make OMNI-PERFORM the single most TIME-EFFICIENT, PERSONALIZED, and EFFECTIVE German-speaking fluency system in existence. The metric that wins is: how few PRACTICE HOURS does it take a motivated Egyptian graduate to reach interview-ready German versus ANY other resource (Deutsche Welle, Babbel, iTalki, VHS courses, Sprachcaffe, university tracks, Duolingo Max). If a student can reach C1 interview-ready in 30% less calendar time than every competitor — and the proof is measured inside the app — then OMNI-PERFORM wins.

INSTRUCTION TO RESEARCHER / CLAUDE AGENT:

Do NOT describe generic features. Every finding must answer: how does it compound the student's speaking fluency per unit of calendar time invested? What is the compounding loop? Be ruthlessly specific about mechanism, data flow, and latency impact.

Map EVERY component of the app precisely, then audit each for optimization potential. Components to map:

1. SYMPTOMOLOGY — The true physiology of German-speaking fluency
   - What does a student actually GO THROUGH when learning spoken German? Frustration curve, fossilization periods, plateaus, accent correction loops, filler-word elimination, transition from "parsed but slow" to "native-tempo automatic."
   - Break fluency into operator-defined sub-skills: prosody, sentence-initial automaticity, embedded-clause recovery, filler suppression, stress-register control, humor/politeness register, etc.
   - For each sub-skill, identify its compounding character: does it lift all other skills (high-leverage) or only itself (low-leverage)?

2. ARCHITECTURE AUDIT — cold head on every node
   - Map the full request/response and WebSocket flows from USER_AUDIO_END → BOSS_SPEAKS_START → BOSS_SPEAKS_END → USER_HEARS.
   - For each hop, compute and expose: current latency, what it's bounded by, and whether it's on the critical path or can run in parallel.
   - Identify the true theoretical minimum latency the current stack can reach (not marketing claim, actual physics).
   - Identify the CURRENT latency ceiling of the app WITHOUT new infrastructure (just exploiting existing capabilities — prompting, memory layout, parallel calls, streaming).
   - Identify architecture-level upgrades that would change the ceiling: on-device client-side LLM for prefill/suggestion, WebTransport, WASM VAD, dedicated TTS streaming, edge inference, X middleware, etc.

3. THE COMPOUNDING CURRICULUM ENGINE — the moat
   - Current app model: boss-fight interviews with scoring + Alhassan mentor + spaced review + assess-once intake.
   - Research the neuroscience of "what compound interest looks like in motor-skill language learning": optimal practice distribution, sleep consolidation, interleaving, desirable difficulties, spacing effect per individual forgetting curve (not one-size-fits-all SRS), reactivation schedules, deliberate practice design.
   - Propose a NEW internal curriculum model that is not generic "spaced repetition" but a personalized rehearsal schedule optimized for EACH STUDENT's specific deficit vector (e.g., this student fossilizes on "weil" clause order, that student fills 18 times per minute, etc.).
   - Design the data schema and decision rules. Show how it records each weakness, estimates the forgetting curve for that specific weakness, and schedules the NEXT encounter to maximize retention while minimizing total reps.
   - Make the math concrete: how many turns to mastery? How does the model reduce total practice time vs. random/passive practice?

4. FIRST-TOKEN-TO-SPEECH PIPELINE — the user-perceived latency battle
   - Current app: LLM generates full boss reply → then TTS streams. This is the biggest gap.
   - Research and specify exactly: how to generate AND stream first-audio simultaneously using the EXISTING providers (Groq + ElevenLabs streaming or Deepgram Aura-2). Which provider supports partial synthesis? What's the integration pattern?
   - Research whether Cerebras reasoning model fallback is the silent 2x gap — identify the mechanism and mitigation.
   - Research whether Deepgram streaming STT can finalize/flush earlier with tuned VAD thresholds (silence padding values, interim transcript confidence thresholds, speech_final manipulation).
   - Design a "warm-standby" LLM prefill pattern: while the student is speaking, prefetch the most likely boss responses into a short cache using the last 3 turns' context, so the user-stops → boss-starts is near-instant.

5. REAL-TIME PROSODY & FLUENCY COACHING — the feature no competitor has at scale
   - What can be measured in real-time from the WebSocket audio stream before/while the user speaks? Pause distribution, syllable-timed vs. stress-timed rhythm, pitch contours, filler rate, truncated clauses, word-final devoicing, vowel length errors specific to German, self-interruption rate.
   - Research Deepgram's streaming features: word-level timing, confidence, alternative hypotheses, speaker energy — what is actually available today?
   - Design a real-time non-intrusive coaching layer: NOT a popup that interrupts the flow, but subtle haptic/audio cues (a soft tap sound for filler, a gentle pitch-flutter for intonation error), OR a "shadow overlay" where the student sees a captured waveform comparison vs. native model after their turn.
   - Design a post-turn "debrief strip" that labels exactly where they hesitated, where they filled, where they truncated — in 2 seconds, not 20.

6. INTERVIEWER PERSONALITY FIDELITY SYSTEM — boss variety that stays in memory
   - Current: boss voice is fixed (Deepgram Aura-2 German). The boss model has memory and personality, but single-persona.
   - Research how to model different German interview archetypes: the cold Bavarian HR director, the warm but sharp Berlin startup founder, the quiet Swiss precision-assessor, the exhausting "tell me everything" micro-manager, the non-native-but-fluent interviewer (very common in BPO).
   - Each archetype must have distinct phrasing, pacing, patience threshold, question library, and evaluation rubric. The student can pick or be assigned.
   - Research whether this can be done WITHIN the existing context window budget by swapping system prompts + curated few-shot examples per turn, or whether it requires a separate inferencing path.
   - Design the data schema: interviewer state per session, how many turns they keep patience, when they interrupt, how they reformulate.

7. MEASUREMENT & HIRE-READINESS FORECASTING SYSTEM — the value that justifies 2999/month
   - Current: assessment gives CEFR estimate + blockers. That's weak.
   - Research what ACTUAL hiring managers measure: latency to first coherent sentence, recovery from a mistake, handling a switch to English mid-interview, explaining a CV gap, stress questions ("why should we hire you"), structuring answers STAR-method.
   - Design a measurement system that tracks ALL of these across sessions and trends them.
   - Design a "hiring forecasting engine" — not "you will get hired" (prohibited by existing safety rules) but "on current trajectory, you are above / below / at threshold for [company X style interview] based on [quantified signal Y]."
   - Make it self-calibrating: as real-world outcomes are collected (students who pass/fail real interviews), the model updates its weights. This is the compounding data moat.

8. COMPETITIVE INTELLIGENCE — what everyone else gets wrong
   - Research: iTalki, Preply, Lingoda, Babbel, Deutsche Welle Learn German, Goethe-Institut online, Munich Language School, Sprachtrainer.com, Voxy for BPO, any BPO-specific prep platforms.
   - For each: what is their speaking practice model? Latency? Personalization? Feedback granularity? Price? What is their theoretical ceiling for a motivated Egyptian in Cairo with German C1 target over 6 months?
   - Identify their structural weaknesses: high latency between turns, scripted rather than generative, generic feedback, no memory, session caps, expensive human tutors (50 EGP/minute vs OMNI-PERFORM flat), no compounding curriculum, accent mismatch.
   - Design OMNI-PERFORM against each competitor's ceiling — what must be true for OMNI-PERFORM to achieve 2x speed-to-fluency over the BEST competitor?

9. LOW-COST HIGH-LEVERAGE UPGRADES — what can ship this week with existing stack
   - Identify 10 concrete improvements that require zero new paid API, zero new infrastructure, and yet measurably lift either: (a) latency, (b) compounding retention, (c) perceived quality, or (d) diagnostic depth.
   - Each must include: file touched, exact code change, expected latency delta or retention delta, and risk.

10. THE "IMPOSSIBLE" LIST — features that would truly make OMNI-PERFORM the most efficient speaking-fluency system
    - Brainstorm 10 truly novel features that no existing competitor combines, grounded in the current stack and constraints. Examples to beat or ignore:
      - "Dream consolidation" loop: late-evening spoken rehearsal hooks into sleep-consolidation theory by triggering a brief review 20 min before typical sleep onset
      - "Mother-tongue interference map": model Egyptian Arabic → German interference patterns explicitly; predict and surface the exact fossilizations before they form
      - "Microdosing": 90-second daily minimum practice threshold that, when compounded weekly, exceeds a 3-hour weekly session; scientifically grounded by motor-skill micro-dose literature
      - "Shadowing with in-ear native": while boss speaks, student speaks simultaneously; AI measures shadow-lag (delay between native and student) as a fluency metric
      - "Fluency state" vs. "Accuracy state" toggle: train automaticity separately from precision, a model cribbed from music practice (slow vs. fast practice)
    - Each entry: name, mechanism, what metric it improves, data it requires, latency cost, implementation approximate effort.

OUTPUT FORMAT (exact; follow strictly):

Return the following sections in order, no preamble, no closing:

## 1. Current Architecture Map
[Graph description of: web → wsManager → [Deepgram STT, respond() → Groq/Cerebras, TTS], stores, auth; show the critical path and existing latency instrumentation points. Include a list of every .js file in server/ and its role.]

## 2. Component-Level Optimization Audit
For each major component, provide a table: Component | Current Implementation | Latency/Quality Ceiling | Upgrade Path | Would it change the critical path?

## 3. The Compounding Curriculum Engine (Design Spec)
[3–5 paragraphs of tightly reasoned design, then a data-model sketch with field names and types.]

## 4. First-Token-to-Speech Architecture
[One exact integrated design for parallel streaming prefetch + first-token-aware TTS handoff. Include provider-specific code paths.]

## 5. Real-Time Prosody Coaching Layer
[What can be measured now (Deepgram streaming output), what requires a new provider, and the non-intrusive UX pattern.]

## 6. Interviewer Personality Fidelity System
[Archetype catalog, prompt structure, context-window budget analysis, evaluation rubric per archetype.]

## 7. Hire-Readiness Forecasting System
[Metrics to track, evaluation dimensions, self-calibrating model design, schema example.]

## 8. Competitive Mapping
[Table: Competitor | Speak-Practice Model | Flat-Rate Option | Personalization | 6-Month Ceiling for Egyptian Learner | OMNI-PERFORM Advantage]

## 9. Immediate Wins (Zero-Cost Upgrades)
[Numbered list 1–10 with file, change, expected delta, risk.]

## 10. The Impossible List
[Numbered list 1–10 with name, mechanism, metric improved, data required, latency cost, effort.]

END with exactly this sentence:
"REVOLUTIONARY_FOUNDATION_LAID — ready for prioritization and build."

NO additional commentary. NO warnings about token cost. NO hedging. This is research, not a product pitch.
