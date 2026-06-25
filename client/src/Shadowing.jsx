/**
 * Shadowing.jsx — pronunciation practice (PAID). The browser SPEAKS a model German
 * sentence (built-in speechSynthesis, zero cost), the learner records themselves repeating
 * it, and the server returns a transcript + a short Arabic pronunciation note. NEVER opens a
 * Realtime session (ClipRecorder keeps audio local until submit) and uses only existing
 * cheap models. 3–5 sentences per session; sessions are unlimited.
 *
 * Gating is server-side: GET/POST return 402 for free/expired accounts → we route to pricing.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ClipRecorder } from './clipRecorder.js';

const MAX_SEC = 20;   // a single sentence repeat is short
const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

// Speak a German sentence via the browser's built-in TTS. Returns false if unavailable.
function speakDe(text) {
  try {
    const synth = typeof window !== 'undefined' && window.speechSynthesis;
    if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = 0.95;
    const de = (synth.getVoices() || []).find((v) => /^de(-|_|$)/i.test(v.lang));
    if (de) u.voice = de;
    synth.speak(u);
    return true;
  } catch { return false; }
}

export function Shadowing({ token, apiUrl, lang = 'de', onClose, onGoPricing }) {
  const [phase, setPhase]   = useState('loading'); // loading | practice | done | error
  const [sentences, setSen] = useState([]);
  const [idx, setIdx]       = useState(0);
  const [recording, setRec] = useState(false);
  const [seconds, setSec]   = useState(0);
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);      // { transcript, match, note_de, note_ar, retry }
  const [ttsOk, setTtsOk]   = useState(true);
  const [err, setErr]       = useState(null);

  const recRef   = useRef(null);
  const timerRef = useRef(null);
  const stopRef  = useRef(null);

  const blocked = useCallback(() => { onGoPricing?.(); onClose?.(); }, [onGoPricing, onClose]);

  const loadSession = useCallback(async () => {
    setPhase('loading'); setErr(null); setResult(null); setIdx(0);
    try {
      const r = await fetch(`${apiUrl}/api/shadowing`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.sentences) || !d.sentences.length) throw new Error('load_failed');
      setSen(d.sentences); setPhase('practice');
    } catch {
      setErr({ de: 'Konnte die Übung nicht laden. Bitte erneut versuchen.', ar: 'مقدرناش نحمّل التمرين. حاول تاني.' });
      setPhase('error');
    }
  }, [apiUrl, token, blocked]);

  useEffect(() => { loadSession(); }, [loadSession]);
  // Warm up the voice list (Chrome loads voices asynchronously).
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);
  useEffect(() => () => {
    clearInterval(timerRef.current); clearTimeout(stopRef.current);
    recRef.current?.stop?.().catch(() => {});
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }, []);

  const s = sentences[idx];

  const play = () => { if (s) setTtsOk(speakDe(s.de)); };

  const startRec = async () => {
    setErr(null); setResult(null);
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); }
    catch (e) {
      const c = e?.code;
      setErr(c === 'MIC_DENIED'    ? { de: 'Mikrofon-Zugriff wurde blockiert. Bitte im Browser erlauben.', ar: 'الوصول للمايك متمنوع. اسمح بيه من المتصفح.' }
           : c === 'MIC_NOT_FOUND' ? { de: 'Kein Mikrofon gefunden.', ar: 'مفيش مايك متوصّل.' }
           : { de: 'Mikrofon konnte nicht gestartet werden.', ar: 'مقدرناش نشغّل المايك.' });
      return;
    }
    recRef.current = rec;
    setRec(true); setSec(0);
    timerRef.current = setInterval(() => setSec((x) => x + 1), 1000);
    stopRef.current  = setTimeout(() => stopRec(), MAX_SEC * 1000);
  };

  const stopRec = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    clearInterval(timerRef.current); clearTimeout(stopRef.current);
    setRec(false);

    let clip;
    try { clip = await rec.stop(); }
    catch { setErr({ de: 'Aufnahme fehlgeschlagen. Bitte erneut.', ar: 'فشل التسجيل. جرّب تاني.' }); return; }

    // Edge case: empty/too-short clip — don't even hit the server.
    if (!clip?.blob || clip.blob.size < 1200) {
      setErr({ de: 'Nichts aufgenommen — bitte sprich den Satz nach.', ar: 'مفيش صوت اتسجّل — كرّر الجملة من فضلك.' });
      return;
    }

    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/api/shadowing/score?id=${s.id}&ms=${clip.durationMs}`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` }, body: clip.blob,
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'shadowing_failed');
      setResult(d);   // may be { retry:true } when nothing was transcribed
    } catch (e) {
      setErr(e.message === 'no_api_key'
        ? { de: 'Dienst gerade nicht verfügbar. Bitte später.', ar: 'الخدمة مش متاحة دلوقتي. جرّب بعدين.' }
        : { de: 'Konnte die Aufnahme nicht verarbeiten. Bitte erneut.', ar: 'مقدرناش نعالج الصوت. سجّل تاني.' });
    }
    setBusy(false);
  };

  const next = () => {
    setResult(null); setErr(null); setSec(0);
    if (idx < sentences.length - 1) setIdx(idx + 1);
    else setPhase('done');
  };

  // ── shells ──
  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, #0a1626 0%, #050a12 55%, #020409 100%)',
      color: '#e2e8f0', padding: '20px 16px 32px', boxSizing: 'border-box', animation: 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#22d3ee' }}>
        🗣️ SHADOWING · ترديد
      </span>
      <button onClick={onClose} style={ghostBtn}>{T(lang, 'Schließen', 'إغلاق')} ✕</button>
    </div>
  );

  if (phase === 'loading') return shell(<>{header}<div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>…</div></>);

  if (phase === 'error') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '30px 0' }}>
      <div style={{ fontSize: 36 }}>⚠</div>
      <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.6, marginTop: 8 }}>{err?.de}<br /><span dir="rtl">{err?.ar}</span></div>
      <button onClick={loadSession} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Erneut versuchen', 'حاول تاني')}</button>
    </div>
  </>);

  if (phase === 'done') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '26px 0' }}>
      <div style={{ fontSize: 40 }}>✅</div>
      <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginTop: 8 }}>{T(lang, 'Runde geschafft!', 'خلّصت الجولة!')}</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, lineHeight: 1.6 }}>
        {T(lang, 'Noch eine Runde? Es ist unbegrenzt.', 'جولة تانية؟ بلا حدود.')}
      </div>
      <button onClick={loadSession} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Neue Runde', 'جولة جديدة')} ▸</button>
      <button onClick={onClose} style={{ ...ghostBtnWide, marginTop: 10, width: '100%' }}>{T(lang, 'Fertig', 'تمام')}</button>
    </div>
  </>);

  // ── PRACTICE ──
  return shell(<>
    {header}
    <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'Orbitron, monospace', letterSpacing: '0.1em', marginBottom: 8 }}>
      {T(lang, 'SATZ', 'جملة')} {idx + 1} / {sentences.length}
    </div>
    <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
      {sentences.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < idx ? '#22d3ee' : i === idx ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>

    {/* the model sentence */}
    <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(34,211,238,0.22)' }}>
      <div style={{ fontSize: 16, color: '#f8fafc', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{s?.de}</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 7, lineHeight: 1.6 }}>{s?.en}</div>
      <button onClick={play} style={{ ...ghostBtnWide, marginTop: 12, width: '100%' }}>
        🔊 {T(lang, 'Anhören', 'استمع')}
      </button>
      {!ttsOk && (
        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6, lineHeight: 1.5 }}>
          {T(lang, 'Sprachausgabe in diesem Browser nicht verfügbar — lies den Satz und sprich ihn nach.',
                   'تشغيل الصوت مش متاح في المتصفح ده — اقرأ الجملة وكرّرها.')}
        </div>
      )}
    </div>

    {err && (
      <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, color: '#fca5a5' }}>
        {err.de}<br /><span dir="rtl">{err.ar}</span>
      </div>
    )}

    {/* recorder / result */}
    <div style={{ marginTop: 16, textAlign: 'center' }}>
      {recording ? (
        <>
          <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 30, color: seconds >= MAX_SEC - 5 ? '#f59e0b' : '#22d3ee', fontVariantNumeric: 'tabular-nums' }}>
            00:{String(seconds).padStart(2, '0')}
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 12 }}>{T(lang, `max. ${MAX_SEC} Sek.`, `الأقصى ${MAX_SEC} ثانية`)}</div>
          <button onClick={stopRec} style={{ ...primaryBtn, background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}>
            ⏹ {T(lang, 'Stopp', 'إيقاف')}
          </button>
        </>
      ) : busy ? (
        <div style={{ color: '#94a3b8', fontSize: 13, padding: 14 }}>⏳ {T(lang, 'Wird ausgewertet…', 'بنحلّل…')}</div>
      ) : result ? (
        <>
          {result.retry ? (
            <div style={{ textAlign: 'left', padding: '11px 13px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12.5, color: '#fde68a', lineHeight: 1.5 }}>
              {T(lang, 'Nichts erkannt — sprich den Satz bitte noch einmal nach.', 'مفيش كلام اتسمع — كرّر الجملة تاني من فضلك.')}
            </div>
          ) : (
            <div style={{ textAlign: 'left' }}>
              <div style={{ padding: '11px 13px', borderRadius: 10, background: 'rgba(34,211,238,0.07)', border: '1px solid rgba(34,211,238,0.3)' }}>
                <div style={{ fontSize: 9, color: '#22d3ee', letterSpacing: '0.1em', marginBottom: 5 }}>
                  {T(lang, 'WORTGENAUIGKEIT', 'دقة الكلمات')} · {result.match}%
                </div>
                <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{result.transcript}</div>
              </div>
              {Array.isArray(result.missed) && result.missed.length > 0 && (
                <div style={{ padding: '11px 13px', borderRadius: 10, marginTop: 8, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <div style={{ fontSize: 9, color: '#f59e0b', letterSpacing: '0.1em', marginBottom: 5 }}>{T(lang, 'NICHT ERKANNT', 'مش اتعرفت')}</div>
                  <div style={{ fontSize: 13, color: '#fcd34d', lineHeight: 1.6 }}>{result.missed.join(' · ')}</div>
                </div>
              )}
              <div style={{ fontSize: 9.5, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                {T(lang,
                  'Misst, welche Wörter erkannt wurden — nicht deinen Akzent. Hör den Satz an und vergleiche selbst.',
                  'بيقيس الكلمات اللي اتعرفت — مش نطقك. اسمع الجملة وقارن بنفسك.')}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => { setResult(null); startRec(); }} style={{ ...ghostBtnWide }}>{T(lang, 'Nochmal', 'تاني')}</button>
            <button onClick={next} style={{ ...primaryBtn, flex: 1 }}>
              {idx < sentences.length - 1 ? T(lang, 'Weiter ▸', 'التالي ▸') : T(lang, 'Fertig ▸', 'خلصت ▸')}
            </button>
          </div>
        </>
      ) : (
        <>
          <button onClick={startRec} style={{ ...primaryBtn, fontSize: 14 }}>● {T(lang, 'Nachsprechen aufnehmen', 'سجّل وانت بتكرّر')}</button>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
            {T(lang, 'Hör den Satz an, dann sprich ihn nach.', 'اسمع الجملة، وبعدين كرّرها.')}
          </div>
        </>
      )}
    </div>
  </>);
}

// ── shared button styles (match the Assessment screen) ──
const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'Orbitron, monospace',
  fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid #22d3ee', color: '#04070d',
  background: 'linear-gradient(135deg,#22d3ee,#00e5ff)' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10, padding: '6px 10px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10.5, padding: '12px', minHeight: 44,
  borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
