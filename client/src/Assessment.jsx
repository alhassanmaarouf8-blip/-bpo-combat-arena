/**
 * Assessment.jsx — the FREE intelligent level assessment (the conversion hook).
 *
 * Turn-based, NOT live voice: 5 fixed escalating questions, the user records each (≤60s,
 * one re-record), every clip is transcribed by the CHEAP Groq Whisper, then ONE
 * Groq llama-3.3-70b call analyzes all five. It NEVER opens a Realtime session (ClipRecorder keeps
 * the audio local until submit). One per account, enforced server-side.
 *
 * Phase 1 shows a simple but readable verdict so the AI quality can be judged. Phase 2 will
 * replace the verdict block with the polished arena results screen.
 */
import { useState, useRef, useEffect } from 'react';
import { LoadingPane } from './Loading.jsx';
import { ClipRecorder } from './clipRecorder.js';

const MAX_SEC = 60;

const QUESTIONS = [
  { id: 1, band: 'A1 · A2', de: 'Stellen Sie sich kurz vor — Name, Herkunft, was Sie arbeiten.',                         ar: 'عرّف بنفسك باختصار — الاسم، إنت منين، وبتشتغل إيه.' },
  { id: 2, band: 'A2 · B1', de: 'Beschreiben Sie Ihren letzten Arbeitstag. Was haben Sie gemacht?',                       ar: 'احكِ عن آخر يوم شغل ليك. عملت إيه؟' },
  { id: 3, band: 'B1',      de: 'Ein Kunde ist verärgert — seine Lieferung ist nicht angekommen. Was sagen Sie ihm?',     ar: 'عميل زعلان لأن الشحنة متوصلتش. هتقول له إيه؟' },
  { id: 4, band: 'B1 · B2', de: 'Erzählen Sie von einem Konflikt mit einem Kollegen und wie Sie ihn gelöst haben.',       ar: 'احكِ عن خلاف حصل مع زميل وإزاي حليته.' },
  { id: 5, band: 'B2 · C1', de: 'Warum sollten wir Sie einstellen und nicht jemand anderen? Begründen Sie mit Beispielen.', ar: 'ليه نعيّنك إنت بالذات مش حد تاني؟ اشرح بأمثلة.' },
];

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

