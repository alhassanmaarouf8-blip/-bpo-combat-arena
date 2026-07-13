/**
 * geminiVoice.js — plays the Gemini Live interviewer's voice in the browser.
 *
 * On the native-audio path the boss's voice arrives over the WebSocket as base64 PCM16 mono @24 kHz
 * chunks (BOSS_AUDIO_DELTA), NOT as an MP3 over HTTP like the $0 Deepgram path. This player schedules
 * each chunk back-to-back on a 24 kHz AudioContext for gapless speech, and exposes flush() so a
 * barge-in (the user interrupting) can instantly drop everything still queued.
 *
 * Kept deliberately tiny and framework-free (a plain class) — App.jsx owns one instance while the
 * Gemini interview runs and calls close() when it ends.
 */

// Live boss-voice LEVEL (0..1) sampled from the REAL PCM envelope (below). Drives the interviewer
// avatar's reactive presence ring — a truthful "he's speaking" glow, NOT a fake mouth. Mirrors the
// Salma level bus (salmaVoice.js). Only the Gemini (premium PCM) path emits: we own the raw buffers,
// so there's no cross-origin/CORS risk here — unlike the $0 MP3 boss path (see plan's loss-flag).
const bossLevelSubs = new Set();
export function emitBossLevel(v) { bossLevelSubs.forEach((fn) => { try { fn(v); } catch { /* ignore */ } }); }
export function subscribeBossLevel(fn) { bossLevelSubs.add(fn); return () => bossLevelSubs.delete(fn); }

export class GeminiVoicePlayer {
  constructor({ onSpeakStart, onLevel } = {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this._ctx = new AC({ sampleRate: 24000 });
    this._playHead = 0;          // absolute AudioContext time the next chunk should start at
    this._sources = [];          // live BufferSources (so flush() can stop them)
    this._onSpeakStart = onSpeakStart || null;
    this._announcedThisRun = false;
    // Reactive-presence tap: a transparent AnalyserNode between every buffer source and the speakers.
    // An AnalyserNode does NOT alter the audio (pure passthrough) — it only lets an rAF loop read the
    // real loudness envelope and broadcast it (onLevel) so the avatar ring tracks his actual voice.
    this._onLevel = onLevel || null;
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 256;
    this._analyser.smoothingTimeConstant = 0.6;
    this._analyser.connect(this._ctx.destination);   // MUST reach destination or the voice is muted
    this._levelAlive = false;
    this._levelRaf = 0;
    if (this._onLevel) this._startLevelLoop();
    // Jitter healing (the خرفشة fix). On a slow network the 40ms chunks arrive slower than they
    // play; the queue runs dry MID-SPEECH and every dry-out used to hard-resync to `now` — an
    // audible tear. ~100 tears per 10s = continuous crackle, zero intelligible words (measured on
    // prod 2026-07-09: run A 100 tears, run B same code 0 — purely network-dependent).
    // The heal: after the FIRST mid-speech tear this session, schedule refills with a small lead
    // so a buffer builds instead of tearing again. STANDING OWNER LAW: never slower than today —
    // enforced structurally: a turn START always begins at `now` (zero added onset latency, armed
    // or not), and a clean session never arms the lead at all. Only already-torn audio pays.
    this._jitterLead = 0;        // 0 until a mid-speech tear proves this network needs healing
    this._lastEnqueueMs = 0;     // wall-clock of the previous enqueue (tear vs turn-start telling)
  }

  // Autoplay policy: the context may start suspended until a user gesture. Called on each enqueue.
  resume() { if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {}); }

  // Read the analyser's real loudness envelope each frame and broadcast it (0..1). Same RMS math as
  // nativeVoice.wireLevelAnalyser. Emits ~0 while the boss is silent; the avatar gates on `speaking`.
  _startLevelLoop() {
    if (this._levelAlive || !this._onLevel || !this._analyser) return;
    this._levelAlive = true;
    const buf = new Uint8Array(this._analyser.fftSize);
    const tick = () => {
      if (!this._levelAlive) return;
      this._analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);              // ~0 silence … ~0.3+ loud speech
      try { this._onLevel(Math.min(1, rms * 3.2)); } catch { /* ignore */ }
      this._levelRaf = requestAnimationFrame(tick);
    };
    this._levelRaf = requestAnimationFrame(tick);
  }

  // Queue one base64 PCM16@24k chunk for gapless playback.
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
    src.connect(this._analyser);      // → analyser → destination (transparent tap for the avatar ring)

    const now = this._ctx.currentTime;
    if (this._playHead < now) {
      // We ran dry. If audio was flowing moments ago this is a mid-speech TEAR (network jitter),
      // not a turn boundary — arm the lead once, and refill behind it so the buffer absorbs the
      // jitter from here on. A turn start (no recent flow) always resyncs to `now` with NO lead:
      // response-onset latency is identical to before this fix, always.
      const wasFlowing = this._lastEnqueueMs > 0 && (performance.now() - this._lastEnqueueMs) < 1500;
      if (wasFlowing && !this._jitterLead) this._jitterLead = 0.18;
      this._playHead = now + (wasFlowing ? this._jitterLead : 0);
    }
    this._lastEnqueueMs = performance.now();
    const startAt = this._playHead;
    if (!this._announcedThisRun) { this._announcedThisRun = true; try { this._onSpeakStart?.(); } catch { /* UI only */ } }
    src.start(startAt);
    this._playHead = startAt + buf.duration;
    this._sources.push(src);
    src.onended = () => { this._sources = this._sources.filter((s) => s !== src); };
  }

  // Barge-in / turn cut: stop and drop everything currently scheduled.
  flush() {
    for (const s of this._sources) { try { s.stop(); } catch { /* already stopped */ } }
    this._sources = [];
    this._playHead = this._ctx ? this._ctx.currentTime : 0;
    this._announcedThisRun = false;
    this._lastEnqueueMs = 0;   // a flush IS a turn boundary — the next enqueue must start at `now`, never with the jitter lead
  }

  // Call at the end of a boss turn so the next turn re-announces "speaking" (drives the avatar).
  markTurnEnd() { this._announcedThisRun = false; }

  close() {
    this.flush();
    this._levelAlive = false;
    if (this._levelRaf) { try { cancelAnimationFrame(this._levelRaf); } catch { /* ignore */ } this._levelRaf = 0; }
    try { this._onLevel?.(0); } catch { /* ignore */ }   // drop the ring so no stale glow lingers
    try { this._ctx.close(); } catch { /* already closed */ }
    this._ctx = null;
  }
}

function _b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default { GeminiVoicePlayer };
