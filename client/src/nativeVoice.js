/**
 * nativeVoice.js — play German drill audio in the app's NATIVE Deepgram Aura-2 voice, not the device's
 * browser voice. Browser `speechSynthesis` for German is a device lottery: on many phones the de-DE voice
 * is English-accented or ABSENT, which quietly invalidates a shadowing/listening drill. Aura-2 is the same
 * native voice the interview uses; fixed drill lines are server-cached → $0. Falls back to the browser
 * voice automatically if the server path fails, so audio never just goes silent.
 *
 * `drill=1` tells the server to skip the interview-minute gate (drills are unlimited).
 */
import { beginIndependentPlayback } from './salmaAudioSafety.js';

const DEFAULT_DRILL_VOICE = 'aura-2-julius-de';   // clear, neutral native-German Aura-2 voice

/**
 * Route a playing <audio> element through a telephone-band Web Audio graph so the caller line
 * sounds like it does on the actual job (the phone), not like clean studio audio that over-prepares
 * the learner on the wrong channel. Highpass ~300 Hz + lowpass ~3400 Hz = the classic phone band,
 * plus a very low-level band-limited noise floor for line-hiss realism.
 *
 * Returns the AudioContext on success (so the caller can close it), or null on any failure — in which
 * case the element keeps playing normally through the default output. NEVER throws; audio never breaks.
 *
 * NOTE: createMediaElementSource on a cross-origin <audio> can taint/silence the graph; the caller must
 * set `crossOrigin='anonymous'` before the src loads. If wiring throws we return null and play direct.
 */
function wirePhoneAudio(a) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const src = ctx.createMediaElementSource(a);        // may throw / taint on cross-origin without CORS
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 3400;
    // MAKEUP GAIN (owner 2026-07-02: "why is the Hör-Check sound so low?"). Band-passing to the
    // 300–3400 Hz phone band strips a lot of the signal's energy, so at unity gain the caller line
    // came out noticeably quieter than the un-filtered drills. 2.2× restores a clearly audible
    // level while keeping the phone-line CHARACTER (the band-pass shape is unchanged). A soft
    // limiter (DynamicsCompressor with a low threshold) guards against clipping on loud syllables.
    const g  = ctx.createGain(); g.gain.value = 2.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(lim); lim.connect(ctx.destination);

    // Very low-level line hiss, band-limited through the same lowpass so it stays in the phone band.
    try {
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noise.buffer = buf; noise.loop = true;
      const ng = ctx.createGain(); ng.gain.value = 0.0025;   // barely audible line floor
      noise.connect(ng); ng.connect(lp);
      noise.start();
    } catch { /* noise is cosmetic; the band-pass on the voice is the point */ }

    try { ctx.resume(); } catch { /* ignore */ }
    return ctx;
  } catch {
    return null;   // taint / unsupported → caller plays the element direct, unfiltered
  }
}

/**
 * Tap the REAL audio envelope of a playing <audio> so a talking-head's mouth moves WITH the words
 * (congruent + simultaneous), instead of a robotic fixed-rate flap. Routes the element through an
 * AnalyserNode → destination (so it still plays) and calls onLevel(0..1) each frame with the RMS
 * amplitude. Cross-origin caveat is the SAME as wirePhoneAudio: createMediaElementSource silences a
 * cross-origin element unless crossOrigin='anonymous' was set before src (the caller does this) AND
 * the server sends CORS (proven by the phone path). Returns {ctx, stop} or null on any failure — in
 * which case the element must play DIRECT (caller falls back to the idle flap). NEVER throws.
 */
function wireLevelAnalyser(a, onLevel) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const src = ctx.createMediaElementSource(a);       // taints (silences) cross-origin w/o CORS
    const an = ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.6;
    src.connect(an); an.connect(ctx.destination);      // MUST reach destination or the voice is muted
    const buf = new Uint8Array(an.fftSize);
    let raf = 0, alive = true;
    const tick = () => {
      if (!alive) return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);         // ~0 silence … ~0.3+ loud speech
      try { onLevel(Math.min(1, rms * 3.2)); } catch { /* ignore */ }
      raf = requestAnimationFrame(tick);
    };
    try { ctx.resume(); } catch { /* ignore */ }
    raf = requestAnimationFrame(tick);
    return { ctx, stop: () => { alive = false; cancelAnimationFrame(raf); try { onLevel(0); } catch { /* ignore */ } } };
  } catch {
    return null;   // caller plays the element direct; mouth uses the idle flap
  }
}

