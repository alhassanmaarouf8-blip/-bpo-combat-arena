# Independent code review request — "the interviewer waits until my words finish writing, then responds"

You are reviewing the voice turn-taking pipeline of a German job-interview training app.
The founder reports: *"The AI interviewer waits until my spoken words are fully written on
screen, and only then does he respond. It feels slow and gated on the transcript."*

Your job: **find any code path where the boss's (interviewer's) response is actually gated on
transcript completion or on any client-side event — or confirm the wait is provider latency.**
Be adversarial. If the architecture is fine but something is mis-tuned (VAD sensitivity, buffer,
event ordering), say exactly what and where.

## System architecture (the premium voice path)

```
Browser mic (24 kHz PCM)
  → WebSocket AUDIO_CHUNK (b64) to Node server
    → server downsamples 24→16 kHz, forwards to Google Gemini Live API (native speech-to-speech)
      → Gemini does VAD (turn-end detection), understanding, and reply-audio generation SERVER-SIDE at Google
    ← Gemini streams back: input transcript chunks (your words), output transcript chunks, and PCM16@24kHz reply audio
  ← server relays audio as BOSS_AUDIO_DELTA frames + transcripts as LIVE_USER_TRANSCRIPT_PARTIAL / LIVE_BOSS_TRANSCRIPT
Browser plays reply audio gaplessly on a 24 kHz AudioContext
```

Key claim to verify: **on this path the on-screen transcripts are DISPLAY-ONLY.** Nothing in
client or server is supposed to wait for the transcript to finish before the boss can speak.
(There is a separate $0 fallback pipeline — STT→LLM→TTS — where the transcript genuinely gates
the reply; a silent fallback to it would explain the symptom, so the funnel counts
`gemini_fight` vs `gemini_fallback`.)

## Measured facts (hold me honest against them)

- Turn gap measured on prod (4-turn speech probe, 2026-07-10): user-quiet → boss-audio 1.34–1.57 s.
- Gemini "thinking" is already disabled (`thinkingBudget: 0`) — enabling it doubled latency (2.05 s → 1.10 s when disabled, measured).
- Turn-end VAD is tuned fast: `silenceDurationMs: 400`, `END_SENSITIVITY_HIGH`.
- Funnel today: 16 `gemini_fight`, 0 `gemini_fallback` — the fights run on the premium path.
- A "CHEF DENKT NACH…" (boss is thinking) indicator lights 600 ms after transcript chunks go quiet, cleared by the first reply-audio byte.

## Review questions

1. Is there ANY code below where boss audio playback or generation waits on transcript state?
2. Is the perceived "waits until words are fully written" simply: Gemini transcribes while you
   speak → your last words paint ~0.3–0.5 s after you stop → reply audio arrives ~1.4 s after you
   stop — i.e. correct behavior that *looks* causal?
3. Anything that would ADD latency: the 600 ms think-timer (display only?), the client player's
   scheduling, the server relay, the downsampling, event ordering?
4. Any race/regression risk you can see that would make this intermittently worse?

---

## 1) server/geminiLive.js — the Google socket (VAD + session config)

