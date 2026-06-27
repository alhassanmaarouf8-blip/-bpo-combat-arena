// bargeInMonitor.js — detect the user speaking OVER the boss, so the interview is interruptible
// (a real human stops when you cut in). The hands-free ClipRecorder is NOT running during boss speech,
// so this owns its OWN lightweight mic stream + AnalyserNode and only watches the volume.
//
// FAIL-SAFE: it never throws into the app. Any failure (mic denied, analyser error) just means
// onBargeIn never fires → the boss finishes its line normally (today's behavior). It can ONLY add the
// ability to interrupt; it can never break normal playback.
//
// FALSE-TRIGGER DEFENCE (so the boss's OWN voice doesn't cut itself off):
//  - echoCancellation + noiseSuppression ON (attenuate the boss bleed at the source);
//  - autoGainControl OFF (stable noise floor for the whole line);
//  - re-measure the residual echo floor in the first 400ms of EVERY boss line (also a hard grace
//    period — no trigger possible then);
//  - require RMS above max(0.12, echoFloor*2.2) for 350ms CONTINUOUS (any dip resets) → only real,
//    sustained user speech fires; transients (cough, click) and bleed cannot.
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class BargeInMonitor {
  constructor({ onBargeIn } = {}) {
    this._onBargeIn = onBargeIn || (() => {});
    this._ctx = this._stream = this._source = this._analyser = this._buf = null;
    this._poll = null;
    this._armed = false; this._fired = false;
    this._calibUntil = 0; this._echoFloor = 0; this._aboveMs = 0;
    this._tick = this._tick.bind(this);
  }

  async start() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false,
      });
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this._ctx.state === 'suspended') await this._ctx.resume();
      this._source   = this._ctx.createMediaStreamSource(this._stream);
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = 0.7;
      this._buf = new Uint8Array(this._analyser.frequencyBinCount);
      this._source.connect(this._analyser);          // no output node → silent tap
      this._poll = setInterval(this._tick, 50);
      return true;
    } catch { this.stop(); return false; }            // FAIL-SAFE: barge-in just won't fire
  }

  // Call on the bossSpeak rising edge — watch THIS line.
  arm()    { this._armed = true; this._fired = false; this._aboveMs = 0; this._echoFloor = 0; this._calibUntil = now() + 400; }
  disarm() { this._armed = false; this._aboveMs = 0; }

  _tick() {
    if (!this._analyser || !this._armed || this._fired) return;
    this._analyser.getByteFrequencyData(this._buf);
    let sum = 0; for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
    const rms = Math.sqrt(sum / this._buf.length) / 255;
    if (now() < this._calibUntil) { this._echoFloor = Math.max(this._echoFloor, rms); return; }  // calibrate + grace
    const thresh = Math.max(0.12, this._echoFloor * 2.2);
    if (rms > thresh) {
      this._aboveMs += 50;
      if (this._aboveMs >= 350) { this._fired = true; this._armed = false; try { this._onBargeIn(); } catch {} }
    } else { this._aboveMs = 0; }
  }

  stop() {
    if (this._poll) { clearInterval(this._poll); this._poll = null; }
    try { this._source?.disconnect(); } catch {}
    try { if (this._ctx && this._ctx.state !== 'closed') this._ctx.close(); } catch {}
    this._stream?.getTracks().forEach((t) => t.stop());
    this._ctx = this._stream = this._source = this._analyser = this._buf = null;
    this._armed = false;
  }
}
