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
export class GeminiVoicePlayer {
  constructor({ onSpeakStart } = {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this._ctx = new AC({ sampleRate: 24000 });
    this._playHead = 0;          // absolute AudioContext time the next chunk should start at
    this._sources = [];          // live BufferSources (so flush() can stop them)
    this._onSpeakStart = onSpeakStart || null;
    this._announcedThisRun = false;
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
    src.connect(this._ctx.destination);

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
