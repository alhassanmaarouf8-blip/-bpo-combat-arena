/**
 * audioRecorder.js
 * Continuous microphone streaming — no push-to-talk.
 * Captures audio at 24 kHz mono, encodes as PCM16, emits base64 chunks ~100ms.
 * Uses an AudioWorklet (off main thread) so UI never blocks the audio pipeline.
 */

const SAMPLE_RATE  = 24_000;  // Hz — must match OAI Realtime API input
const CHUNK_FRAMES = 2_400;   // samples per emit = 100ms at 24 kHz

// AudioWorklet processor — serialised to a Blob URL at runtime.
// Runs in the dedicated audio rendering thread; has no DOM/window access.
const WORKLET_SRC = `
class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf    = new Int16Array(${CHUNK_FRAMES});
    this._offset = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this._buf[this._offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._offset >= ${CHUNK_FRAMES}) {
        this.port.postMessage({ pcm16: this._buf.slice() }, [this._buf.buffer]);
        this._buf    = new Int16Array(${CHUNK_FRAMES});
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm16-processor', PCM16Processor);
`;

export class AudioRecorder {
  /**
   * @param {{
   *   onChunk:  (base64: string) => void,
   *   onVolume: (level: number) => void,
   *   onError:  (err: Error)    => void,
   * }} callbacks
   */
  constructor({ onChunk, onVolume, onError, sharedContext = null }) {
    this._onChunk  = onChunk;
    this._onVolume = onVolume;
    this._onError  = onError;
    this._sharedCtx = sharedContext;   // reuse a gesture-unlocked context across turns (mobile auto-listen)
    this._ownsCtx   = false;

    this._ctx          = null;
    this._stream       = null;
    this._source       = null;
    this._worklet      = null;
    this._analyser     = null;
    this._analyserBuf  = null;
    this._blobUrl      = null;
    this._rafId        = null;
    this._state        = 'idle'; // idle | recording | stopped
  }

  get isRecording() { return this._state === 'recording'; }

  // ── Start continuous streaming ─────────────────────────────────────────────

  async start() {
    if (this._state === 'recording') return;

    try {
      // 1. Mic access — echoCancellation prevents boss audio looping back.
      //    Constraints are IDEAL, never `exact`: some mobile / Bluetooth mics reject a hard
      //    mono constraint with OverconstrainedError, which used to hang the session on
      //    "reaching for the mic" with no audio. The worklet reads only channel 0 and the
      //    24 kHz AudioContext resamples any mic rate, so relaxing these is loss-free. If a
      //    device still refuses the constraints, fall back to a bare mic so it works on ANY phone.
      const micConstraints = {
        sampleRate:       { ideal: SAMPLE_RATE },
        channelCount:     { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      };
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints, video: false });
      } catch (constraintErr) {
        if (constraintErr && constraintErr.name === 'OverconstrainedError') {
          console.warn('[audioRecorder] mic rejected constraints → retrying with bare audio');
          this._stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw constraintErr;
        }
      }

