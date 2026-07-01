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
 * @param {{ apiUrl?:string, token?:string, text:string, voice?:string, rate?:number, onEnd?:()=>void }} o
 */
export function playNative({ apiUrl, token, text, voice = DEFAULT_DRILL_VOICE, rate = 1, onEnd } = {}) {
  const done = () => { try { onEnd?.(); } catch { /* ignore */ } };
  const t = String(text || '').trim();
  if (!t) { done(); return () => {}; }

  // No server creds → straight to the browser voice.
  if (!apiUrl || !token) return browserSpeak(t, rate, done);

  try {
    const enc = encodeURIComponent;
    const url = `${apiUrl}/api/tts-stream?drill=1&voice=${enc(voice)}&token=${enc(token)}&text=${enc(t)}`;
    const a = new Audio(url);
    try { a.playbackRate = rate || 1; a.preservesPitch = true; } catch { /* Safari: ignore */ }
    let started = false, fellBack = null;
    a.onplaying = () => { started = true; };
    a.onended = done;
    a.onerror = () => { if (!started) fellBack = browserSpeak(t, rate, done); };   // server failed before any audio → browser
    a.play().catch(() => { if (!started) fellBack = browserSpeak(t, rate, done); });
    return () => { try { a.pause(); a.src = ''; } catch { /* ignore */ } if (fellBack) fellBack(); };
  } catch {
    return browserSpeak(t, rate, done);
  }
}

export default { playNative };
