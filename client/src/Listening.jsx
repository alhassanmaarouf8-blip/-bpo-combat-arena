/**
 * Listening.jsx — LISTENING + LIVE DATA-CAPTURE drill (PAID). "The interview in reverse."
 *
 * The browser SPEAKS a natural German line at full speed (free speechSynthesis). The learner
 * NEVER sees the text — they must catch the detail (number/name/date/amount) by EAR and TYPE it.
 * Grading is deterministic on the server (no model). Trains the #1 thing that gets candidates
 * rejected: understanding a fast native speaker and capturing data correctly. Zero added cost.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

// Speak German at full, native speed. rate 1.05 ≈ real call pace (deliberately NOT slowed down).
function speakDe(text, rate = 1.05) {
  try {
    const synth = typeof window !== 'undefined' && window.speechSynthesis;
    if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE'; u.rate = rate;
    const de = (synth.getVoices() || []).find((v) => /^de(-|_|$)/i.test(v.lang));
    if (de) u.voice = de;
    synth.speak(u);
    return true;
  } catch { return false; }
}

export function Listening({ token, apiUrl, lang = 'de', onClose, onGoPricing }) {
  const [phase, setPhase] = useState('loading'); // loading | practice | done | error
  const [items, setItems] = useState([]);
  const [idx, setIdx]     = useState(0);
  const [played, setPlayed] = useState(0);        // how many times current item was played
  const [response, setResponse] = useState('');
  const [busy, setBusy]   = useState(false);
  const [result, setResult] = useState(null);     // { correct, expected }
  const [ttsOk, setTtsOk] = useState(true);
  const [err, setErr]     = useState(null);
  const inputRef = useRef(null);

  const blocked = useCallback(() => { onGoPricing?.(); onClose?.(); }, [onGoPricing, onClose]);

  const load = useCallback(async () => {
    setPhase('loading'); setErr(null); setResult(null); setIdx(0); setResponse(''); setPlayed(0);
    try {
      const r = await fetch(`${apiUrl}/api/listening`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.items) || !d.items.length) throw new Error('load_failed');
      setItems(d.items); setPhase('practice');
    } catch {
      setErr({ de: 'Konnte die Übung nicht laden. Bitte erneut.', ar: 'مقدرناش نحمّل التمرين. حاول تاني.' });
      setPhase('error');
    }
  }, [apiUrl, token, blocked]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }, []);

  const item = items[idx];
  const maxPlays = (item?.replays ?? 1) + 1;   // initial play + N replays
  const canPlay  = played < maxPlays && !result;

  const play = () => {
    if (!item || !canPlay) return;
    // Progressive overload: each item in the session is spoken faster than the last
    // (1.0 → ~1.5×), so you train catching a FAST native, not a slowed-down one.
    const ok = speakDe(item.audioText, Math.min(1.55, 1.0 + idx * 0.12));
    setTtsOk(ok);
    if (ok) setPlayed((p) => p + 1);
  };

  const submit = async () => {
    if (!response.trim() || busy || result) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/listening/grade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, response }),
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'grade_failed');
      setResult(d);
    } catch {
      setErr({ de: 'Konnte nicht prüfen. Bitte erneut.', ar: 'مقدرناش نصحّح. حاول تاني.' });
    }
    setBusy(false);
  };

  const next = () => {
    setResult(null); setResponse(''); setPlayed(0); setErr(null);
    if (idx < items.length - 1) setIdx(idx + 1); else setPhase('done');
  };

  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, #0a1626 0%, #050a12 55%, #020409 100%)',
      color: '#e2e8f0', padding: '20px 16px 32px', boxSizing: 'border-box', animation: 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#34d399' }}>
        🎧 HÖR-CHECK · فهم السمع
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
      <button onClick={load} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Erneut', 'حاول تاني')}</button>
    </div>
  </>);

  if (phase === 'done') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '26px 0' }}>
      <div style={{ fontSize: 40 }}>✅</div>
      <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginTop: 8 }}>{T(lang, 'Geschafft!', 'خلّصت!')}</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, lineHeight: 1.6 }}>
        {T(lang, 'Verstehen am Telefon ist die halbe Miete im echten Job.', 'إنك تفهم في التليفون ده نص الشغل الحقيقي.')}
      </div>
      <button onClick={load} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Neue Runde', 'جولة جديدة')} ▸</button>
      <button onClick={onClose} style={{ ...ghostBtnWide, marginTop: 10, width: '100%' }}>{T(lang, 'Fertig', 'تمام')}</button>
    </div>
  </>);

  // PRACTICE
  return shell(<>
    {header}
    <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'Orbitron, monospace', letterSpacing: '0.1em', marginBottom: 8 }}>
      {T(lang, 'ANRUF', 'مكالمة')} {idx + 1} / {items.length}
    </div>
    <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
      {items.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < idx ? '#34d399' : i === idx ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>

    {/* Play card — NO text shown; the whole point is to catch it by ear */}
    <div style={{ padding: '16px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(52,211,153,0.25)', textAlign: 'center' }}>
      <button onClick={play} disabled={!canPlay} style={{ ...primaryBtn, opacity: canPlay ? 1 : 0.45, cursor: canPlay ? 'pointer' : 'default' }}>
        🔊 {played === 0 ? T(lang, 'Anruf abspielen', 'شغّل المكالمة') : T(lang, `Nochmal (${maxPlays - played} übrig)`, `كمان مرة (فاضل ${maxPlays - played})`)}
      </button>
      <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
        {T(lang, 'Echtes Tempo. Hör genau hin — du siehst den Text nicht.', 'سرعة حقيقية. ركّز كويس — مش هتشوف النص.')}
      </div>
      {!ttsOk && (
        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 8 }}>
          {T(lang, 'Sprachausgabe in diesem Browser nicht verfügbar.', 'تشغيل الصوت مش متاح في المتصفح ده.')}
        </div>
      )}
    </div>

    {/* Question + capture input */}
    {played > 0 && (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 8, ...(lang === 'ar' ? { direction: 'rtl', textAlign: 'right' } : {}) }}>
          {T(lang, item.question_de, item.question_ar)}
        </div>
        <input ref={inputRef} value={response} onChange={(e) => setResponse(e.target.value)} disabled={!!result}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={T(lang, 'Tippe, was du gehört hast…', 'اكتب اللي سمعته…')}
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: 9, fontSize: 15,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.35)', color: '#f8fafc', outline: 'none' }} />
      </div>
    )}

    {err && (
      <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, color: '#fca5a5' }}>
        {err.de}<br /><span dir="rtl">{err.ar}</span>
      </div>
    )}

    {/* Result */}
    {result ? (
      <>
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 11,
          background: result.correct ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${result.correct ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
          <div style={{ fontSize: 13.5, color: result.correct ? '#6ee7b7' : '#fca5a5', fontWeight: 700 }}>
            {result.correct ? T(lang, '✓ Richtig erfasst!', '✓ صح كده!') : T(lang, '✗ Nicht ganz', '✗ مش مظبوط')}
          </div>
          {!result.correct && (
            <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 6 }}>
              {T(lang, 'Richtig war: ', 'الصح كان: ')}<b style={{ color: '#fcd34d' }}>{result.expected}</b>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!result.correct && <button onClick={() => { setResult(null); setResponse(''); setPlayed(0); }} style={ghostBtnWide}>{T(lang, 'Nochmal hören', 'اسمع تاني')}</button>}
          <button onClick={next} style={{ ...primaryBtn, flex: 1 }}>
            {idx < items.length - 1 ? T(lang, 'Weiter ▸', 'التالي ▸') : T(lang, 'Fertig ▸', 'خلصت ▸')}
          </button>
        </div>
      </>
    ) : played > 0 ? (
      <button onClick={submit} disabled={busy || !response.trim()} style={{ ...primaryBtn, marginTop: 12, opacity: (busy || !response.trim()) ? 0.5 : 1 }}>
        {busy ? T(lang, 'Prüfe…', 'بصحّح…') : T(lang, 'Antwort prüfen', 'صحّح الإجابة')}
      </button>
    ) : null}
  </>);
}

const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'Orbitron, monospace',
  fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid #34d399', color: '#04070d',
  background: 'linear-gradient(135deg,#34d399,#6ee7b7)' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10, padding: '6px 10px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10.5, padding: '12px', minHeight: 44,
  borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