```js
import { WebSocket } from 'ws';

const HOST = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest';

async function frameToJson(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (data && typeof data.arrayBuffer === 'function') {
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'));
  }
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString('utf8'));
  if (Buffer.isBuffer(data))       return JSON.parse(data.toString('utf8'));
  return JSON.parse(Buffer.from(data).toString('utf8'));
}

export function openGeminiLive({ apiKey, systemInstruction, model = DEFAULT_MODEL, voiceName, handlers = {} }) {
  if (!apiKey) throw new Error('geminiLive: apiKey required');
  const h = handlers;
  const ws = new WebSocket(`${HOST}?key=${apiKey}`);
  let ready = false;

  const setup = {
    setup: {
      model,
      generationConfig: {
        responseModalities: ['AUDIO'],
        // Thinking OFF: the -latest native-audio alias thinks before answering, which doubled
        // measured turn latency (first audio 2.05s -> 1.10s with budget 0, same key/model/voice).
        thinkingConfig: { thinkingBudget: 0 },
        ...(voiceName ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } : {}),
      },
      // Faster end-of-turn: detect the candidate finishing sooner (interview turns are short);
      // 400ms silence + high end sensitivity measured setup-valid with no latency penalty.
      realtimeInputConfig: { automaticActivityDetection: { endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', silenceDurationMs: 400 } },
      systemInstruction: { parts: [{ text: systemInstruction }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };

  ws.on('open', () => { ws.send(JSON.stringify(setup)); });

  ws.on('message', async (data) => {
    let msg;
    try { msg = await frameToJson(data); }
    catch (e) { h.onError?.(new Error('geminiLive: bad frame: ' + e.message)); return; }

    if (msg.setupComplete) { ready = true; h.onReady?.(); return; }

    const sc = msg.serverContent;
    if (sc) {
      const parts = sc.modelTurn?.parts || [];
      for (const p of parts) {
        if (p.inlineData?.data && String(p.inlineData.mimeType || '').includes('audio')) {
          h.onAudio?.(Buffer.from(p.inlineData.data, 'base64'));        // PCM16 @24kHz
        }
      }
      if (sc.inputTranscription?.text)  h.onInputText?.(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) h.onOutputText?.(sc.outputTranscription.text);
      if (sc.interrupted)               h.onInterrupted?.();
      if (sc.turnComplete)              h.onTurnComplete?.();
    }
    if (msg.usageMetadata) h.onUsage?.(msg.usageMetadata);
    if (msg.error) h.onError?.(new Error('geminiLive server error: ' + JSON.stringify(msg.error)));
  });

  ws.on('error', (e) => { h.onError?.(new Error('geminiLive ws error: ' + (e?.message || 'unknown'))); });
  ws.on('close', (code, reason) => { ready = false; h.onClose?.(code, reason?.toString?.() || ''); });

  return {
    isOpen: () => ready && ws.readyState === 1,
    sendAudioChunk(base64Pcm16k) {
      if (ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64Pcm16k }] } }));
      return true;
    },
    sendText(text) {
      if (ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
      return true;
    },
    close() { try { ws.close(); } catch {} },
  };
}
```

## 2) server — mic forwarding (is anything gated here?)

```js
_handleAudioChunk(ctx, msg) {
  if (!ctx.realtimeClient || ctx.closed) return;
  if (!msg.data) return;

  // Gemini Live path: forward the mic to Gemini, RESAMPLED 24 kHz -> 16 kHz (the browser mic is
  // 24 kHz; Gemini's input contract is 16 kHz — sending 24 kHz tagged as 16 kHz makes it mishear).
  // Barge-in ON (default): keep streaming even while the boss speaks so Gemini's VAD hears the
  // interruption. Barge-in OFF: half-duplex — drop the mic while the boss talks (echo-safe on
  // speakers). If the proxy rejects a chunk (closed between frames), fall through to Deepgram so a
  // transcript is still captured for scoring.
  if (ctx.geminiProxy) {
    if (!GEMINI_BARGE_IN && ctx.geminiActive) return;   // half-duplex anti-echo (only when barge-in disabled)
    if (!ctx._geminiTurnStartMs) ctx._geminiTurnStartMs = Date.now();
    const pcm16k = downsamplePcm24to16(Buffer.from(msg.data, 'base64'));
    ctx.audioInBytes += pcm16k.length;
    const sent = ctx.geminiProxy.sendAudioChunk(pcm16k.toString('base64'));
    if (sent) return;
    console.warn(`[wsManager] Gemini proxy reject chunk -> fallback Deepgram  session=${ctx.sessionId}`);
  }
  // ($0 Deepgram path continues below — not the path under review)
}
```

## 3) server — Gemini event handlers (audio relay, transcript relay, turn commit)