function browserSpeak(text, rate, onEnd, onStart, onError) {
  let releaseIndependent = null;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { releaseIndependent?.(); } catch { /* ignore */ }
    onEnd?.();
  };
  try {
    const s = window.speechSynthesis;
    if (!s) { onError?.(); finish(); return () => {}; }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = Math.min(2, rate || 1);
    const de = (s.getVoices() || []).find((v) => /^de(-|_|$)/i.test(v.lang));
    if (de) u.voice = de;
    u.onstart = () => { releaseIndependent = beginIndependentPlayback(); onStart?.(); };
    u.onend = finish;
    u.onerror = () => { onError?.(); finish(); };
    s.speak(u);
    return () => { try { s.cancel(); } catch { /* ignore */ } finish(); };
  } catch { onError?.(); finish(); return () => {}; }
}

/**
 * Speak `text` in native German. Returns a stop() function.
 * `phone:true` routes the caller line through a telephone-band Web Audio filter (highpass 300 Hz +
 * lowpass 3400 Hz + faint line hiss) so it sounds like the actual job channel. When falsy, unchanged.
 * `noBrowserFallback` DEFAULTS TO TRUE (owner standing rule 2026-07-02, emphatic: "remove all
 * unhuman voices across the app — no robotic sound is EVER allowed"): if the native Aura-2 server
 * voice fails, DO NOT drop to the device's robotic browser SpeechSynthesis voice — stay silent
 * instead (onEnd still fires so a drill/lesson that shows its text on screen keeps advancing).
 * Same discipline the interview already uses (it shows the line silently on a TTS failure rather
 * than ever play the robotic voice). The browser voice was the device-lottery, English-accented
 * German that made Shadowing feel "bullshit" — it is now OFF everywhere. Pass `false` ONLY if a
 * drill is genuinely unusable without SOME audio AND you accept the robotic risk (currently: none).
 * `salma:true` marks the request as one of Salma's own fixed lines — the server exempts those
 * from the drill plan gate (her voice must work from second zero of a fresh account, BEFORE the
 * trial clock starts at the first interview) while keeping every rate/char cap.
 * @param {{ apiUrl?:string, token?:string, text?:string, ticketRequest?:object, voice?:string, rate?:number, phone?:boolean, salma?:boolean, noBrowserFallback?:boolean, onStart?:()=>void, onError?:()=>void, onEnd?:()=>void }} o
 */