      // Detect the mic being revoked / unplugged MID-session: the track fires 'ended'.
      // Surface it as a coded error so the app can end the fight and stop billing.
      for (const track of this._stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (this._state !== 'recording') return;
          this._onError(Object.assign(new Error('Microphone disconnected'), { code: 'MIC_ENDED' }));
        });
      }

      // 2. AudioContext locked to 24 kHz. PREFER a context already unlocked inside the start tap
      //    (sharedContext) and REUSE it every turn. On mobile a per-turn context created outside a
      //    user gesture stays SUSPENDED → no audio is captured until the user taps the screen (the
      //    "it doesn't hear me until I click" bug). One context, unlocked once and kept running,
      //    captures automatically turn after turn. (webkit-prefixed fallback for older iOS Safari.)
      if (this._sharedCtx) {
        this._ctx = this._sharedCtx;
        this._ownsCtx = false;
      } else {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this._ctx = new AudioCtx({ sampleRate: SAMPLE_RATE });
        this._ownsCtx = true;
      }
      if (this._ctx.state === 'suspended') { try { await this._ctx.resume(); } catch {} }

      // Resume if tab goes background then foreground (only for a context we own; the shared one
      // is kept alive across turns by App and resumed in the start gesture).
      if (this._ownsCtx) {
        this._ctx.addEventListener('statechange', () => {
          if (this._ctx?.state === 'suspended') this._ctx.resume().catch(() => {});
        });
      }

      // 3. Register the AudioWorklet ONCE per context (a reused shared context keeps it registered;
      //    calling addModule again would throw "pcm16-processor already registered").
      if (!this._ctx.__pcm16Registered) {
        this._blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
        await this._ctx.audioWorklet.addModule(this._blobUrl);
        this._ctx.__pcm16Registered = true;
      }

      // 4. Build audio graph
      //    MediaStreamSource ──┬── AnalyserNode  (volume tap, no output)
      //                        └── AudioWorkletNode (PCM16 encoder, no output)
      this._source   = this._ctx.createMediaStreamSource(this._stream);
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = 0.8;
      this._analyserBuf = new Uint8Array(this._analyser.frequencyBinCount);

      this._worklet = new AudioWorkletNode(this._ctx, 'pcm16-processor', {
        numberOfInputs:        1,
        numberOfOutputs:       0,
        channelCount:          1,
        channelCountMode:      'explicit',
        channelInterpretation: 'discrete',
      });

      this._worklet.port.onmessage = ({ data }) => {
        if (this._state !== 'recording') return;
        this._onChunk(_int16ToBase64(data.pcm16));
      };

      this._worklet.port.onmessageerror = () =>
        this._onError(new Error('AudioWorklet message error'));

      this._source.connect(this._analyser);
      this._source.connect(this._worklet);

      // 5. Volume animation loop (60 fps)
      this._startVolumePoll();

      this._state = 'recording';
      console.log('[DIAG-MIC] recorder STARTED  sampleRate=', this._ctx.sampleRate, ' ctxState=', this._ctx.state, ' shared=', !this._ownsCtx);

    } catch (err) {
      this._cleanup();
      this._state = 'stopped';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        const e = Object.assign(new Error('Microphone permission denied'), { code: 'MIC_DENIED' });
        this._onError(e);
        throw e;
      }
      if (err.name === 'NotFoundError') {
        const e = Object.assign(new Error('No microphone found'), { code: 'MIC_NOT_FOUND' });
        this._onError(e);
        throw e;
      }
      this._onError(err);
      throw err;
    }
  }

  // ── Stop and release all resources ────────────────────────────────────────

  async stop() {
    if (this._state === 'stopped' || this._state === 'idle') return;
    this._state = 'stopped';

    this._stopVolumePoll();

    try { this._source?.disconnect();  } catch {}
    try { this._worklet?.disconnect(); } catch {}
    try { this._analyser?.disconnect(); } catch {}

    // Close ONLY a context we created. A shared (gesture-unlocked) context must stay alive &
    // running so the NEXT turn can capture without another tap — closing it re-introduces the bug.
    if (this._ctx && this._ownsCtx && this._ctx.state !== 'closed') {
      await this._ctx.close().catch(() => {});
    }

    this._cleanup();
    console.log('[audioRecorder] Stopped');
  }

  // ── Volume polling ────────────────────────────────────────────────────────

  _startVolumePoll() {
    const poll = () => {
      if (this._state !== 'recording') return;
      if (this._analyser && this._analyserBuf) {
        this._analyser.getByteFrequencyData(this._analyserBuf);
        let sum = 0;
        for (let i = 0; i < this._analyserBuf.length; i++) sum += this._analyserBuf[i] ** 2;
        this._onVolume(Math.sqrt(sum / this._analyserBuf.length) / 255);
      }
      this._rafId = requestAnimationFrame(poll);
    };
    this._rafId = requestAnimationFrame(poll);
  }

  _stopVolumePoll() {
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this._onVolume(0);
  }

  // ── Internal cleanup ──────────────────────────────────────────────────────

  _cleanup() {
    this._stream?.getTracks().forEach(t => t.stop());
    if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
    this._ctx = this._stream = this._source = this._worklet = this._analyser = this._analyserBuf = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _int16ToBase64(int16) {
  const bytes  = new Uint8Array(int16.buffer);
  const CHUNK  = 0x8000;
  let   binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function checkAudioSupport() {
  const missing = [];
  if (!navigator.mediaDevices?.getUserMedia) missing.push('getUserMedia');
  if (!window.AudioContext && !window.webkitAudioContext) missing.push('AudioContext');
  if (!window.AudioWorkletNode) missing.push('AudioWorklet');
  return { supported: missing.length === 0, missing };
}