```js
const proxy = new GeminiLiveProxy({
  handlers: {
    onReady: () => {
      ctx.geminiActive = true;   // boss is about to greet (half-duplex gate; barge-in mode ignores it)
      this._send(ctx, { type: S.SESSION_READY, useGeminiAudio: true, sessionId: ctx.sessionId, bossHp: ctx.bossHp, playerHp: ctx.playerHp });
      // Gemini Live never speaks unprompted — without this kick the interviewer sits SILENT
      // until the candidate talks first.
      try { proxy.sendText('(Der Kandidat ist jetzt im Gespräch. Beginnen Sie das Interview auf Deutsch mit Ihrer Begrüßung.)'); } catch {}
    },
    onBossAudio: (buf) => {
      // Latency instrumentation: last user-transcript chunk -> first audio byte of the boss's NEXT turn.
      if (!ctx.geminiActive && ctx._gLastUserTextMs) {
        const gapMs = Date.now() - ctx._gLastUserTextMs;
        ctx._gLastUserTextMs = null;
        try { recordTurn({ flushMs: 0, prepMs: 0, llmMs: gapMs, serverTotalMs: gapMs, provider: 'gemini-live' }); } catch {}
      }
      ctx.geminiActive = true;
      ctx.geminiGreeted = true;
      this._send(ctx, { type: S.BOSS_AUDIO_DELTA, data: buf.toString('base64') });   // <- relayed IMMEDIATELY
      ctx.audioOutBytes += buf.length;
    },
    onBossText: (chunk) => {
      if (chunk === '[INTERVIEWER SPRICHT]') { ctx.geminiActive = true; ctx.geminiGreeted = true; return; }
      if (chunk === '__TURN_COMPLETE__') {
        const bossFull = ctx.geminiBossParts.join('').trim();
        const userFull = ctx.geminiUserParts.join('').trim();
        ctx.geminiBossParts = [];
        ctx.geminiUserParts = [];
        ctx._geminiTurnStartMs = 0;
        const prevBossLine = [...ctx.dialogue].reverse().find((d) => d.role === 'boss')?.text || '';
        if (bossFull) {
          ctx.dialogue.push({ role: 'boss', text: bossFull, stage: ctx.stageIdx, stageLabel: ctx.stages[ctx.stageIdx]?.label });
        }
        ctx.geminiActive = false;
        this._send(ctx, { type: S.BOSS_SPEECH_DONE });
        if (ctx._geminiClosingSent) {
          if (bossFull && !ctx.closed) this._endSession(ctx, 'completed');
          return;
        }
        // Scoring happens AFTER the boss already voiced the turn (skipRespond = no second brain).
        const guard = userFull.length >= 2 ? isGarbageUserTurn(userFull, prevBossLine) : { garbage: false, reason: null };
        if (guard.garbage) {
          this._maybeRequestGeminiClosing(ctx);
        } else if (userFull.length >= 2) {
          Promise.resolve(this._handleAnswer(ctx, { text: userFull, durationMs: 0 }, { skipRespond: true }))
            .catch(() => {})
            .finally(() => { this._maybeRequestGeminiClosing(ctx); this._maybeAnnounceGeminiLastQuestion(ctx); });
        } else {
          this._maybeRequestGeminiClosing(ctx);
        }
      } else {
        ctx.geminiBossParts.push(chunk);
        this._send(ctx, { type: S.LIVE_BOSS_TRANSCRIPT, text: chunk });
      }
    },
    onUserText: (chunk) => {
      ctx.geminiUserParts.push(chunk);
      ctx._gLastUserTextMs = Date.now();   // latency clock: your words transcribed -> boss's first audio byte
      // Wrong-alphabet chunks (hallucinations of echo/noise) never paint the live subtitle.
      if (latinFraction(chunk) < 0.5 && /\p{L}/u.test(chunk)) return;
      this._send(ctx, { type: S.LIVE_USER_TRANSCRIPT_PARTIAL, text: chunk });
    },
    onInterrupted: () => {
      ctx.geminiActive = false;
      this._send(ctx, { type: S.BOSS_INTERRUPTED });
      this._send(ctx, { type: S.BOSS_SPEECH_DONE });
    },
  },
});
```

## 4) client — WebSocket message handling (React; display + playback)

```js
case S.BOSS_AUDIO_DELTA:
  // Boss voice (PCM16@24k) over the WS -> play it. (Barge-in flush arrives via BOSS_INTERRUPTED.)
  setError(e => (e === 'realtime_error' ? null : e));
  if (!geminiModeRef.current || !geminiPlayerRef.current) break;
  if (!bossHasSpokenRef.current) beacon('boss_spoke');
  bossHasSpokenRef.current = true;
  geminiPlayerRef.current.enqueue(msg.data);           // <- plays IMMEDIATELY, no transcript involved
  // Voice-first ordering: the transcript held back for this turn is released only now, when
  // her voice is actually audible — the text follows the speech, never announces it.
  if (!geminiVoiceOnRef.current) {
    geminiVoiceOnRef.current = true;
    if (geminiThinkTimerRef.current) { clearTimeout(geminiThinkTimerRef.current); geminiThinkTimerRef.current = null; }
    if (geminiPendingTextRef.current) {
      geminiBossLineRef.current += geminiPendingTextRef.current;
      geminiPendingTextRef.current = '';
      setBossText(geminiBossLineRef.current);
    }
    setBossSpeak(true); setBossThinking(false); setShowBriefing(false);
  }
  break;

case S.LIVE_BOSS_TRANSCRIPT: {
  // Boss's words, streamed chunk-by-chunk. Gemini streams the transcript ~0.5s AHEAD of the
  // audio; showing it immediately made the reply feel gated on text. Hold chunks back until
  // the voice starts (BOSS_AUDIO_DELTA releases them), then append live as she speaks.
  if (!geminiModeRef.current) break;
  if (!geminiVoiceOnRef.current) { geminiPendingTextRef.current += (msg.text || ''); break; }
  geminiBossLineRef.current += (msg.text || '');
  setBossText(geminiBossLineRef.current);
  break;
}

case S.LIVE_USER_TRANSCRIPT_PARTIAL:
  // Your words, as Gemini transcribes them -> live subtitle (display only).
  if (geminiModeRef.current) {
    setLiveTranscript((prev) => (prev || '') + (msg.text || ''));
    // DEAD-AIR FIX: transcript chunks going QUIET = Gemini heard the whole turn and is composing.
    // 600ms after the last chunk — and only while this turn's voice hasn't started — light the
    // "CHEF DENKT NACH…" state. First audio byte clears it. Display-only; the mic ignores it.
    setBossThinking(false);
    if (geminiThinkTimerRef.current) clearTimeout(geminiThinkTimerRef.current);
    geminiThinkTimerRef.current = setTimeout(() => {
      geminiThinkTimerRef.current = null;
      if (geminiModeRef.current && !geminiVoiceOnRef.current) setBossThinking(true);
    }, 600);
  }
  break;
```