export function playNative({ apiUrl, token, text, ticketRequest = null, voice = DEFAULT_DRILL_VOICE, rate = 1, phone = false, salma = false, noBrowserFallback = true, onStart, onError, onEnd, onLevel } = {}) {
  let startNotified = false;
  let errorNotified = false;
  let doneNotified = false;
  const startedPlaying = () => {
    if (startNotified) return;
    startNotified = true;
    try { onStart?.(); } catch { /* ignore */ }
  };
  const failedToPlay = () => {
    if (errorNotified || startNotified) return;
    errorNotified = true;
    try { onError?.(); } catch { /* ignore */ }
  };
  const done = () => {
    if (doneNotified) return;
    doneNotified = true;
    try { onEnd?.(); } catch { /* ignore */ }
  };
  const t = String(text || '').trim();
  const opaqueRequest = ticketRequest && typeof ticketRequest === 'object' && !Array.isArray(ticketRequest)
    ? ticketRequest : null;
  if (!t && !opaqueRequest) { done(); return () => {}; }
  // The robotic-voice guard: either speak in the browser voice, or (rule on) stay silent but still
  // signal completion so nothing hangs waiting on audio that will never come.
  const fallbackOrSilence = () => (noBrowserFallback
    ? (failedToPlay(), done(), () => {})
    : (t ? browserSpeak(t, rate, done, startedPlaying, failedToPlay)
      : (failedToPlay(), done(), () => {})));

  // No server creds → browser voice (or silence, if the caller forbids the robotic fallback).
  if (!apiUrl || !token) return fallbackOrSilence();

  try {
    const a = new Audio();
    const ctrl = new AbortController();
    let cancelled = false;
    // For the phone filter the element feeds createMediaElementSource, which taints/silences on a
    // cross-origin src unless CORS is anonymous — set it BEFORE the src loads. No effect when phone is off.
    if (phone || onLevel) { try { a.crossOrigin = 'anonymous'; } catch { /* ignore */ } }
    try { a.playbackRate = rate || 1; a.preservesPitch = true; } catch { /* Safari: ignore */ }
    let started = false, fellBack = null, phoneCtx = null, levelWire = null, retried = false, releaseIndependent = null;
    const releasePlayback = () => { try { releaseIndependent?.(); } catch { /* ignore */ } releaseIndependent = null; };
    const closeGraphs = () => { try { levelWire?.stop(); } catch { /* ignore */ } try { levelWire?.ctx?.close(); } catch { /* ignore */ } try { phoneCtx?.close(); } catch { /* ignore */ } };
    a.onplaying = () => {
      started = true;
      if (!salma && !releaseIndependent) releaseIndependent = beginIndependentPlayback();
      startedPlaying();
    };
    a.onended = () => { releasePlayback(); closeGraphs(); done(); };
    // Pre-start failure. On the phone path the element is a CORS-mode load (crossOrigin='anonymous'):
    // the client (Vercel) and API (Render) are DIFFERENT origins, so a missing/mismatched CORS header
    // fails the load where the plain, unflagged load used to just play. Retry ONCE as a plain native
    // element (no crossOrigin, no filter) so the native Aura voice is preserved, before finally dropping
    // to the browser voice. The non-phone path is unchanged: it falls straight through to the browser voice.
    const onFail = () => {
      if (started || fellBack) return;
      if ((phone || onLevel) && !retried) {
        retried = true;
        releasePlayback(); closeGraphs(); phoneCtx = null; levelWire = null;
        // A crossOrigin load can fail if CORS is momentarily off → retry PLAIN (no filter, no analyser):
        // the native voice is preserved; the talking-head simply falls back to its idle flap.
        fellBack = playNative({ apiUrl, token, text: t, ticketRequest: opaqueRequest, voice, rate, phone: false, salma, noBrowserFallback,
          onStart: startedPlaying, onError: failedToPlay, onEnd });
      } else {
        fellBack = fallbackOrSilence();   // server failed before any audio → browser voice, or silence if forbidden
      }
    };
    a.onerror = () => {
      if (!started) { onFail(); return; }
      releasePlayback(); closeGraphs(); done();
    };
    // Wire the telephone band-pass; if it can't (unsupported/tainted) the element plays direct, unfiltered.
    if (phone) phoneCtx = wirePhoneAudio(a);
    // Talking-head mouth: tap the real envelope so the mouth moves WITH the words. Only when NOT phone
    // (one createMediaElementSource per element). On failure → null, plain playback + idle flap.
    else if (onLevel) levelWire = wireLevelAnalyser(a, onLevel);
    fetch(`${apiUrl}/api/media-ticket`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
       body: JSON.stringify(opaqueRequest || { kind: 'aura', voice, text: t, drill: true, ...(salma ? { salma: true } : {}) }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`media ticket ${r.status}`);
      const d = await r.json();
      if (!d?.ticket || cancelled) throw new Error('missing media ticket');
      a.src = `${apiUrl}/api/tts-stream?ticket=${encodeURIComponent(d.ticket)}`;
      await a.play();
    }).catch(() => { if (!cancelled) onFail(); });
    return () => {
      cancelled = true; ctrl.abort();
      try { a.pause(); a.src = ''; } catch { /* ignore */ }
      releasePlayback();
      closeGraphs();
      if (fellBack) fellBack();
    };
  } catch {
    return fallbackOrSilence();   // never the robotic voice unless a caller explicitly opted back in
  }
}

export default { playNative };