export function Assessment({ token, apiUrl, lang = 'de', onClose, onGoPricing, onStartInterview }) {
  const [phase, setPhase]   = useState('loading');  // loading | intro | question | analyzing | verdict | error
  const [idx, setIdx]       = useState(0);
  const [answers, setAns]   = useState(Array(QUESTIONS.length).fill(null)); // [{transcript, durationMs}]
  const [recording, setRec] = useState(false);
  const [seconds, setSec]   = useState(0);
  const [busy, setBusy]     = useState(false);
  const [reRecorded, setRR] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr]       = useState(null);
  const [typed, setTyped]   = useState('');

  const recRef   = useRef(null);
  const timerRef = useRef(null);
  const stopRef  = useRef(null);

  // Is this account's one free assessment already used? If so, show the stored verdict.
  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/assessment/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (cancel) return; if (d.used && d.result) { setResult(d.result); setPhase('verdict'); } else setPhase('intro'); })
      .catch(() => { if (!cancel) setPhase('intro'); });
    return () => { cancel = true; };
  }, [token, apiUrl]);

  // Clean up any live recorder/timers on unmount.
  useEffect(() => () => {
    clearInterval(timerRef.current); clearTimeout(stopRef.current);
    recRef.current?.stop?.().catch(() => {});
  }, []);

  const q = QUESTIONS[idx];
  const answer = answers[idx];

  const startRec = async () => {
    setErr(null);
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); }
    catch (e) {
      const c = e?.code;
      setErr(c === 'MIC_DENIED'    ? { de: 'Mikrofon-Zugriff wurde blockiert. Du kannst deine Antwort unten tippen.', ar: 'الوصول للمايك متمنوع. تقدر تكتب إجابتك تحت.' }
           : c === 'MIC_NOT_FOUND' ? { de: 'Kein Mikrofon gefunden.', ar: 'مفيش مايك متوصّل.' }
           : { de: 'Mikrofon konnte nicht gestartet werden.', ar: 'مقدرناش نشغّل المايك.' });
      return;
    }
    recRef.current = rec;
    setRec(true); setSec(0);
    timerRef.current = setInterval(() => setSec((s) => s + 1), 1000);
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
    catch { setErr({ de: 'Aufnahme fehlgeschlagen.', ar: 'فشل التسجيل.' }); return; }

    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/api/assessment/transcribe?ms=${clip.durationMs}`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` }, body: clip.blob,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'transcribe_failed');
      setAns((prev) => { const n = [...prev]; n[idx] = { transcript: d.transcript || '', durationMs: clip.durationMs, inputMode: 'voice' }; return n; });
    } catch (e) {
      setErr(e.message === 'no_api_key'
        ? { de: 'Dienst gerade nicht verfügbar. Bitte später erneut.', ar: 'الخدمة مش متاحة دلوقتي. جرّب بعدين.' }
        : { de: 'Konnte die Aufnahme nicht verarbeiten. Bitte erneut aufnehmen.', ar: 'مقدرناش نحوّل الصوت لنص. سجّل تاني.' });
    }
    setBusy(false);
  };

  const reRecord = () => { if (reRecorded) return; setRR(true); setTyped(''); setAns((prev) => { const n = [...prev]; n[idx] = null; return n; }); startRec(); };

  const saveTyped = () => {
    const transcript = typed.trim().slice(0, 4000);
    if (transcript.length < 2) return;
    setAns((prev) => { const n = [...prev]; n[idx] = { transcript, durationMs: 0, inputMode: 'typed' }; return n; });
    setErr(null);
  };

  const next = () => { if (idx < QUESTIONS.length - 1) { setIdx(idx + 1); setRR(false); setTyped(''); setSec(0); setErr(null); } };

  const submit = async () => {
    setPhase('analyzing'); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/assessment/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ answers: answers.map((a, i) => ({ q: QUESTIONS[i].de, transcript: a?.transcript || '', inputMode: a?.inputMode || 'typed' })) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'analyze_failed');
      setResult(d.result); setPhase('verdict');
    } catch {
      setErr({ de: 'Auswertung fehlgeschlagen. Bitte erneut versuchen.', ar: 'فشل التحليل. جرّب تاني.' });
      setPhase('error');
    }
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
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: 'var(--accent)' }}>
        EINSTUFUNG · تقييم مستواك
      </span>
      <button onClick={onClose} style={ghostBtn}>{T(lang, 'Schließen', 'إغلاق')}</button>
    </div>
  );

  if (phase === 'loading') return shell(<LoadingPane />);

  // ── INTRO ──
  if (phase === 'intro') return shell(<>
    {header}
    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: '#f8fafc', margin: '8px 0' }}>
      {T(lang, 'Kostenlose Einstufung', 'تقييم مستواك المجاني')}
    </h2>
    <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
      {T(lang,
        '5 kurze Fragen auf Deutsch. Antworte per Stimme oder Text. Am Ende bekommst du eine ehrliche Einschätzung deines Niveaus und deiner größten Blocker. Dauert ~5 Minuten.',
        '٥ أسئلة قصيرة بالألماني. جاوب بصوتك أو بالكتابة. في الآخر هتعرف مستواك التقريبي وأكبر الحاجات اللي بتوقفك. بياخد ٥ دقايق تقريبًا.')}
    </p>
    <div dir="rtl" style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
      {T(lang, 'كل ده مجاني للبداية — والمشتركين بيقدروا يعيدوه كل شهر.', 'كل ده مجاني للبداية — والمشتركين بيقدروا يعيدوه كل شهر.')}
    </div>
    <button onClick={() => setPhase('question')} style={{ ...primaryBtn, marginTop: 18 }}>
      {T(lang, 'Los geht’s', 'يلا نبدأ')} ▸
    </button>
  </>);

  // ── ANALYZING ──
  if (phase === 'analyzing') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div style={{ width: 60, height: 60, margin: '0 auto 18px', borderRadius: '50%',
        border: '3px solid rgba(59,130,246,0.16)', borderTopColor: 'var(--accent)', animation: 'spin 0.9s linear infinite' }} />
      <div style={{ fontSize: 14, color: '#f8fafc' }}>{T(lang, 'Deine Antworten werden ausgewertet…', 'بنحلّل إجاباتك…')}</div>
      <div dir="rtl" style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>استنى لحظة</div>
    </div>
  </>);

  // ── ERROR ──
  if (phase === 'error') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '30px 0' }}>
      <div style={{ fontSize: 36 }}>⚠</div>
      <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.6, marginTop: 8 }}>
        {err?.de}<br /><span dir="rtl">{err?.ar}</span>
      </div>
      <button onClick={submit} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Erneut versuchen', 'حاول تاني')}</button>
    </div>
  </>);

  // ── VERDICT (Phase 1 simple render — Phase 2 will polish) ──
  if (phase === 'verdict' && result) return shell(<>
    {header}
    <Verdict result={result} lang={lang} onGoPricing={onGoPricing} onClose={onClose} onStartInterview={onStartInterview} />
  </>);

  // ── QUESTION ──
  return shell(<>
    {header}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-display)', letterSpacing: '0.1em' }}>
        {T(lang, 'FRAGE', 'سؤال')} {idx + 1} / {QUESTIONS.length}
      </span>
      <span style={{ fontSize: 10, color: 'var(--accent)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 99, padding: '2px 9px' }}>{q.band}</span>
    </div>
    {/* progress dots */}
    <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
      {QUESTIONS.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < idx ? 'var(--accent)' : i === idx ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>

    {/* the German prompt + Arabic translation so they understand the task */}
    <div style={{ padding: '13px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(59,130,246,0.22)' }}>
      <div style={{ fontSize: 15, color: '#f8fafc', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{q.de}</div>
      <div dir="rtl" style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 7, lineHeight: 1.6 }}>{q.ar}</div>
    </div>

    {err && (
      <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, color: '#fca5a5' }}>
        {err.de}<br /><span dir="rtl">{err.ar}</span>
      </div>
    )}

    {/* recorder */}
    <div style={{ marginTop: 16, textAlign: 'center' }}>
      {recording ? (
        <>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, color: seconds >= MAX_SEC - 10 ? 'var(--action)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
            00:{String(seconds).padStart(2, '0')}
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 12 }}>{T(lang, `max. ${MAX_SEC} Sek.`, `الأقصى ${MAX_SEC} ثانية`)}</div>
          <button onClick={stopRec} style={{ ...primaryBtn, background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}>
            ⏹ {T(lang, 'Aufnahme stoppen', 'إيقاف التسجيل')}
          </button>
        </>
      ) : busy ? (
        <div style={{ color: '#94a3b8', fontSize: 13, padding: 14 }}>{T(lang, 'Wird verarbeitet…', 'بنحوّل صوتك لنص…')}</div>
      ) : answer ? (
        <>
          <div style={{ textAlign: 'left', padding: '11px 13px', borderRadius: 10, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)' }}>
            <div style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 5 }}>{T(lang, 'DEINE ANTWORT', 'إجابتك')}</div>
            <textarea value={answer.transcript || ''} maxLength={4000} lang="de" dir="ltr"
              aria-label={T(lang, 'Erkannten Text korrigieren', 'صحّح النص اللي اتسمع')}
              onChange={(e) => setAns((prev) => { const n = [...prev]; n[idx] = { ...n[idx], transcript: e.target.value, transcriptCorrected: true }; return n; })}
              style={{ width:'100%', minHeight:72, boxSizing:'border-box', resize:'vertical', padding:9, borderRadius:8,
                background:'rgba(0,0,0,0.25)', border:'1px solid rgba(148,163,184,0.3)', color:'#e2e8f0', fontSize:13, lineHeight:1.5 }} />
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:5, lineHeight:1.45 }}>
              {T(lang, 'Korrigiere nur Erkennungsfehler — formuliere deine Antwort nicht neu.', 'صحّح بس أخطاء السماع — ما تعيدش صياغة إجابتك.')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {answer.inputMode !== 'typed' && !reRecorded && (
              <button onClick={reRecord} style={{ ...ghostBtnWide }}>{T(lang, 'Nochmal aufnehmen (1×)', 'سجّل تاني (مرة)')}</button>
            )}
            <button onClick={idx < QUESTIONS.length - 1 ? next : submit} style={{ ...primaryBtn, flex: 1 }}>
              {idx < QUESTIONS.length - 1 ? T(lang, 'Weiter ▸', 'التالي ▸') : T(lang, 'Auswerten ▸', 'اعرف النتيجة ▸')}
            </button>
          </div>
        </>
      ) : (
        <>
          <button onClick={startRec} style={{ ...primaryBtn, fontSize: 14 }}>● {T(lang, 'Aufnahme starten', 'ابدأ التسجيل')}</button>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
            {T(lang, 'Sprich deine Antwort — oder tippe sie.', 'رُد بصوتك — أو اكتب إجابتك.')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'stretch' }}>
            <textarea value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={4000}
              lang="de" dir="ltr" aria-label={T(lang, 'Antwort auf Deutsch tippen', 'اكتب إجابتك بالألماني')}
              placeholder={T(lang, 'Antwort auf Deutsch tippen…', 'اكتب إجابتك بالألماني…')}
              style={{ flex: 1, minHeight: 72, resize: 'vertical', padding: 10, borderRadius: 9,
                border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 14 }} />
            <button onClick={saveTyped} disabled={typed.trim().length < 2}
              style={{ ...ghostBtn, minWidth: 82, opacity: typed.trim().length < 2 ? 0.45 : 1 }}>
              {T(lang, 'Speichern', 'حفظ')}
            </button>
          </div>
        </>
      )}
    </div>
  </>);
}