## 5) client — the audio player (gapless scheduling + jitter heal)

```js
export class GeminiVoicePlayer {
  constructor({ onSpeakStart } = {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this._ctx = new AC({ sampleRate: 24000 });
    this._playHead = 0;
    this._sources = [];
    this._onSpeakStart = onSpeakStart || null;
    this._announcedThisRun = false;
    // Jitter healing: after the FIRST mid-speech tear this session, schedule refills with a small
    // lead so a buffer builds instead of tearing again. A turn START always begins at `now`
    // (zero added onset latency, armed or not).
    this._jitterLead = 0;
    this._lastEnqueueMs = 0;
  }

  resume() { if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {}); }

  enqueue(base64Pcm24) {
    if (!base64Pcm24) return;
    this.resume();
    const bytes = _b64ToBytes(base64Pcm24);
    if (bytes.byteLength < 2) return;
    const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;

    const buf = this._ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._ctx.destination);

    const now = this._ctx.currentTime;
    if (this._playHead < now) {
      const wasFlowing = this._lastEnqueueMs > 0 && (performance.now() - this._lastEnqueueMs) < 1500;
      if (wasFlowing && !this._jitterLead) this._jitterLead = 0.18;
      this._playHead = now + (wasFlowing ? this._jitterLead : 0);
    }
    this._lastEnqueueMs = performance.now();
    const startAt = this._playHead;
    if (!this._announcedThisRun) { this._announcedThisRun = true; try { this._onSpeakStart?.(); } catch {} }
    src.start(startAt);
    this._playHead = startAt + buf.duration;
    this._sources.push(src);
    src.onended = () => { this._sources = this._sources.filter((s) => s !== src); };
  }

  flush() {
    for (const s of this._sources) { try { s.stop(); } catch {} }
    this._sources = [];
    this._playHead = this._ctx ? this._ctx.currentTime : 0;
    this._announcedThisRun = false;
    this._lastEnqueueMs = 0;
  }

  markTurnEnd() { this._announcedThisRun = false; }

  close() {
    this.flush();
    try { this._ctx.close(); } catch {}
    this._ctx = null;
  }
}
```

## What has already been tried / shipped

- `thinkingBudget: 0` (halved latency, measured).
- VAD tuned to `silenceDurationMs: 400` + `END_SENSITIVITY_HIGH`.
- "CHEF DENKT NACH…" presence indicator 600 ms after transcript quiet (mask, not a fix).
- Boss transcript held until boss AUDIO starts (so the boss's own text never precedes her voice).
- Jitter-heal in the player (fixes crackle, adds zero onset latency by construction).
- Latency instrumentation per turn: `GET /api/diag/latency` (provider `gemini-live`).

## Constraints for your recommendation

- Budget: $0 — no new paid services, no provider switch that costs money.
- The alternative $0 pipeline (Deepgram STT -> Groq LLM -> TTS) is SLOWER end-to-end and robotic.
- Any change must not increase response-onset latency ("never slower" is a standing law).

Please answer the 4 review questions with file/line-level reasoning, then list concrete,
$0-compatible changes (if any) that would reduce the felt wait below the measured 1.34–1.57 s,
or state plainly that the remaining wait is Gemini generation time that no client/server code
can remove.
