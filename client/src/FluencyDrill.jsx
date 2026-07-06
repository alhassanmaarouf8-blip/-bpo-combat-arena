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
import { playNative } from './nativeVoice.js';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

export function FluencyDrill({ token, apiUrl, lang = 'de', level = 'a2-b1', onClose, onGoPricing, why = null }){
  const [mode, setMode]     = useState('432');      // '432' (classic) | 'chunks' (Blitz-Formeln)
  const [phase, setPhase]   = useState('loading'); // loading | ready | practice | scoring | between | done | error
  const [prompt, setPrompt] = useState(null);      // { id, de, ar }
  const [focus, setFocus]   = useState(null);      // the student's #1 weak rule to focus on
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
      const r = await fetch(`${apiUrl}/api/fluency?level=${encodeURIComponent(level)}&t=${Date.now()}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok || !d.prompt) throw new Error('load_failed');
      setPrompt(d.prompt);
      setFocus(d.focus || null);
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
      // Send the prompt the learner is answering so the server can measure TOPIC RELEVANCY
      // (did the answer engage the question's key words?) — the "relevancy" half of the matrix.
      const promptQ = encodeURIComponent(String(prompt?.de || '').slice(0, 400));
      const r = await fetch(`${apiUrl}/api/fluency/score?id=${prompt.id}&round=${round + 1}&ms=${clip.durationMs}&level=${encodeURIComponent(level)}&grammar=${isLast ? 1 : 0}&prompt=${promptQ}`, {
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
      if (isLast) {
        // Feed the brain: a completed 4-3-2 set is fluency prep (the rounds reported NOTHING
        // before, so the brain couldn't see that its flow-drill prescription was followed).
        try { fetch(`${apiUrl}/api/drill-event`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ drill: 'flow-drill', voicedMs: clip.durationMs }) }).catch(() => {}); } catch { /* fire-and-forget */ }
      }
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
    <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: 'var(--action)' }}>
        ⚡ FLOW-DRILL · سرعة الكلام
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

  // Blitz-Formeln mode is its own flow (own fetch + state machine); the 4-3-2 state stays
  // untouched behind it, so switching back resumes cleanly.
  if (mode === 'chunks') {
    return (
      <ChunkMode token={token} apiUrl={apiUrl} lang={lang} shell={shell}
        onBack={() => setMode('432')} onClose={onClose} blocked={blocked} />
    );
  }

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
      <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-display)', letterSpacing: '0.1em', marginBottom: 8 }}>
        {T(lang, 'RUNDE', 'جولة')} {round + 1} / {rounds.length} · {T(lang, `${limit} Sek.`, `${limit} ثانية`)}
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
        {rounds.map((sec, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
            background: i < round ? 'var(--action)' : i === round ? 'rgba(249,115,22,0.5)' : 'rgba(255,255,255,0.08)' }} />
        ))}
      </div>
      <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(249,115,22,0.25)' }}>
        <div style={{ fontSize: 9, color: 'var(--action)', letterSpacing: '0.12em', marginBottom: 6 }}>
          {T(lang, 'DEINE FRAGE — DREIMAL, JEDES MAL SCHNELLER', 'سؤالك — تلت مرات، كل مرة أسرع')}
        </div>
        <div style={{ fontSize: 16, color: '#f8fafc', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{prompt?.de}</div>
        <div dir="auto" style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 7, lineHeight: 1.6 }}>{prompt?.ar}</div>
        {focus && (
          <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid rgba(249,115,22,0.2)',
            ...(lang === 'ar' ? { direction: 'rtl', textAlign: 'right' } : {}) }}>
            <span style={{ fontSize: 11.5, color: 'var(--action)', fontWeight: 700 }}>
              {T(lang, `🎯 Achte diesmal besonders auf: ${focus}`, `🎯 ركّز المرة دي بالذات على: ${focus}`)}
            </span>
          </div>
        )}
      </div>
    </>
  );

  if (phase === 'ready') return shell(<>
    {header}
    {promptCard}
    {round === 0 && (
      <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', fontSize: 11.5, color: 'var(--action)', lineHeight: 1.6 }}>
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
    {round === 0 && results.length === 0 && (
      <button onClick={() => setMode('chunks')} style={{ ...ghostBtnWide, width: '100%', marginTop: 14, textAlign: 'left', lineHeight: 1.5 }}>
        <span style={{ color: 'var(--accent-2)', fontWeight: 700 }}>⚡ Blitz-Formeln</span>
        <span style={{ color: '#94a3b8' }}> — feste Callcenter-Formeln so lange üben, bis sie ohne Nachdenken kommen. Verpasste Formeln kommen automatisch wieder. ▸</span>
      </button>
    )}
  </>);

  if (phase === 'practice') return shell(<>
    {header}
    {promptCard}
    <div style={{ marginTop: 18, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, color: remaining <= 10 ? '#ef4444' : 'var(--action)', fontVariantNumeric: 'tabular-nums' }}>
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
      <div style={{ marginTop: 14, padding: '13px', borderRadius: 11, background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.3)' }}>
        <div style={{ fontSize: 9, color: 'var(--action)', letterSpacing: '0.12em', marginBottom: 8 }}>
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

  // ── Three additional deterministic signals (owner: "is pure WPM enough?") — same doctrine as
  // above: only speak when the underlying data is reliable enough to mean something, German-only
  // (OWNER-AR slots — not authored here), never overclaiming beyond what the number supports. ──

  // PAUSE/CONTINUITY: voiced-time share of the recording. A learner who freezes silently instead
  // of saying "äh" looks IDENTICAL to a fluent speaker under wpm+fillers alone — this catches it.
  // Gated on the SAME ≥800ms voiced-detection reliability threshold the server's own wpm calc uses.
  let pauseLine = null;
  if ((r1.voicedMs || 0) >= 800 && (rL.voicedMs || 0) >= 800 && r1.durationMs > 0 && rL.durationMs > 0) {
    const pct1 = Math.round((r1.voicedMs / r1.durationMs) * 100);
    const pctL = Math.round((rL.voicedMs / rL.durationMs) * 100);
    if (pctL > pct1 + 5) {
      pauseLine = `Weniger stille Denkpausen: ${pct1}% → ${pctL}% der Aufnahme warst du wirklich am Sprechen.`;
    } else if (pctL < pct1 - 5) {
      pauseLine = `Runde 3 hatte mehr stille Pausen (${pct1}% → ${pctL}% Sprechanteil) — eine kurze Pause zum Nachdenken ist normal, achte nur darauf, den Faden zu halten.`;
    }
  }

  // VOCABULARY under pressure: did the speed-up come from genuinely varied language, or from
  // repeating the same few safe words? The 4-3-2 method's real claim is speed WITHOUT that trade.
  let vocabLine = null;
  if (r1.words >= 15 && rL.words >= 15) {
    const div1 = Math.round((r1.uniqueWords / r1.words) * 100);
    const divL = Math.round((rL.uniqueWords / rL.words) * 100);
    if (wpmGood && divL < div1 - 12) {
      vocabLine = `Achtung: Ein Teil des Tempo-Gewinns kam durch WIEDERHOLUNG derselben Wörter (Wortvielfalt ${div1}% → ${divL}%). Versuch beim nächsten Mal, auch unter Zeitdruck neue Wörter zu nutzen.`;
    } else if (divL >= div1) {
      vocabLine = `Deine Wortvielfalt blieb auch unter Zeitdruck stabil (${div1}% → ${divL}%) — du bist nicht in Wiederholungen verfallen.`;
    }
  }

  // STRUCTURAL COMPLEXITY: subordinate-clause rate (weil/dass/wenn…) — the same deterministic
  // signal hireReadiness.js uses, reused here (no LLM, no new judgment). A rushed answer often
  // flattens into short disconnected fragments instead of a connected story.
  let complexityLine = null;
  if (r1.subClauseRate != null && rL.subClauseRate != null) {
    const c1 = Math.round(r1.subClauseRate * 100), cL = Math.round(rL.subClauseRate * 100);
    if (cL > c1 + 10) {
      complexityLine = `Deine Sätze wurden komplexer: mehr verbundene Nebensätze (weil/dass/wenn) unter Zeitdruck (${c1}% → ${cL}%).`;
    } else if (cL < c1 - 15) {
      complexityLine = `Unter Zeitdruck wurden deine Sätze einfacher (${c1}% → ${cL}% Nebensätze) — normal, wenn Tempo gerade im Fokus steht.`;
    }
  }

  // RELEVANCY — the owner's core point: speed means nothing if you didn't answer the QUESTION.
  // Read from the final round (where it matters most). Honest framing: praise clear on-topic
  // coverage; warn GENTLY only when a substantial answer touched almost none of the question's
  // key words; stay SILENT when null (too thin to judge). Never a hard "off-topic" verdict.
  let relevancyLine = null, relevancyWarn = false;
  if (typeof rL.relevancy === 'number') {
    const pct = Math.round(rL.relevancy * 100);
    if (rL.relevancy >= 0.3) {
      relevancyLine = `Beim Thema geblieben: Du bist auf die Kernbegriffe der Frage eingegangen (${pct}% abgedeckt).`;
    } else if (rL.relevancy < 0.15 && (rL.words || 0) >= 20) {
      relevancyWarn = true;
      relevancyLine = `Achtung — nur wenige Wörter aus der Frage kamen in deiner Antwort vor. Schnell und flüssig zu sprechen zählt nur, wenn du auch WIRKLICH die gestellte Frage beantwortest. Lies die Frage nochmal und geh direkt darauf ein.`;
    }
  }

  // ACCURACY — surface the grammar count as an explicit matrix cell (the fix stays in the grammar
  // card below; here it's just the score, so "Tempo / Genauigkeit / Relevanz" reads as one matrix).
  const grammarErrCount = grammar.reduce((n, g) => n + (g.count || (g.summaryExamples || []).length || 1), 0);

  return (
    <>
      <div style={{ textAlign: 'center', padding: '6px 0 14px' }}>
        <div style={{ fontSize: 38 }}>{wpmGood ? '🚀' : '✅'}</div>
        <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginTop: 6 }}>{T(lang, 'Drei Runden geschafft', 'خلّصت تلت جولات')}</div>
      </div>

      {/* Headline: round 1 vs round 3, side by side, from the learner's real numbers */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <RoundCard lang={lang} label={T(lang, 'RUNDE 1', 'جولة 1')} m={r1} dim />
        <div style={{ alignSelf: 'center', color: 'var(--action)', fontSize: 20 }}>→</div>
        <RoundCard lang={lang} label={T(lang, 'RUNDE 3', 'جولة 3')} m={rL} />
      </div>

      {/* THE MATRIX (owner: "not just speed — accuracy AND relevancy to the topic"). Three cells so
          the learner sees at a glance that speed is only one of three axes. Each shows a dash when
          not measurable rather than a fabricated value. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <MatrixCell label={T(lang, 'TEMPO', 'السرعة')} value={`${rL.wpm ?? 0}`} unit={T(lang, 'W/Min', 'ك/د')} />
        <MatrixCell label={T(lang, 'GENAUIGKEIT', 'الدقة')}
          value={typeof grammarErrCount === 'number' && grammar.length >= 0 ? `${grammarErrCount}` : '—'}
          unit={T(lang, 'Fehler', 'أخطاء')} good={grammarErrCount === 0} />
        <MatrixCell label={T(lang, 'RELEVANZ', 'الصلة')}
          value={typeof rL.relevancy === 'number' ? `${Math.round(rL.relevancy * 100)}%` : '—'}
          unit={T(lang, 'zum Thema', 'للموضوع')} good={typeof rL.relevancy === 'number' && rL.relevancy >= 0.3}
          warn={relevancyWarn} />
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 11, background: wpmGood ? 'rgba(59,130,246,0.08)' : 'rgba(96,165,250,0.07)',
        border: `1px solid ${wpmGood ? 'rgba(59,130,246,0.35)' : 'rgba(96,165,250,0.3)'}` }}>
        <div style={{ fontSize: 13.5, color: '#f1f5f9', lineHeight: 1.6 }}>{wpmLine}</div>
        {fillerLine && <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6, marginTop: 8 }}>{fillerLine}</div>}
      </div>

      {relevancyLine && (
        <div style={{ marginTop: 8, padding: '10px 13px', borderRadius: 10,
          background: relevancyWarn ? 'rgba(249,115,22,0.08)' : 'rgba(59,130,246,0.07)',
          border: `1px solid ${relevancyWarn ? 'rgba(249,115,22,0.4)' : 'rgba(59,130,246,0.3)'}` }}>
          <div style={{ fontSize: 12.5, color: relevancyWarn ? 'var(--action-2)' : '#cbd5e1', lineHeight: 1.6 }}>{relevancyLine}</div>
        </div>
      )}

      {/* Three additional deterministic signals — beyond raw WPM (owner: "is that enough?").
          German-only (OWNER-AR slots, not authored here); each is its own small card so a missing
          signal (e.g. subClauseRate null on a short answer) never leaves an empty gap. */}
      {pauseLine && (
        <div style={{ marginTop: 8, padding: '10px 13px', borderRadius: 10, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.25)' }}>
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>{pauseLine}</div>
        </div>
      )}
      {vocabLine && (
        <div style={{ marginTop: 8, padding: '10px 13px', borderRadius: 10, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.25)' }}>
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>{vocabLine}</div>
        </div>
      )}
      {complexityLine && (
        <div style={{ marginTop: 8, padding: '10px 13px', borderRadius: 10, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.25)' }}>
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>{complexityLine}</div>
        </div>
      )}

      {/* Authoritative grammar — LanguageTool only. Clearly separated from the fluency win. */}
      {grammar.length > 0 && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 11, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(148,163,184,0.25)' }}>
          <div style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.12em', marginBottom: 8 }}>
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
                    <span style={{ color: 'var(--good)' }}>{ex.rightFragment || ex.right}</span>
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

// One cell of the Tempo / Genauigkeit / Relevanz matrix. `good` → green, `warn` → orange,
// otherwise neutral. A dash value stays neutral (not measurable this round).
function MatrixCell({ label, value, unit, good, warn }) {
  const color = warn ? 'var(--action)' : good ? 'var(--good)' : '#cbd5e1';
  const border = warn ? 'rgba(249,115,22,0.4)' : good ? 'rgba(59,130,246,0.35)' : 'rgba(148,163,184,0.2)';
  return (
    <div style={{ flex: 1, padding: '10px 8px', borderRadius: 10, textAlign: 'center',
      background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}` }}>
      <div style={{ fontSize: 8, color: '#64748b', letterSpacing: '0.1em', fontFamily: 'var(--font-display)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color, fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 8.5, color: '#64748b', marginTop: 1 }}>{unit}</div>
    </div>
  );
}

