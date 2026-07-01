/**
 * nativeVoice.js — play German drill audio in the app's NATIVE Deepgram Aura-2 voice, not the device's
 * browser voice. Browser `speechSynthesis` for German is a device lottery: on many phones the de-DE voice
 * is English-accented or ABSENT, which quietly invalidates a shadowing/listening drill. Aura-2 is the same
 * native voice the interview uses; fixed drill lines are server-cached → $0. Falls back to the browser
 * voice automatically if the server path fails, so audio never just goes silent.
 *
 * `drill=1` tells the server to skip the interview-minute gate (drills are unlimited).
 */
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
    const g  = ctx.createGain(); g.gain.value = 1;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ctx.destination);

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

function browserSpeak(text, rate, onEnd) {
  try {
    const s = window.speechSynthesis;
    if (!s) { onEnd?.(); return () => {}; }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = Math.min(2, rate || 1);
    const de = (s.getVoices() || []).find((v) => /^de(-|_|$)/i.test(v.lang));
    if (de) u.voice = de;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    s.speak(u);
    return () => { try { s.cancel(); } catch { /* ignore */ } };
  } catch { onEnd?.(); return () => {}; }
}

/**
 * Speak `text` in native German. Returns a stop() function.
 * `phone:true` routes the caller line through a telephone-band Web Audio filter (highpass 300 Hz +
 * lowpass 3400 Hz + faint line hiss) so it sounds like the actual job channel. When falsy, unchanged.
 * @param {{ apiUrl?:string, token?:string, text:string, voice?:string, rate?:number, phone?:boolean, onEnd?:()=>void }} o
 */
export function playNative({ apiUrl, token, text, voice = DEFAULT_DRILL_VOICE, rate = 1, phone = false, onEnd } = {}) {
  const done = () => { try { onEnd?.(); } catch { /* ignore */ } };
  const t = String(text || '').trim();
  if (!t) { done(); return () => {}; }

  // No server creds → straight to the browser voice.
  if (!apiUrl || !token) return browserSpeak(t, rate, done);

  try {
    const enc = encodeURIComponent;
    const url = `${apiUrl}/api/tts-stream?drill=1&voice=${enc(voice)}&token=${enc(token)}&text=${enc(t)}`;
    const a = new Audio();
    // For the phone filter the element feeds createMediaElementSource, which taints/silences on a
    // cross-origin src unless CORS is anonymous — set it BEFORE the src loads. No effect when phone is off.
    if (phone) { try { a.crossOrigin = 'anonymous'; } catch { /* ignore */ } }
    a.src = url;
    try { a.playbackRate = rate || 1; a.preservesPitch = true; } catch { /* Safari: ignore */ }
    let started = false, fellBack = null, phoneCtx = null, retried = false;
    a.onplaying = () => { started = true; };
    a.onended = () => { try { phoneCtx?.close(); } catch { /* ignore */ } done(); };
    // Pre-start failure. On the phone path the element is a CORS-mode load (crossOrigin='anonymous'):
    // the client (Vercel) and API (Render) are DIFFERENT origins, so a missing/mismatched CORS header
    // fails the load where the plain, unflagged load used to just play. Retry ONCE as a plain native
    // element (no crossOrigin, no filter) so the native Aura voice is preserved, before finally dropping
    // to the browser voice. The non-phone path is unchanged: it falls straight through to the browser voice.
    const onFail = () => {
      if (started || fellBack) return;
      if (phone && !retried) {
        retried = true;
        try { phoneCtx?.close(); } catch { /* ignore */ } phoneCtx = null;
        fellBack = playNative({ apiUrl, token, text: t, voice, rate, phone: false, onEnd });   // plain native, no filter
      } else {
        fellBack = browserSpeak(t, rate, done);   // server failed before any audio → browser voice
      }
    };
    a.onerror = onFail;
    // Wire the telephone band-pass; if it can't (unsupported/tainted) the element plays direct, unfiltered.
    if (phone) phoneCtx = wirePhoneAudio(a);
    a.play().catch(onFail);
    return () => {
      try { a.pause(); a.src = ''; } catch { /* ignore */ }
      try { phoneCtx?.close(); } catch { /* ignore */ }
      if (fellBack) fellBack();
    };
  } catch {
    return browserSpeak(t, rate, done);
  }
}

export default { playNative };
