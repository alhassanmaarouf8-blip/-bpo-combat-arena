/**
 * realismAudio.js — OUTPUT-ONLY interview realism (Phases 2,3,4) for the interviewer's voice.
 *
 * It is handed the SAME AudioContext the boss-voice player uses (see audioPlayer.js). It returns
 * an `input` GainNode the boss voice connects INTO; from there the signal flows through the
 * telephone band-pass + compression + a line-hiss floor (Phase 4), and a faint, slowly-evolving
 * office ambience bed (Phase 2) + occasional diegetic typing/paper (Phase 3) are mixed in. The
 * final bus connects to ctx.destination. ALL sounds are procedurally generated (no assets).
 *
 * HARD RULES:
 *  - OUTPUT ONLY: nothing here reads or touches the microphone, recording, or transcription.
 *  - INTELLIGIBILITY FLOOR: the voice path keeps a make-up gain so band-limiting never makes the
 *    German quieter; ambience/hiss are very low and never routed onto the voice's clarity.
 *  - SEEDED: every random choice uses the per-session rng so a session is consistent/repeatable.
 *  - FAIL-SAFE: any error during attach() returns null so the player falls back to clean voice.
 *  - NOISE BUG AVOIDED: line-hiss amplitude is baked into the buffer ONCE; its GainNode stays at 1.
 */
import { makeRng } from './realismConfig.js';

export class RealismAudio {
  constructor(config) {
    this.cfg   = config || {};
    this._ctx  = null;
    this._input = null;     // boss voice connects here
    this._out   = null;     // final bus → destination
    this._nodes = [];       // everything to disconnect on detach
    this._noise = null;     // line-hiss source
    this._ambGain = null;
    this._ambTimer = null;
    this._rng   = makeRng((config?.seed || 'default') + ':audio');
    this._attached = false;
  }

  // Called by AudioPlayer once its AudioContext exists. Returns the node the boss voice should
  // connect into, or null on failure (player then routes voice straight to destination).
  attach(ctx) {
    try {
      this._ctx = ctx;
      const master = clamp(this.cfg.masterIntensity ?? 1, 0, 1);
      const tele   = this.cfg.telephone || {};

      this._out = ctx.createGain();
      this._out.gain.value = 1;
      this._out.connect(ctx.destination);
      this._nodes.push(this._out);

      this._input = ctx.createGain();
      this._input.gain.value = 1;
      this._nodes.push(this._input);

      if (tele.enabled && master > 0) {
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = tele.lowCut ?? 300;  hp.Q.value = tele.q ?? 0.7;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = tele.highCut ?? 3400; lp.Q.value = tele.q ?? 0.7;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24; comp.knee.value = 12;
        comp.ratio.value = 1 + (tele.compression ?? 8) / 4;   // ~3:1 at compression 8
        comp.attack.value = 0.003; comp.release.value = 0.18;
        // Make-up gain: band-limiting + compression must NOT make the voice quieter (floor).
        const makeup = ctx.createGain(); makeup.gain.value = 1.3;
        this._input.connect(hp); hp.connect(lp); lp.connect(comp); comp.connect(makeup); makeup.connect(this._out);
        this._nodes.push(hp, lp, comp, makeup);

        // Line hiss: amplitude baked into the buffer ONCE; gain node left at 1 (no double-scale).
        const amp = clamp((tele.noiseFloor ?? 0.008) * master, 0, 0.05);
        if (amp > 0) {
          this._noise = makeNoiseSource(ctx, amp);
          const ng = ctx.createGain(); ng.gain.value = 1;
          this._noise.connect(ng); ng.connect(this._out);
          this._nodes.push(ng);
          try { this._noise.start(); } catch {}
        }
      } else {
        // Telephone off → clean, full-band voice straight through.
        this._input.connect(this._out);
      }

      if ((this.cfg.ambient?.enabled) && master > 0) this._startAmbience(ctx, master);

      this._attached = true;
      return this._input;
    } catch (e) {
      console.error('[realism] attach failed → clean voice fallback:', e?.message || e);
      this.detach();
      return null;
    }
  }

