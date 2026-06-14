/**
 * audioPlayer.js
 * Gapless playback of PCM16 audio chunks from OpenAI Realtime API.
 *
 * OAI sends raw PCM16 (Little Endian, 24 kHz, mono) as base64 strings.
 * We decode each chunk to Float32 and schedule it on the Web Audio timeline
 * so chunks play seamlessly end-to-end with zero gaps or clicks.
 *
 * Key facts:
 *  - We DO NOT use decodeAudioData() — that requires a container (WAV/MP3).
 *  - We manually convert Int16 → Float32 (range -1 to 1).
 *  - Each chunk is scheduled at _nextStartTime (cumulative end of prior chunk).
 *  - flush() immediately stops all scheduled audio (for interruptions).
 */

const SAMPLE_RATE     = 24_000; // Hz
const SCHEDULE_AHEAD  = 0.05;   // seconds — schedule 50ms ahead of now
const MIN_CHUNK_DUR   = 0.02;   // skip chunks shorter than 20ms

export class AudioPlayer {
  /**
   * @param {{
   *   onPlaybackStart?: () => void,
   *   onPlaybackEnd?:   () => void,
   *   onError?:         (err: Error) => void,
   *   volume?:          number,
   * }} opts
   */
  constructor({ onPlaybackStart, onPlaybackEnd, onError, volume = 1.0, realism = null } = {}) {
    this._onStart  = onPlaybackStart ?? (() => {});
    this._onEnd    = onPlaybackEnd   ?? (() => {});
    this._onError  = onError         ?? console.error;
    this._volume   = Math.max(0, Math.min(1, volume));
    // OUTPUT-ONLY realism processor (telephone/ambience). Optional + fail-safe: if it errors,
    // the boss voice routes straight to the speakers (clean) so playback can never break.
    this._realism  = realism;

    this._ctx          = null;
    this._gain         = null;
    this._nextStart    = 0;        // AudioContext time for next chunk
    this._nodes        = [];       // active AudioBufferSourceNodes
    this._isPlaying    = false;
    this._isFlushing   = false;
  }

  get isPlaying() { return this._isPlaying; }

  // ── Enqueue a base64 PCM16 chunk for playback ─────────────────────────────

  async enqueue(base64Chunk) {
    if (this._isFlushing || !base64Chunk) return;
    try {
      await this._ensureCtx();
      const buf = _decodeChunk(base64Chunk, this._ctx);
      if (buf.duration < MIN_CHUNK_DUR) return;
      this._schedule(buf);
    } catch (err) {
      this._onError(err);
    }
  }

  // ── Schedule one AudioBuffer on the timeline ──────────────────────────────

  _schedule(buf) {
    const ctx  = this._ctx;
    const now  = ctx.currentTime;

    // Catch up if we've fallen behind (e.g. after a gap)
    if (this._nextStart < now + SCHEDULE_AHEAD) {
      this._nextStart = now + SCHEDULE_AHEAD;
    }

    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this._gain);
    node.start(this._nextStart);

    const endTime     = this._nextStart + buf.duration;
    this._nextStart   = endTime;

    this._nodes.push({ node, endTime });

    node.onended = () => {
      this._nodes = this._nodes.filter(n => n.node !== node);
      if (this._nodes.length === 0 && this._isPlaying) {
        this._isPlaying = false;
        this._nextStart = 0;
        this._onEnd();
      }
    };

    if (!this._isPlaying) {
      this._isPlaying = true;
      this._onStart();
    }
  }

  // ── Immediately stop all playback (interruption) ──────────────────────────

  flush() {
    this._isFlushing = true;
    const now = this._ctx?.currentTime ?? 0;

    for (const { node } of this._nodes) {
      try { node.stop(now); node.disconnect(); } catch {}
    }

    this._nodes     = [];
    this._nextStart = 0;

    if (this._isPlaying) {
      this._isPlaying = false;
      this._onEnd();
    }

    this._isFlushing = false;
  }

  // ── Volume control (smooth ramp to avoid clicks) ──────────────────────────

  setVolume(level) {
    this._volume = Math.max(0, Math.min(1, level));
    if (this._gain && this._ctx) {
      this._gain.gain.linearRampToValueAtTime(this._volume, this._ctx.currentTime + 0.05);
    }
  }

  // ── Attach/replace the OUTPUT-ONLY realism processor (safe before OR during a session) ──
  setRealism(realism) {
    try { this._realism?.detach?.(); } catch {}
    this._realism = realism;
    // If the context already exists (e.g. a second fight without a dispose), wire it live and
    // reroute the voice bus. Any failure falls back to the clean direct path.
    if (this._ctx && this._gain && realism) {
      try {
        const input = realism.attach(this._ctx);
        try { this._gain.disconnect(); } catch {}
        this._gain.connect(input || this._ctx.destination);
        if (input) realism.onReconnect?.((ni) => { try { this._gain.disconnect(); } catch {} this._gain.connect(ni || this._ctx.destination); });
      } catch (err) { try { this._gain.connect(this._ctx.destination); } catch {} this._onError(err); }
    }
  }

  // ── Release AudioContext ──────────────────────────────────────────────────

  async dispose() {
    this.flush();
    try { this._realism?.detach(); } catch {}   // stop hiss/ambience timers cleanly (no leaks)
    if (this._ctx && this._ctx.state !== 'closed') {
      await this._ctx.close().catch(() => {});
    }
    this._ctx = this._gain = null;
  }

  // ── Lazy AudioContext creation (must happen after user gesture) ───────────

  async _ensureCtx() {
    if (!this._ctx) {
      this._ctx  = new AudioContext({ sampleRate: SAMPLE_RATE });
      this._gain = this._ctx.createGain();
      this._gain.gain.setValueAtTime(this._volume, this._ctx.currentTime);

      // Route the voice through the realism processor if present; otherwise straight to output.
      // Any failure falls back to the clean direct path (intelligibility/playback never breaks).
      let routed = false;
      if (this._realism) {
        try {
          const input = this._realism.attach(this._ctx);
          if (input) {
            this._gain.connect(input);
            routed = true;
            this._realism.onReconnect?.((newInput) => {
              try { this._gain.disconnect(); } catch {}
              this._gain.connect(newInput || this._ctx.destination);
            });
          }
        } catch (err) { this._onError(err); }
      }
      if (!routed) this._gain.connect(this._ctx.destination);
    }
    if (this._ctx.state === 'suspended') await this._ctx.resume();
  }
}

// ── Decode base64 PCM16 → AudioBuffer (manual, no decodeAudioData) ───────────

function _decodeChunk(base64, ctx) {
  // base64 → binary string → Uint8Array
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // Uint8Array → Int16Array (Little Endian PCM16)
  const int16 = new Int16Array(bytes.buffer);

  // Int16 → Float32 (Web Audio API internal format)
  const buf = ctx.createBuffer(1, int16.length, SAMPLE_RATE);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < int16.length; i++) {
    ch[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }

  return buf;
}