// ── Phase-1 verdict (functional; Phase 2 replaces this with the polished arena screen) ──
function Verdict({ result, lang, onGoPricing, onClose, onStartInterview }) {
  const lvl = result.estimatedLevel || 'A2';
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{T(lang, 'Dein geschätztes Niveau', 'مستواك التقريبي')}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 900, color: 'var(--accent)', textShadow: '0 0 22px rgba(59,130,246,0.5)' }}>~{lvl}</div>
        <div style={{ fontSize: 10, color: '#64748b' }}>{T(lang, 'Konfidenz', 'مستوى الثقة')}: {result.confidence}</div>
      </div>

      <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.5, marginBottom: 16 }}>
        {T(lang, 'Eine ehrliche Schätzung als Startpunkt — kein offizielles Zertifikat.', 'ده تقدير تقريبي عشان تعرف تبدأ منين — مش شهادة رسمية.')}
        <br />{T(lang, 'Aussprache und Sprechtempo wurden in dieser Textauswertung nicht bewertet.', 'النطق وسرعة الكلام ما اتقاسوش في التقييم النصي ده.')}
      </div>

      {result.blockers?.length > 0 && (
        <Section title={T(lang, 'Deine größten Blocker', 'أكبر الحاجات اللي بتوقفك')} color="#f87171">
          {result.blockers.map((b, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, color: '#fca5a5', fontWeight: 700 }}>{b.rule}</div>
              <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.5, marginTop: 2 }}>{T(lang, b.explanation_de, b.explanation_ar)}</div>
              {b.example_from_their_own_answer && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontStyle: 'italic', overflowWrap: 'anywhere' }}>„{b.example_from_their_own_answer}"</div>
              )}
            </div>
          ))}
        </Section>
      )}

      {result.strengths?.length > 0 && (
        <Section title={T(lang, 'Deine Stärken', 'نقط قوتك')} color="var(--accent)">
          {result.strengths.map((s, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--accent-2)', marginBottom: 4, lineHeight: 1.5 }}>✓ {T(lang, s.de, s.ar || s.de)}</div>
          ))}
        </Section>
      )}

      {(result.recommendedFocus?.de || result.recommendedFocus?.ar) && (
        <Section title={T(lang, 'Fang hier an', 'ابدأ من هنا')} color="var(--accent)">
          <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.55 }}>{T(lang, result.recommendedFocus.de, result.recommendedFocus.ar)}</div>
        </Section>
      )}

      {/* Don't dead-end on "close" — carry the student straight into their first interview (the
          named "Fang hier an" turned into an actual action). Falls back to close if no handler. */}
      <button onClick={onStartInterview || onGoPricing || onClose} style={{ ...primaryBtn, marginTop: 18 }}>
        {onStartInterview ? T(lang, 'Erstes Interview starten', 'ابدأ أول إنترفيو') : T(lang, 'Weiter', 'تمام')} ▸
      </button>
    </div>
  );
}

function Section({ title, color, children }) {
  return (
    <div style={{ borderRadius: 10, padding: '11px 13px', marginBottom: 10, background: 'rgba(0,0,0,0.32)', border: `1px solid ${color}33` }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 9.5, letterSpacing: '0.12em', color, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// ── shared button styles ──
const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'var(--font-display)',
  fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid var(--accent)', color: '#04070d',
  background: 'linear-gradient(135deg,var(--accent-2),var(--accent))' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10, padding: '6px 10px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10.5, padding: '12px', minHeight: 44,
  borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