  // ── Phase 2: faint, slowly-evolving office ambience bed (procedural, seeded) ──────────
  _startAmbience(ctx, master) {
    const amb = this.cfg.ambient || {};
    const vol = clamp((amb.volume ?? 0.06) * master, 0, 0.25);   // very low; never masks the voice
    this._ambGain = ctx.createGain(); this._ambGain.gain.value = 0.0001;
    this._ambGain.connect(this._out); this._nodes.push(this._ambGain);

    // Steady AC/room hum = low-passed brown-ish noise, just barely present.
    const hum = makeNoiseSource(ctx, 0.5);              // amplitude trimmed again by _ambGain only
    const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 320; humLp.Q.value = 0.4;
    hum.connect(humLp); humLp.connect(this._ambGain);
    try { hum.start(); } catch {}
    this._nodes.push(humLp);
    this._ambNoise = hum;
    // fade the bed in slowly so it never "pops"
    this._ambGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this._ambGain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 4);

    // Scene timeline: rarer events appear over the session (distant colleague, far printer),
    // their frequency driven by activityLevel. Seeded delays → repeatable.
    const activity = clamp(amb.activityLevel ?? 0.3, 0, 1);
    const scheduleNext = () => {
      // 25–75s between events, less often at low activity.
      const base = 75000 - activity * 45000;
      const delay = base + this._rng() * 30000;
      this._ambTimer = setTimeout(() => {
        if (!this._attached) return;
        this._playAmbientEvent(ctx, vol);
        scheduleNext();
      }, delay);
      this._ambTimer.unref?.();
    };
    scheduleNext();
  }

  // One short, faint ambient event — a distant murmur or a far printer — well under the voice.
  _playAmbientEvent(ctx, bedVol) {
    try {
      const kind = this._rng() < 0.5 ? 'murmur' : 'printer';
      const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(this._out);
      const peak = clamp(bedVol * 0.8, 0, 0.12);
      const t = ctx.currentTime;
      if (kind === 'murmur') {
        const n = makeNoiseSource(ctx, 0.5);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.8;
        n.connect(bp); bp.connect(g);
        g.gain.linearRampToValueAtTime(peak, t + 0.8);
        g.gain.linearRampToValueAtTime(0.0001, t + 3.0);
        try { n.start(t); n.stop(t + 3.2); } catch {}
      } else {
        // far printer: a few rhythmic ticks
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2;
        bp.connect(g); g.gain.value = peak;
        for (let i = 0; i < 6; i++) {
          const tickT = t + i * 0.14;
          const n = makeNoiseSource(ctx, 0.6); const tg = ctx.createGain(); tg.gain.value = 0.0001;
          n.connect(tg); tg.connect(bp);
          tg.gain.setValueAtTime(0.0001, tickT); tg.gain.linearRampToValueAtTime(1, tickT + 0.01); tg.gain.linearRampToValueAtTime(0.0001, tickT + 0.05);
          try { n.start(tickT); n.stop(tickT + 0.07); } catch {}
        }
        g.gain.setValueAtTime(peak, t); g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
      }
      setTimeout(() => { try { g.disconnect(); } catch {} }, 4000);
    } catch { /* ambient is decorative; never throw */ }
  }

  // ── Phase 3: diegetic action sound (typing / paper) when the interviewer "checks notes" ──
  triggerDiegetic(kind = 'typing') {
    const d = this.cfg.diegetic || {};
    if (!this._attached || !d.enabled || !this._ctx || !this._out) return;
    // seeded gate by rate so it stays occasional + repeatable
    if (this._rng() > clamp(d.rate ?? 0.3, 0, 1)) return;
    try {
      const ctx = this._ctx, t = ctx.currentTime;
      const g = ctx.createGain(); g.gain.value = 1; g.connect(this._out);
      const peak = clamp(0.05 * (this.cfg.masterIntensity ?? 1), 0, 0.08);  // faint, under the voice
      if (kind === 'paper') {
        const n = makeNoiseSource(ctx, 0.5);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.7;
        const eg = ctx.createGain(); eg.gain.setValueAtTime(0.0001, t);
        n.connect(bp); bp.connect(eg); eg.connect(g);
        eg.gain.linearRampToValueAtTime(peak, t + 0.08); eg.gain.linearRampToValueAtTime(0.0001, t + 0.5);
        try { n.start(t); n.stop(t + 0.55); } catch {}
      } else {
        // typing: ~8–14 quick key clicks over ~1.4s
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 3; bp.connect(g);
        const keys = 8 + Math.floor(this._rng() * 7);
        for (let i = 0; i < keys; i++) {
          const kt = t + i * (0.07 + this._rng() * 0.06);
          const n = makeNoiseSource(ctx, 0.7); const eg = ctx.createGain(); eg.gain.setValueAtTime(0.0001, kt);
          n.connect(eg); eg.connect(bp);
          eg.gain.linearRampToValueAtTime(peak, kt + 0.005); eg.gain.linearRampToValueAtTime(0.0001, kt + 0.04);
          try { n.start(kt); n.stop(kt + 0.06); } catch {}
        }
      }
      setTimeout(() => { try { g.disconnect(); } catch {} }, 2200);
    } catch { /* decorative; never throw */ }
  }

  // ── Bring the engine to life on its OWN AudioContext ────────────────────────────────────
  // The OpenAI-free build never feeds PCM chunks, so the AudioPlayer's context is never created
  // and this processor used to attach to nothing (silent). This gives realism its own context so
  // the phone line, room tone and typing are actually audible. Must run after a user gesture
  // (the learner tapped START), so we resume() too. Returns the ctx, or null on failure.
  ensureContext() {
    if (this._attached && this._ctx) return this._ctx;
    try {
      const Ctx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!Ctx) return null;
      const ctx = new Ctx();
      const input = this.attach(ctx);
      if (!input) return null;                       // attach failed → caller routes voice clean
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    } catch (e) {
      console.error('[realism] ensureContext failed → clean voice fallback:', e?.message || e);
      return null;
    }
  }

  // ── Route the boss voice through the telephone line (THE "real call" feeling) ────────────
  // Connects an <audio> element's output INTO the telephone/compression/hiss graph so the voice
  // sounds like a person on a phone line, not a studio narrator. HARD FAIL-SAFE: on ANY problem
  // it returns false and the element keeps playing normally (clean) straight to the speakers —
  // the voice can never go silent. The element must have crossOrigin set BEFORE its src so a
  // cross-origin voice is processable (untainted); if CORS is refused the element simply errors
  // and the caller's existing fallback chain handles it.
  processVoiceElement(audioEl) {
    if (!audioEl) return false;
    const ctx = this.ensureContext();
    if (!ctx || !this._input) return false;
    try {
      const src = ctx.createMediaElementSource(audioEl);   // one-time per element (fresh each turn)
      src.connect(this._input);
      return true;
    } catch (e) {
      // Already-connected / bad state → leave the element on its own clean output path.
      return false;
    }
  }

  // ── Live A/B: re-apply a new config on the same context (FINAL console harness) ─────────
  apply(override) {
    if (!this._ctx) { if (override) Object.assign(this.cfg, override); return; }
    const ctx = this._ctx;
    if (override) deepMerge(this.cfg, override);
    this._teardownNodes();
    this._attached = false;
    const input = this.attach(ctx);
    // Re-point the player's voice into the new input if it exposes a reconnect hook.
    if (typeof this._reconnect === 'function') this._reconnect(input);
  }
  // AudioPlayer registers this so apply() can re-route the voice after a live rebuild.
  onReconnect(fn) { this._reconnect = fn; }

  detach() {
    this._attached = false;
    if (this._ambTimer) { clearTimeout(this._ambTimer); this._ambTimer = null; }
    this._teardownNodes();
    this._input = this._out = this._ctx = null;
  }

  _teardownNodes() {
    try { this._noise?.stop(); } catch {}
    try { this._ambNoise?.stop(); } catch {}
    for (const n of this._nodes) { try { n.disconnect(); } catch {} }
    this._nodes = []; this._noise = null; this._ambNoise = null; this._ambGain = null;
    if (this._ambTimer) { clearTimeout(this._ambTimer); this._ambTimer = null; }
  }
}

// White-noise buffer source with amplitude baked in ONCE (avoids the double-scale "squaring" bug).
function makeNoiseSource(ctx, amplitude) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * 1.0));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;       // decorative noise; not session-critical randomness
    last = (last + 0.02 * white) / 1.02;        // gentle brown-ish tilt
    ch[i] = last * amplitude * 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  return src;
}

function clamp(n, lo, hi) { n = Number(n); if (!Number.isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) base[k] = deepMerge(base[k] || {}, over[k]);
    else base[k] = over[k];
  }
  return base;
}
