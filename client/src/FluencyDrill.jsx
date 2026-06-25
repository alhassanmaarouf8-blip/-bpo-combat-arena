/**
 * FluencyDrill.jsx — the 4-3-2 spoken-fluency drill (PAID).
 *
 * The learner answers the SAME prompt three times in SHRINKING windows (90 → 60 → 45 s).
 * After round 3, the debrief compares the learner's OWN round-1 vs round-3 numbers.
 *
 * EVERY number shown is measured from the learner's own transcribed speech (server:
 * fluencyDrill.js) — there is NO model opinion, nothing generic. The verdict text below
 * branches purely on the real measured deltas: if the learner did NOT get faster, it says
 * so honestly instead of inventing praise. Grammar (if present) comes only from LanguageTool.
 *
 * Honest labelling: words-per-minute is the HEADLINE (robust). "Fülllaute" are detected from
 * the transcript and can be undercounted (speech-to-text cleans up "äh/ähm"), so they are
 * shown as a secondary signal and never overclaimed.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ClipRecorder } from './clipRecorder.js';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

export function FluencyDrill({ token, apiUrl, lang = 'de', level = 'a2-b1', onClose, onGoPricing }) {
  const [phase, setPhase]   = useState('loading'); // loading | ready | practice | scoring | between | done | error
  const [prompt, setPrompt] = useState(null);      // { id, de, ar }
  const [rounds, setRounds] = useState([90, 60, 45]);
  const [round, setRound]   = useState(0);          // 0-based index into rounds
  const [results, setRes]   = useState([]);         // per-round { transcript, metrics, grammar? }
  const [recording, setRec] = useState(false);
  const [seconds, setSec]   = useState(0);          // elapsed in current recording
  const [err, setErr]       = useState(null);

  const recRef   = useRef(null);
  const timerRef = useRef(null);
  const stopRef  = useRef(null);

  const blocked = useCallback(() => { onGoPricing?.(); onClose?.(); }, [onGoPricing, onClose]);

  const load = useCallback(async () => {
    setPhase('loading'); setErr(null); setRes([]); setRound(0);
    try {
      const r = await fetch(`${apiUrl}/api/fluency?level=${encodeURIComponent(level)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok || !d.prompt) throw new Error('load_failed');
      setPrompt(d.prompt);
      setRounds(Array.isArray(d.rounds) && d.rounds.length === 3 ? d.rounds : [90, 60, 45]);
      setPhase('ready');
    } catch {
      setErr({ de: 'Konnte die Übung nicht laden. Bitte erneut versuchen.', ar: 'مقدرناش نحمّل التمرين. حاول تاني.' });
      setPhase('error');
    }
  }, [apiUrl, token, level, blocked]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => {
    clearInterval(timerRef.current); clearTimeout(stopRef.current);
    recRef.current?.stop?.().catch(() => {});
  }, []);

  const limit = rounds[round] ?? 60;
  const remaining = Math.max(0, limit - seconds);

  const startRec = async () => {
    setErr(null);
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
    setPhase('practice'); setRec(true); setSec(0);
    timerRef.current = setInterval(() => setSec((x) => x + 1), 1000);
    stopRef.current  = setTimeout(() => stopRec(), limit * 1000);
  };

  const stopRec = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    clearInterval(timerRef.current); clearTimeout(stopRef.current);
    setRec(false);

    let clip;
    try { clip = await rec.stop(); }
    catch { setErr({ de: 'Aufnahme fehlgeschlagen. Bitte erneut.', ar: 'فشل التسجيل. جرّب تاني.' }); setPhase('ready'); return; }

    if (!clip?.blob || clip.blob.size < 1200) {
      setErr({ de: 'Nichts aufgenommen — bitte sprich deine Antwort.', ar: 'مفيش صوت اتسجّل — قول إجابتك من فضلك.' });
      setPhase('ready'); return;
    }

    setPhase('scoring');
    const isLast = round === rounds.length - 1;
    try {
      const r = await fetch(`${apiUrl}/api/fluency/score?id=${prompt.id}&round=${round + 1}&ms=${clip.durationMs}&level=${encodeURIComponent(level)}&grammar=${isLast ? 1 : 0}`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` }, body: clip.blob,
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'fluency_failed');
      if (d.retry || !d.metrics) {
        setErr({ de: 'Nichts erkannt — sprich bitte etwas lauter und länger.', ar: 'مفيش كلام اتسمع — اتكلم بصوت أعلى وأطول شوية.' });
        setPhase('ready'); return;
      }
      const next = [...results, d];
      setRes(next);
      setPhase(isLast ? 'done' : 'between');
    } catch (e) {
      setErr(e.message === 'no_api_key'
        ? { de: 'Dienst gerade nicht verfügbar. Bitte später.', ar: 'الخدمة مش متاحة دلوقتي. جرّب بعدين.' }
        : { de: 'Konnte die Aufnahme nicht verarbeiten. Bitte erneut.', ar: 'مقدرناش نعالج الصوت. سجّل تاني.' });
      setPhase('ready');
    }
  };

  const nextRound = () => { setRound((x) => x + 1); setSec(0); setErr(null); setPhase('ready'); };

  // ── shells (match the Shadowing/Assessment screens) ──
  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, #0a1626 0%, #050a12 55%, #020409 100%)',
      color: '#e2e8f0', padding: '20px 16px 32px', boxSizing: 'border-box', animation: 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#f59e0b' }}>
        ⚡ FLOW-DRILL · سرعة الكلام
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
      <button onClick={load} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Erneut versuchen', 'حاول تاني')}</button>
    </div>
  </>);

  if (phase === 'done') return shell(<>{header}<Debrief lang={lang} prompt={prompt} rounds={rounds} results={results} onAgain={load} onClose={onClose} /></>);

  // The shared prompt card + round tracker (shown across ready/practice/scoring/between).
  const promptCard = (
    <>
      <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'Orbitron, monospace', letterSpacing: '0.1em', marginBottom: 8 }}>
        {T(lang, 'RUNDE', 'جولة')} {round + 1} / {rounds.length} · {T(lang, `${limit} Sek.`, `${limit} ثانية`)}
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
        {rounds.map((sec, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
            background: i < round ? '#f59e0b' : i === round ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.08)' }} />
        ))}
      </div>
      <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(245,158,11,0.25)' }}>
        <div style={{ fontSize: 9, color: '#f59e0b', letterSpacing: '0.12em', marginBottom: 6 }}>
          {T(lang, 'DEINE FRAGE — DREIMAL, JEDES MAL SCHNELLER', 'سؤالك — تلت مرات، كل مرة أسرع')}
        </div>
        <div style={{ fontSize: 16, color: '#f8fafc', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{prompt?.de}</div>
        <div dir="rtl" style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 7, lineHeight: 1.6 }}>{prompt?.ar}</div>
      </div>
    </>
  );

  if (phase === 'ready') return shell(<>
    {header}
    {promptCard}
    {round === 0 && (
      <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', fontSize: 11.5, color: '#fcd34d', lineHeight: 1.6 }}>
        {T(lang,
          'Beantworte dieselbe Frage dreimal. Jede Runde hast du weniger Zeit — das trainiert dein Sprechtempo. Am Ende vergleichen wir Runde 1 mit Runde 3 mit deinen echten Zahlen.',
          'جاوب على نفس السؤال تلت مرات. كل جولة وقتك أقل — ده بيدرّب سرعة كلامك. في الآخر بنقارن الجولة 1 بالجولة 3 بأرقامك الحقيقية.')}
      </div>
    )}
    {err && <ErrBox err={err} />}
    <div style={{ marginTop: 16, textAlign: 'center' }}>
      <button onClick={startRec} style={{ ...primaryBtn, fontSize: 14 }}>
        ● {T(lang, `Runde ${round + 1} aufnehmen`, `سجّل الجولة ${round + 1}`)}
      </button>
      <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
        {T(lang, `Sprich frei bis zu ${limit} Sekunden.`, `اتكلم بحرية لحد ${limit} ثانية.`)}
      </div>
    </div>
  </>);

  if (phase === 'practice') return shell(<>
    {header}
    {promptCard}
    <div style={{ marginTop: 18, textAlign: 'center' }}>
      <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 34, color: remaining <= 10 ? '#ef4444' : '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>
        00:{String(remaining).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 14 }}>{T(lang, 'verbleibend', 'الوقت المتبقي')}</div>
      <button onClick={stopRec} style={{ ...primaryBtn, background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}>
        ⏹ {T(lang, 'Fertig', 'خلصت')}
      </button>
    </div>
  </>);

  if (phase === 'scoring') return shell(<>{header}{promptCard}
    <div style={{ color: '#94a3b8', fontSize: 13, padding: 20, textAlign: 'center' }}>⏳ {T(lang, 'Wird gemessen…', 'بنقيس…')}</div>
  </>);

  // between rounds: show this round's quick numbers + push to the next, harder round.
  if (phase === 'between') {
    const m = results[results.length - 1]?.metrics || {};
    return shell(<>
      {header}
      {promptCard}
      <div style={{ marginTop: 14, padding: '13px', borderRadius: 11, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)' }}>
        <div style={{ fontSize: 9, color: '#f59e0b', letterSpacing: '0.12em', marginBottom: 8 }}>
          {T(lang, `RUNDE ${round + 1} — DEINE ZAHLEN`, `الجولة ${round + 1} — أرقامك`)}
        </div>
        <StatRow lang={lang} m={m} />
      </div>
      {err && <ErrBox err={err} />}
      <button onClick={nextRound} style={{ ...primaryBtn, marginTop: 16 }}>
        {T(lang, `Runde ${round + 2} — schneller ▸`, `الجولة ${round + 2} — أسرع ▸`)}
      </button>
      <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, textAlign: 'center', lineHeight: 1.5 }}>
        {T(lang, 'Gleiche Frage, weniger Zeit. Versuch flüssiger zu bleiben.', 'نفس السؤال، وقت أقل. حاول تفضل أكثر سلاسة.')}
      </div>
    </>);
  }

  return null;
}

// ── Deterministic round-1 vs round-3 debrief — built ONLY from measured numbers ──
function Debrief({ lang, prompt, rounds, results, onAgain, onClose }) {
  const r1 = results[0]?.metrics || {};
  const rL = results[results.length - 1]?.metrics || {};
  const grammar = (results[results.length - 1]?.grammar) || [];

  // Speech-rate verdict — the headline. Branches on the REAL delta; never invents a win.
  let wpmLine, wpmGood = false;
  if (r1.wpm > 0 && rL.wpm > r1.wpm) {
    const pct = Math.round(((rL.wpm - r1.wpm) / r1.wpm) * 100);
    wpmGood = true;
    wpmLine = T(lang,
      `Du sprichst jetzt ${pct}% schneller über dasselbe Thema: ${r1.wpm} → ${rL.wpm} Wörter/Minute.`,
      `بقيت بتتكلم أسرع ${pct}% عن نفس الموضوع: ${r1.wpm} ← ${rL.wpm} كلمة/دقيقة.`);
  } else if (rL.wpm > 0) {
    wpmLine = T(lang,
      `Dein Tempo blieb diesmal gleich oder ruhiger (${r1.wpm} → ${rL.wpm} W/Min, nur Sprechzeit gezählt). Das ist KEIN Rückschritt — wenn du langsamer wurdest, um klarer und verständlicher zu sprechen, ist das für ein echtes Gespräch sogar besser. Tempo ist nur eines von mehreren Zielen.`,
      `سرعتك فضلت زي ما هي أو أهدأ المرة دي (${r1.wpm} ← ${rL.wpm} كلمة/دقيقة، وقت الكلام بس). ده مش تراجع — لو بطّأت علشان تتكلم أوضح، ده أحسن لمكالمة حقيقية. السرعة هدف من كذا هدف.`);
  } else {
    wpmLine = T(lang, 'Wir konnten dein Tempo nicht messen — versuch es mit einer längeren Antwort erneut.',
                      'مقدرناش نقيس سرعتك — جرّب تاني بإجابة أطول.');
  }

  // Filler verdict — honest, secondary, never overclaimed.
  let fillerLine = null;
  if (r1.fillers > 0 && rL.fillers < r1.fillers) {
    fillerLine = T(lang, `Weniger Zögern: ${r1.fillers} → ${rL.fillers} erkannte Fülllaute (äh/ähm).`,
                         `تردد أقل: ${r1.fillers} ← ${rL.fillers} من أصوات التردد (äh/ähm).`);
  } else if (r1.fillers === 0 && rL.fillers === 0) {
    fillerLine = T(lang, 'Keine Fülllaute erkannt — saubere Delivery.', 'مفيش أصوات تردد — أداء نظيف.');
  } else if (rL.fillers > r1.fillers) {
    fillerLine = T(lang, `Mehr Fülllaute in Runde 3 (${r1.fillers} → ${rL.fillers}) — unter Zeitdruck normal. Lieber eine kurze Pause als ein „äh".`,
                         `أصوات تردد أكتر في الجولة 3 (${r1.fillers} ← ${rL.fillers}) — طبيعي تحت ضغط الوقت. وقفة قصيرة أحسن من „äh".`);
  }

  return (
    <>
      <div style={{ textAlign: 'center', padding: '6px 0 14px' }}>
        <div style={{ fontSize: 38 }}>{wpmGood ? '🚀' : '✅'}</div>
        <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginTop: 6 }}>{T(lang, 'Drei Runden geschafft', 'خلّصت تلت جولات')}</div>
      </div>

      {/* Headline: round 1 vs round 3, side by side, from the learner's real numbers */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <RoundCard lang={lang} label={T(lang, 'RUNDE 1', 'جولة 1')} m={r1} dim />
        <div style={{ alignSelf: 'center', color: '#f59e0b', fontSize: 20 }}>→</div>
        <RoundCard lang={lang} label={T(lang, 'RUNDE 3', 'جولة 3')} m={rL} />
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 11, background: wpmGood ? 'rgba(34,197,94,0.08)' : 'rgba(56,189,248,0.07)',
        border: `1px solid ${wpmGood ? 'rgba(34,197,94,0.35)' : 'rgba(56,189,248,0.3)'}` }}>
        <div style={{ fontSize: 13.5, color: '#f1f5f9', lineHeight: 1.6 }}>{wpmLine}</div>
        {fillerLine && <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6, marginTop: 8 }}>{fillerLine}</div>}
      </div>

      {/* Authoritative grammar — LanguageTool only. Clearly separated from the fluency win. */}
      {grammar.length > 0 && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 11, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(148,163,184,0.25)' }}>
          <div style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.12em', marginBottom: 8 }}>
            {T(lang, 'GRAMMATIK AUS RUNDE 3 (separat üben)', 'نحو من الجولة 3 (اتدرّب عليه لوحده)')}
          </div>
          {grammar.slice(0, 3).map((g, i) => {
            const ex = (g.summaryExamples || [])[0];
            return (
              <div key={i} style={{ marginBottom: i < Math.min(3, grammar.length) - 1 ? 10 : 0 }}>
                <div style={{ fontSize: 12.5, color: '#e2e8f0', fontWeight: 600 }}>{g.rule}{g.count > 1 ? ` ·${g.count}×` : ''}</div>
                {ex && (
                  <div style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                    <span style={{ color: '#f87171', textDecoration: 'line-through' }}>{ex.wrongFragment || ex.wrong}</span>
                    <span style={{ color: '#64748b' }}> → </span>
                    <span style={{ color: '#4ade80' }}>{ex.rightFragment || ex.right}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 9.5, color: '#64748b', marginTop: 12, lineHeight: 1.6 }}>
        {T(lang,
          'So gemessen: Wörter/Minute aus deiner reinen SPRECHZEIT (Stille wird abgezogen) — nicht aus der Aufnahmedauer. Fülllaute werden aus dem Transkript erkannt und können unterschätzt sein. Grammatik kommt von LanguageTool — nichts wird erfunden.',
          'إزاي اتقاس: الكلمات/دقيقة من وقت كلامك الفعلي (السكوت بيتشال) — مش من مدة التسجيل. أصوات التردد بتتعرف من النص وممكن تكون أقل من الحقيقة. النحو من LanguageTool — مفيش حاجة بتتألّف.')}
      </div>

      <button onClick={onAgain} style={{ ...primaryBtn, marginTop: 16 }}>{T(lang, 'Neue Frage ▸', 'سؤال جديد ▸')}</button>
      <button onClick={onClose} style={{ ...ghostBtnWide, marginTop: 10, width: '100%' }}>{T(lang, 'Fertig', 'تمام')}</button>
    </>
  );
}

function RoundCard({ lang, label, m, dim }) {
  return (
    <div style={{ flex: 1, padding: '12px 10px', borderRadius: 11, textAlign: 'center',
      background: dim ? 'rgba(255,255,255,0.03)' : 'rgba(245,158,11,0.1)',
      border: `1px solid ${dim ? 'rgba(148,163,184,0.2)' : 'rgba(245,158,11,0.45)'}` }}>
      <div style={{ fontSize: 8.5, color: dim ? '#94a3b8' : '#f59e0b', letterSpacing: '0.12em' }}>{label}</div>
      <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 26, color: dim ? '#cbd5e1' : '#fbbf24', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{m.wpm ?? 0}</div>
      <div style={{ fontSize: 8.5, color: '#64748b' }}>{T(lang, 'W/Min', 'كلمة/د')}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>{m.words ?? 0} {T(lang, 'Wörter', 'كلمة')} · {m.fillers ?? 0} {T(lang, 'äh', 'تردد')}</div>
    </div>
  );
}

function StatRow({ lang, m }) {
  const cell = (val, label) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 22, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {cell(m.wpm ?? 0, T(lang, 'W/Min', 'كلمة/د'))}
      {cell(m.words ?? 0, T(lang, 'Wörter', 'كلمة'))}
      {cell(m.fillers ?? 0, T(lang, 'Fülllaute', 'تردد'))}
    </div>
  );
}

function ErrBox({ err }) {
  return (
    <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, color: '#fca5a5' }}>
      {err.de}<br /><span dir="rtl">{err.ar}</span>
    </div>
  );
}

// ── shared button styles (match Shadowing) ──
const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'Orbitron, monospace',
  fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid #f59e0b', color: '#04070d',
  background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10, padding: '6px 10px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10.5, padding: '12px', minHeight: 44,
  borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