function RoundCard({ lang, label, m, dim }) {
  return (
    <div style={{ flex: 1, padding: '12px 10px', borderRadius: 11, textAlign: 'center',
      background: dim ? 'rgba(255,255,255,0.03)' : 'rgba(249,115,22,0.1)',
      border: `1px solid ${dim ? 'rgba(148,163,184,0.2)' : 'rgba(249,115,22,0.45)'}` }}>
      <div style={{ fontSize: 8.5, color: dim ? '#94a3b8' : 'var(--action)', letterSpacing: '0.12em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: dim ? '#cbd5e1' : 'var(--action)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{m.wpm ?? 0}</div>
      <div style={{ fontSize: 8.5, color: '#64748b' }}>{T(lang, 'W/Min', 'كلمة/د')}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>{m.words ?? 0} {T(lang, 'Wörter', 'كلمة')} · {m.fillers ?? 0} {T(lang, 'äh', 'تردد')}</div>
    </div>
  );
}

function StatRow({ lang, m }) {
  const cell = (val, label) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--action)', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
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

// ═══════════════════════════════════════════════════════════════════════════════════
// BLITZ-FORMELN — formulaic-chunk automaticity (ROADMAP #2).
// Per item: PRIME (see + hear the formula once) → FIRE (formula hidden, the situation cue
// fires, say it from memory — reaction time measured from mic-open to first voiced frame)
// → verdict. Every number shown is measured (match ratio server-side, latency client-side);
// misses go on the 1-3-7-14-30-day SRS schedule server-side.
// ═══════════════════════════════════════════════════════════════════════════════════
function ChunkMode({ token, apiUrl, lang, shell, onBack, onClose, blocked }) {
  const [phase, setPhase]   = useState('loading');  // loading | prime | fire | scoring | verdict | done | error
  const [items, setItems]   = useState([]);
  const [idx, setIdx]       = useState(0);
  const [results, setRes]   = useState([]);          // per item: { hit, verdict, latencyMs, transcript, nextDueDays }
  const [err, setErr]       = useState(null);

  const recRef      = useRef(null);
  const voiceStopRef = useRef(null);
  const resultsRef  = useRef([]);       // mirror of `results` — timers fire from old closures
  const timersRef   = useRef([]);       // every pending timeout/interval, cleared on any transition
  const firedRef    = useRef(false);    // guards the auto prime→fire transition per item
  const startTRef   = useRef(0);        // mic-open timestamp (latency zero point)
  const onsetRef    = useRef(0);        // first voiced frame (ms after mic-open)
  const lastLoudRef = useRef(0);

  const clearTimers = () => { for (const t of timersRef.current) { clearTimeout(t); clearInterval(t); } timersRef.current = []; };
  const arm = (fn, ms) => { const t = setTimeout(fn, ms); timersRef.current.push(t); return t; };

  const load = useCallback(async () => {
    setPhase('loading'); setErr(null); setRes([]); resultsRef.current = []; setIdx(0); firedRef.current = false;
    try {
      const r = await fetch(`${apiUrl}/api/fluency/chunks?count=8&t=${Date.now()}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.items) || !d.items.length) throw new Error('load_failed');
      setItems(d.items);
      setPhase('prime');
    } catch {
      setErr({ de: 'Konnte die Übung nicht laden. Bitte erneut versuchen.', ar: 'مقدرناش نحمّل التمرين. حاول تاني.' });
      setPhase('error');
    }
  }, [apiUrl, token, blocked]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => {   // unmount: silence the voice, close the mic, drop every timer
    clearTimers();
    try { voiceStopRef.current?.(); } catch { /* already stopped */ }
    recRef.current?.stop?.().catch(() => {});
  }, []);

  const item = items[idx];

  // PRIME: play the formula once in the native voice; when it ends, fire automatically.
  useEffect(() => {
    if (phase !== 'prime' || !item) return;
    firedRef.current = false;
    voiceStopRef.current = playNative({
      apiUrl, token, text: item.chunk,
      onEnd: () => arm(() => { if (!firedRef.current) startFire(); }, 500),
    });
    return () => { try { voiceStopRef.current?.(); } catch { /* ignore */ } };
  }, [phase, idx]);   // eslint-disable-line react-hooks/exhaustive-deps

  const startFire = async () => {
    if (firedRef.current) return;
    firedRef.current = true;
    clearTimers();
    try { voiceStopRef.current?.(); } catch { /* ignore */ }
    setErr(null);
    onsetRef.current = 0; lastLoudRef.current = 0;
    const rec = new ClipRecorder({
      onVolume: (v) => {
        const now = performance.now();
        if (v >= 0.05) {
          lastLoudRef.current = now;
          if (!onsetRef.current && startTRef.current) onsetRef.current = Math.round(now - startTRef.current);
        }
      },
    });
    try { await rec.start(); }
    catch (e) {
      firedRef.current = false;
      setErr(e?.code === 'MIC_DENIED'
        ? { de: 'Mikrofon-Zugriff wurde blockiert. Bitte im Browser erlauben.', ar: 'الوصول للمايك متمنوع. اسمح بيه من المتصفح.' }
        : { de: 'Mikrofon konnte nicht gestartet werden.', ar: 'مقدرناش نشغّل المايك.' });
      return;
    }
    recRef.current = rec;
    startTRef.current = performance.now();
    setPhase('fire');
    // Rapid-fire feel: auto-stop ~1.3s after the learner falls silent (a formula is one breath),
    // with an 8s hard cap so a stuck mic can never hang the drill.
    const iv = setInterval(() => {
      if (onsetRef.current && performance.now() - lastLoudRef.current > 1300) stopFire();
    }, 200);
    timersRef.current.push(iv);
    arm(() => stopFire(), 8000);
  };

  const stopFire = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    clearTimers();

    let clip;
    try { clip = await rec.stop(); }
    catch { setErr({ de: 'Aufnahme fehlgeschlagen. Bitte erneut.', ar: 'فشل التسجيل. جرّب تاني.' }); setPhase('prime'); return; }
    if (!clip?.blob || clip.blob.size < 1200) {
      setErr({ de: 'Nichts aufgenommen — sprich die Formel laut.', ar: '' });
      firedRef.current = false; setPhase('prime'); return;
    }

    setPhase('scoring');
    try {
      const lat = onsetRef.current || 0;
      const r = await fetch(`${apiUrl}/api/fluency/chunks/score?id=${item.id}&ms=${clip.durationMs}&lat=${lat}`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` }, body: clip.blob,
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'chunks_failed');
      if (d.retry) {
        setErr({ de: 'Nichts erkannt — sprich bitte lauter.', ar: '' });
        firedRef.current = false; setPhase('prime'); return;
      }
      setRes((prev) => { const next = [...prev, { ...d, durationMs: clip.durationMs }]; resultsRef.current = next; return next; });
      setPhase('verdict');
      if (d.hit) arm(() => advance(), 1700);   // hits flow on their own; misses wait for the learner
    } catch (e) {
      setErr(e.message === 'no_api_key'
        ? { de: 'Dienst gerade nicht verfügbar. Bitte später.', ar: 'الخدمة مش متاحة دلوقتي. جرّب بعدين.' }
        : { de: 'Konnte die Aufnahme nicht verarbeiten. Bitte erneut.', ar: 'مقدرناش نعالج الصوت. سجّل تاني.' });
      firedRef.current = false; setPhase('prime');
    }
  };

  const advance = () => {
    clearTimers();
    if (idx + 1 >= items.length) { finish(); return; }
    setIdx((x) => x + 1);
    setErr(null);
    setPhase('prime');
  };

  const finish = () => {
    setPhase('done');
    // The drill reports its OUTCOME to the brain (one organism): majority-correct + spoken time.
    // Reads the ref, not state — this runs from a timer whose closure may predate the last result.
    try {
      const all = resultsRef.current;
      const hits = all.filter((r) => r.hit).length;
      const voicedMs = all.reduce((s, r) => s + (r.durationMs || 0), 0);
      fetch(`${apiUrl}/api/drill-event`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ drill: 'blitz-formeln', correct: hits >= Math.ceil(all.length / 2), voicedMs }),
      });
    } catch { /* fire-and-forget */ }
  };

  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: 'var(--action)' }}>
        ⚡ BLITZ-FORMELN
      </span>
      <span style={{ display: 'flex', gap: 8 }}>
        <button onClick={onBack} style={ghostBtn}>◂ 4-3-2</button>
        <button onClick={onClose} style={ghostBtn}>{T(lang, 'Schließen', 'إغلاق')} ✕</button>
      </span>
    </div>
  );

  const progress = items.length > 0 && (
    <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
      {items.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < results.length ? (results[i]?.hit ? 'var(--good)' : '#ef4444')
                    : i === idx ? 'rgba(249,115,22,0.5)' : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>
  );

  if (phase === 'loading') return shell(<>{header}<div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>…</div></>);

  if (phase === 'error') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '30px 0' }}>
      <div style={{ fontSize: 36 }}>⚠</div>
      <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.6, marginTop: 8 }}>{err?.de}{err?.ar ? <><br /><span dir="rtl">{err.ar}</span></> : null}</div>
      <button onClick={load} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Erneut versuchen', 'حاول تاني')}</button>
    </div>
  </>);

  if (phase === 'done') {
    const hits = results.filter((r) => r.hit).length;
    const autos = results.filter((r) => r.verdict === 'automatic').length;
    const hitLats = results.filter((r) => r.hit && r.latencyMs > 0).map((r) => r.latencyMs);
    const avgLat = hitLats.length ? Math.round(hitLats.reduce((a, b) => a + b, 0) / hitLats.length) : null;
    return shell(<>
      {header}
      <div style={{ textAlign: 'center', padding: '6px 0 14px' }}>
        <div style={{ fontSize: 38 }}>{hits === results.length ? '⚡' : '✅'}</div>
        <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginTop: 6 }}>Runde geschafft</div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <MatrixCell label="GETROFFEN" value={`${hits}/${results.length}`} unit="Formeln" good={hits === results.length} />
        <MatrixCell label="AUTOMATISCH" value={`${autos}`} unit="unter 1,5 s" good={autos > 0} />
        <MatrixCell label="REAKTION" value={avgLat != null ? `${(avgLat / 1000).toFixed(1)}s` : '—'} unit="im Schnitt" good={avgLat != null && avgLat <= 1500} />
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.3)' }}>
        <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6 }}>
          Getroffene Formeln kommen nach dem 1-3-7-14-30-Tage-Plan wieder; verpasste schon morgen.
          So wird aus Wissen ein Reflex — genau das, was am Telefon zählt.
        </div>
      </div>
      <button onClick={load} style={{ ...primaryBtn, marginTop: 16 }}>Neue Runde ▸</button>
      <button onClick={onClose} style={{ ...ghostBtnWide, marginTop: 10, width: '100%' }}>{T(lang, 'Fertig', 'تمام')}</button>
    </>);
  }

  if (!item) return null;
  const last = results[results.length - 1];

  if (phase === 'prime') return shell(<>
    {header}
    {progress}
    {idx === 0 && results.length === 0 && (
      <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 9, background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', fontSize: 11.5, color: 'var(--action)', lineHeight: 1.6 }}>
        Profis rufen feste Formeln ohne Nachdenken ab. Hör die Formel einmal — dann kommt die Situation, und du sagst sie sofort aus dem Kopf.
      </div>
    )}
    <div style={{ padding: '16px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(96,165,250,0.3)' }}>
      <div style={{ fontSize: 9, color: 'var(--accent-2)', letterSpacing: '0.12em', marginBottom: 8 }}>MERK DIR DIE FORMEL</div>
      <div style={{ fontSize: 19, color: '#f8fafc', lineHeight: 1.55, fontWeight: 600, overflowWrap: 'anywhere' }}>{item.chunk}</div>
      {item.note_ar && <div dir="rtl" style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 7 }}>{item.note_ar}</div>}
    </div>
    {err && <ErrBox err={err} />}
    <div style={{ marginTop: 16, textAlign: 'center' }}>
      <button onClick={startFire} style={{ ...primaryBtn, fontSize: 14 }}>● Bereit — Situation zeigen</button>
      <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
        Nach dem Vorsprechen geht es automatisch los.
      </div>
    </div>
  </>);

  if (phase === 'fire') return shell(<>
    {header}
    {progress}
    <div style={{ padding: '16px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(249,115,22,0.35)' }}>
      <div style={{ fontSize: 9, color: 'var(--action)', letterSpacing: '0.12em', marginBottom: 8 }}>SITUATION — SAG DIE FORMEL. JETZT.</div>
      <div style={{ fontSize: 17, color: '#f8fafc', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{item.cue}</div>
    </div>
    <div style={{ marginTop: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 26, color: '#ef4444', animation: 'pulse 1.2s infinite' }}>●</div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>Aufnahme läuft — stoppt von selbst, wenn du fertig bist.</div>
      <button onClick={stopFire} style={{ ...ghostBtnWide, width: 'auto', padding: '10px 22px', marginTop: 12 }}>⏹ Fertig</button>
    </div>
  </>);

  if (phase === 'scoring') return shell(<>{header}{progress}
    <div style={{ color: '#94a3b8', fontSize: 13, padding: 30, textAlign: 'center' }}>⏳ Wird geprüft…</div>
  </>);

  if (phase === 'verdict' && last) {
    const v = last.verdict;
    const latS = last.latencyMs > 0 ? `${(last.latencyMs / 1000).toFixed(1)} s` : null;
    const title = v === 'automatic' ? `⚡ Automatisch!${latS ? ` (${latS})` : ''}`
                : v === 'ok'        ? `✓ Richtig${latS ? ` (${latS})` : ''}`
                : v === 'slow'      ? `✓ Richtig — aber langsam${latS ? ` (${latS})` : ''}. Ziel: unter 1,5 s.`
                : '✗ Das war nicht die Formel.';
    const good = last.hit;
    return shell(<>
      {header}
      {progress}
      <div style={{ padding: '16px 14px', borderRadius: 12, textAlign: 'center',
        background: good ? 'rgba(59,130,246,0.08)' : 'rgba(239,68,68,0.08)',
        border: `1px solid ${good ? 'rgba(59,130,246,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
        <div style={{ fontSize: 16, color: good ? 'var(--good)' : '#fca5a5', fontWeight: 700, lineHeight: 1.5 }}>{title}</div>
        {!good && (
          <div style={{ marginTop: 12, textAlign: 'left' }}>
            <div style={{ fontSize: 9, color: '#94a3b8', letterSpacing: '0.1em' }}>DIE FORMEL</div>
            <div style={{ fontSize: 15, color: 'var(--good)', lineHeight: 1.5, marginTop: 3 }}>{item.chunk}</div>
            {last.transcript && <>
              <div style={{ fontSize: 9, color: '#94a3b8', letterSpacing: '0.1em', marginTop: 10 }}>VERSTANDEN WURDE</div>
              <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginTop: 3 }}>{last.transcript}</div>
            </>}
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, lineHeight: 1.5 }}>
              Diese Formel kommt morgen wieder — bis sie sitzt.
            </div>
          </div>
        )}
      </div>
      <button onClick={advance} style={{ ...primaryBtn, marginTop: 16 }}>
        {idx + 1 >= items.length ? 'Ergebnis ▸' : 'Weiter ▸'}
      </button>
    </>);
  }

  return null;
}

// ── shared button styles (match Shadowing) ──
const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'var(--font-display)',
  fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid var(--action)', color: '#04070d',
  background: 'linear-gradient(135deg,var(--action),var(--action))' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10, padding: '6px 10px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10.5, padding: '12px', minHeight: 44,
  borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
