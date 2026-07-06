/**
 * SpokenReview.jsx — "SAG ES RICHTIG": spoken-production spaced repetition (PAID).
 *
 * The learner's OWN past errors, resurfaced on the spaced schedule — but instead of typing,
 * they SAY the correct German out loud. Groq Whisper transcribes; the server grades
 * deterministically on the exact point (no model). Builds automatic, correct spoken production
 * of their personal weaknesses. This is the compounding core of spoken-German mastery.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ClipRecorder } from './clipRecorder.js';
import { DrillIntro } from './drillIntros.jsx';

const MAX_SEC = 18;
const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

export function SpokenReview({ token, apiUrl, lang = 'de', onClose, onGoPricing, why = null }) {
  const [phase, setPhase] = useState('loading'); // loading | practice | empty | done | error
  const [items, setItems] = useState([]);
  const [idx, setIdx]     = useState(0);
  const [recording, setRec] = useState(false);
  const [seconds, setSec] = useState(0);
  const [busy, setBusy]   = useState(false);
  const [result, setResult] = useState(null);     // { correct, expected, heard, retry }
  const [err, setErr]     = useState(null);

  const recRef = useRef(null); const timerRef = useRef(null); const stopRef = useRef(null);
  const blocked = useCallback(() => { onGoPricing?.(); onClose?.(); }, [onGoPricing, onClose]);

  const load = useCallback(async () => {
    setPhase('loading'); setErr(null); setResult(null); setIdx(0);
    try {
      const r = await fetch(`${apiUrl}/api/spoken-review?t=${Date.now()}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error('load_failed');
      if (!Array.isArray(d.items) || !d.items.length) { setPhase('empty'); return; }
      setItems(d.items); setPhase('practice');
    } catch {
      setErr({ de: 'Konnte die Wiederholung nicht laden.', ar: 'مقدرناش نحمّل المراجعة.' });
      setPhase('error');
    }
  }, [apiUrl, token, blocked]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { clearInterval(timerRef.current); clearTimeout(stopRef.current); recRef.current?.stop?.().catch(() => {}); }, []);

  const item = items[idx];

  const startRec = async () => {
    setErr(null); setResult(null);
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); }
    catch (e) {
      const c = e?.code;
      setErr(c === 'MIC_DENIED' ? { de: 'Mikrofon blockiert. Bitte erlauben.', ar: 'المايك متمنوع. اسمح بيه.' }
           : c === 'MIC_NOT_FOUND' ? { de: 'Kein Mikrofon gefunden.', ar: 'مفيش مايك.' }
           : { de: 'Mikrofon-Start fehlgeschlagen.', ar: 'مقدرناش نشغّل المايك.' });
      return;
    }
    recRef.current = rec; setRec(true); setSec(0);
    timerRef.current = setInterval(() => setSec((x) => x + 1), 1000);
    stopRef.current  = setTimeout(() => stopRec(), MAX_SEC * 1000);
  };

  const stopRec = async () => {
    const rec = recRef.current; if (!rec) return;
    recRef.current = null; clearInterval(timerRef.current); clearTimeout(stopRef.current); setRec(false);
    let clip; try { clip = await rec.stop(); } catch { setErr({ de: 'Aufnahme fehlgeschlagen.', ar: 'فشل التسجيل.' }); return; }
    if (!clip?.blob || clip.blob.size < 1200) { setErr({ de: 'Nichts aufgenommen — sprich bitte.', ar: 'مفيش صوت — اتكلم من فضلك.' }); return; }
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/api/spoken-review/grade?id=${encodeURIComponent(item.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` }, body: clip.blob,
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'failed');
      setResult(d);
    } catch (e) {
      setErr(e.message === 'no_api_key' ? { de: 'Dienst gerade nicht verfügbar.', ar: 'الخدمة مش متاحة دلوقتي.' }
                                        : { de: 'Konnte nicht auswerten. Bitte erneut.', ar: 'مقدرناش نحلّل. حاول تاني.' });
    }
    setBusy(false);
  };

  const next = () => { setResult(null); setErr(null); setSec(0); if (idx < items.length - 1) setIdx(idx + 1); else setPhase('done'); };

  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, #0a1626 0%, #050a12 55%, #020409 100%)',
      color: '#e2e8f0', padding: '20px 16px 32px', boxSizing: 'border-box', animation: 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (
    <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: 'var(--accent)' }}>
        🗯️ SAG ES RICHTIG · قولها صح
      </span>
      <button onClick={onClose} style={ghostBtn}>{T(lang, 'Schließen', 'إغلاق')} ✕</button>
    </div>
    {/* WHY-YOU framing: set only when the brain/debrief prescribed this drill (owner law 5). */}
    {why && (
      <div style={{ margin: '0 0 12px', padding: '9px 11px', borderRadius: 8, fontSize: 12, lineHeight: 1.55,
        color: '#cbd5e1', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', textAlign: 'left' }}>
        {why}
      </div>
    )}
    </>
  );

  if (phase === 'loading') return shell(<>{header}<div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>…</div></>);
  if (phase === 'error') return shell(<>{header}<div style={{ textAlign: 'center', padding: '30px 0' }}><div style={{ fontSize: 36 }}>⚠</div><div style={{ fontSize: 13, color: '#fca5a5', marginTop: 8 }}>{err?.de}<br /><span dir="rtl">{err?.ar}</span></div><button onClick={load} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Erneut', 'تاني')}</button></div></>);

  if (phase === 'empty') return shell(<>{header}
    <div style={{ textAlign: 'center', padding: '30px 0' }}>
      <div style={{ fontSize: 40 }}>🎉</div>
      <div style={{ fontSize: 15, color: '#f8fafc', fontWeight: 700, marginTop: 8 }}>{T(lang, 'Nichts fällig — alles aufgeholt!', 'مفيش حاجة مستحقة — كله متعمل!')}</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, lineHeight: 1.6 }}>{T(lang, 'Mach ein Interview — neue Fehler werden hier zum Laut-Üben.', 'اعمل مقابلة — الأخطاء الجديدة هتظهر هنا علشان تتمرن عليها بصوتك.')}</div>
      <button onClick={onClose} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Fertig', 'تمام')}</button>
    </div></>);

  if (phase === 'done') return shell(<>{header}
    <div style={{ textAlign: 'center', padding: '26px 0' }}>
      <div style={{ fontSize: 40 }}>✅</div>
      <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginTop: 8 }}>{T(lang, 'Laut geübt — so wird es automatisch.', 'اتمرنت بصوتك — كده بيبقى تلقائي.')}</div>
      <button onClick={load} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Mehr Wiederholungen', 'مراجعة أكتر')} ▸</button>
      <button onClick={onClose} style={{ ...ghostBtnWide, marginTop: 10, width: '100%' }}>{T(lang, 'Fertig', 'تمام')}</button>
    </div></>);

  // PRACTICE
  return shell(<>
    {header}
    <DrillIntro drillKey="spokenreview" />
    <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-display)', letterSpacing: '0.1em', marginBottom: 8 }}>
      {T(lang, 'DEINE FEHLER', 'أخطاؤك')} · {idx + 1} / {items.length}
    </div>
    <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
      {items.map((_, i) => (<div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i < idx ? 'var(--accent)' : i === idx ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)' }} />))}
    </div>

    <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(59,130,246,0.25)' }}>
      <div style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.12em', marginBottom: 6 }}>{item?.rule}</div>
      <div style={{ fontSize: 15, color: '#f8fafc', lineHeight: 1.5 }}>{T(lang, item?.prompt, item?.prompt)}</div>
      {item?.wrong && (
        <div style={{ fontSize: 13, color: '#fca5a5', marginTop: 8, lineHeight: 1.5 }}>
          {/* Clarified 2026-07-02 (owner: "just a crossed-out line that doesn't represent
              anything"): the strikethrough sentence is the learner's OWN past error, resurfaced
              for active recall — say the CORRECTED version from memory, not read this aloud.
              Explaining that explicitly closes the "why am I looking at this" gap. */}
          {/* German only — OWNER-AR slot (never authoring Arabic here); falls back to German
              under the Arabic toggle until the owner writes the masri translation. */}
          <span style={{ fontSize: 9, color: '#64748b' }}>DAS HAST DU FRÜHER FALSCH GESAGT (durchgestrichen):</span><br />
          <span style={{ textDecoration: 'line-through', opacity: 0.85 }}>{item.wrong}</span>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 6 }}>
            → Sag jetzt die richtige Version aus dem Gedächtnis — nicht ablesen, sondern erinnern.
          </div>
        </div>
      )}
    </div>

    {err && <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, color: '#fca5a5' }}>{err.de}<br /><span dir="rtl">{err.ar}</span></div>}

    <div style={{ marginTop: 16, textAlign: 'center' }}>
      {recording ? (
        <>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, color: seconds >= MAX_SEC - 4 ? 'var(--action)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>00:{String(seconds).padStart(2, '0')}</div>
          <button onClick={stopRec} style={{ ...primaryBtn, marginTop: 8, background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}>⏹ {T(lang, 'Fertig', 'خلصت')}</button>
        </>
      ) : busy ? (
        <div style={{ color: '#94a3b8', fontSize: 13, padding: 14 }}>⏳ {T(lang, 'Wird geprüft…', 'بصحّح…')}</div>
      ) : result ? (
        <>
          {result.retry ? (
            <div style={{ textAlign: 'left', padding: '11px 13px', borderRadius: 10, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.3)', fontSize: 12.5, color: 'var(--action-2)' }}>{T(lang, 'Nichts erkannt — sag es bitte noch einmal.', 'مفيش كلام اتسمع — قولها تاني.')}</div>
          ) : (
            <div style={{ textAlign: 'left' }}>
              <div style={{ padding: '12px 14px', borderRadius: 11, background: result.correct ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${result.correct ? 'rgba(59,130,246,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
                <div style={{ fontSize: 13.5, color: result.correct ? 'var(--accent-2)' : '#fca5a5', fontWeight: 700 }}>
                  {result.correct ? T(lang, '✓ Richtig gesagt!', '✓ قلتها صح!') : T(lang, '✗ Noch nicht ganz', '✗ لسه مش مظبوط')}
                </div>
                <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 6 }}>{T(lang, 'Richtig: ', 'الصح: ')}<b style={{ color: 'var(--good)' }}>{result.expected}</b></div>
                {result.heard && <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6 }}>{T(lang, 'Gehört: ', 'اتسمع: ')}„{result.heard}"</div>}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => { setResult(null); startRec(); }} style={ghostBtnWide}>{T(lang, 'Nochmal', 'تاني')}</button>
            <button onClick={next} style={{ ...primaryBtn, flex: 1 }}>{idx < items.length - 1 ? T(lang, 'Weiter ▸', 'التالي ▸') : T(lang, 'Fertig ▸', 'خلصت ▸')}</button>
          </div>
        </>
      ) : (
        <>
          <button onClick={startRec} style={{ ...primaryBtn, fontSize: 14 }}>● {T(lang, 'Korrekt sagen — aufnehmen', 'سجّلها صح')}</button>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>{T(lang, 'Sag den ganzen, korrekten Satz laut.', 'قول الجملة الصح كلها بصوت عالي.')}</div>
        </>
      )}
    </div>
  </>);
}

const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid var(--accent)', color: '#04070d', background: 'linear-gradient(135deg,var(--accent),var(--accent-2))' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10, padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10.5, padding: '12px', minHeight: 44, borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
