/**
 * PersonalStep.jsx — Phase 4: the screen behind "PERSÖNLICHEN SCHRITT ÖFFNEN".
 *
 * Bottleneck-Brief → the 3-stage transfer ladder (ERKENNEN → KONTROLLIERT SAGEN → TRANSFER),
 * every item with reps + the why, all grading server-side — completion unlocks the RE-INTERVIEW.
 * Mission framing, not a worksheet; bilingual DE + (owner/LLM) Egyptian Arabic; single orange
 * stays on the primary action per screen (design-system law).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { actionBtn, ghostBtn } from './ui/primitives.js';
import { ClipRecorder } from './clipRecorder.js';

const MIC_ERRORS = {
  MIC_DENIED:    { de: 'Mikrofon blockiert. Bitte erlauben.', ar: 'المايك متمنوع. اسمح بيه.' },
  MIC_NOT_FOUND: { de: 'Kein Mikrofon gefunden.', ar: 'مفيش مايك.' },
  DEFAULT:       { de: 'Mikrofon-Start fehlgeschlagen.', ar: 'مقدرناش نشغّل المايك.' },
};

const dim = { fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.5 };
const stageTitle = { fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--accent)' };
const card = { padding: '11px 13px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--line)', marginTop: 8 };

export default function PersonalStep({ token, apiUrl, lang = 'de', onClose, onStartInterview }) {
  const ar = lang === 'ar';
  const rtl = ar ? { direction: 'rtl', textAlign: 'right' } : null;
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('loading');   // loading | generating | ready | failed
  const [answered, setAnswered] = useState({});    // stage1 itemId → answer response
  const [speakRes, setSpeakRes] = useState({});    // stage2/3 itemId → speak response
  const [recItem, setRecItem] = useState(null);
  const [busyItem, setBusyItem] = useState(null);
  const [countLeft, setCountLeft] = useState(null);
  const [err, setErr] = useState(null);
  const recRef = useRef(null); const pollRef = useRef(null); const cdRef = useRef(null); const stopRef = useRef(null);

  const hdr = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/api/personal-step`, { headers: hdr });
      if (r.status === 404) { setPhase('failed'); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'failed');
      setData(d);
      if (d.status === 'generating') { setPhase('generating'); pollRef.current = setTimeout(load, 4000); }
      else if (d.status === 'failed') setPhase('failed');
      else setPhase('ready');
    } catch { setPhase('failed'); }
  }, [apiUrl, token]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); return () => { clearTimeout(pollRef.current); clearInterval(cdRef.current); clearTimeout(stopRef.current); recRef.current?.stop?.().catch(() => {}); }; }, [load]);

  const mergeReps = (resp, itemId) => setData((d) => {
    if (!d?.set) return d;
    const upd = (list) => list.map((i) => (i.id === itemId ? { ...i, repsDone: resp.repsDone ?? i.repsDone } : i));
    return { ...d, completed: resp.completed || d.completed, reinterviewUnlocked: resp.reinterviewUnlocked || d.reinterviewUnlocked,
      set: { ...d.set, stage1: upd(d.set.stage1), stage2: upd(d.set.stage2), stage3: upd(d.set.stage3) } };
  });

  const answer = async (item, choice) => {
    if (answered[item.id] || busyItem) return;
    setBusyItem(item.id); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/personal-step/answer`, {
        method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: data.sessionId, itemId: item.id, choice }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'failed');
      setAnswered((a) => ({ ...a, [item.id]: { ...d, chosen: choice } }));
      mergeReps(d, item.id);
    } catch { setErr({ de: 'Konnte nicht auswerten. Bitte erneut.', ar: 'مقدرناش نحلّل. حاول تاني.' }); }
    setBusyItem(null);
  };

  const regenerate = async () => {
    setBusyItem('regen'); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/personal-step/regenerate`, {
        method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: data.sessionId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'failed');
      setAnswered({}); setSpeakRes({});
      setData((prev) => ({ ...prev, status: d.status, set: d.set || prev.set }));
    } catch { setErr({ de: 'Konnte keinen neuen Block generieren — der Basis-Block bleibt.', ar: '' /* OWNER-AR slot */ }); }
    setBusyItem(null);
  };

  const startRec = async (item, maxSec) => {
    setErr(null); setSpeakRes((s) => ({ ...s, [item.id]: null }));
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); }
    catch (e) { setErr(MIC_ERRORS[e?.code] || MIC_ERRORS.DEFAULT); return; }
    recRef.current = rec; setRecItem(item.id);
    if (item.countdownS) {
      setCountLeft(item.countdownS);
      cdRef.current = setInterval(() => setCountLeft((x) => (x > 1 ? x - 1 : 0)), 1000);
    }
    stopRef.current = setTimeout(() => stopRec(item), (maxSec || 20) * 1000);
  };

  const stopRec = async (item) => {
    const rec = recRef.current; if (!rec) return;
    recRef.current = null; clearInterval(cdRef.current); clearTimeout(stopRef.current);
    setRecItem(null); setCountLeft(null);
    let clip; try { clip = await rec.stop(); } catch { setErr({ de: 'Aufnahme fehlgeschlagen.', ar: 'فشل التسجيل.' }); return; }
    if (!clip?.blob || clip.blob.size < 1200) { setErr({ de: 'Nichts aufgenommen — sprich bitte.', ar: 'مفيش صوت — اتكلم من فضلك.' }); return; }
    setBusyItem(item.id);
    try {
      const r = await fetch(`${apiUrl}/api/personal-step/speak?sessionId=${encodeURIComponent(data.sessionId)}&itemId=${encodeURIComponent(item.id)}`, {
        method: 'POST', headers: { ...hdr, 'Content-Type': 'audio/wav' }, body: clip.blob,
      });
      const d = await r.json();
      if (r.status === 422 && d.error === 'no_voice') { setErr({ de: 'Nichts aufgenommen — sprich bitte.', ar: 'مفيش صوت — اتكلم من فضلك.' }); setBusyItem(null); return; }
      if (!r.ok) throw new Error(d.error || 'failed');
      setSpeakRes((s) => ({ ...s, [item.id]: d }));
      mergeReps(d, item.id);
    } catch { setErr({ de: 'Konnte nicht auswerten. Bitte erneut.', ar: 'مقدرناش نحلّل. حاول تاني.' }); }
    setBusyItem(null);
  };

  const shell = (children) => (
    // dir=ltr pinned: the overlay is German-primary (targets, options, prompts are German); in
    // Arabic feedback mode an inherited RTL direction flipped its punctuation (".Ich werde mich…",
    // "0 von 15" reversed — E2E verification 07-20, screenshot v-04). Arabic lines keep their own dir.
    <div dir="ltr" style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'var(--bg, #04070d)', padding: '18px 16px 40px', direction: 'ltr', textAlign: 'left' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={stageTitle}>DEIN PERSÖNLICHER SCHRITT{/* OWNER-AR slot */}</span>
          <button onClick={onClose} style={{ ...ghostBtn, minHeight: 40, padding: '8px 14px' }}>Schließen ✕</button>
        </div>
        {children}
      </div>
    </div>
  );

  if (phase === 'loading') return shell(<div style={{ ...dim, padding: 20 }}>Lade …</div>);
  if (phase === 'generating') return shell(
    <div style={{ ...card, ...rtl }}>
      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
        {ar ? '⏳ التمارين بتتجهز حالًا' : '⏳ Dein Übungsblock wird gerade für dich gebaut …'}
      </div>
      <div style={{ ...dim, marginTop: 4 }}>Aus deinen eigenen Sätzen von heute.{/* OWNER-AR slot */}</div>
    </div>);
  if (phase === 'failed' || !data?.set) return shell(
    <div style={{ ...card, ...rtl }}>
      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
        Noch kein persönlicher Schritt — schließe zuerst ein Interview ab.{/* OWNER-AR slot */}
      </div>
    </div>);

  const { set, bottleneck: bn, completed } = data;
  const stageDone = (list) => (list || []).every((i) => (i.repsDone || 0) >= i.reps);
  const s1done = stageDone(set.stage1), s2done = stageDone(set.stage2);
  const s2locked = set.stage1.length > 0 && !s1done;
  const s3locked = set.stage2.length > 0 && !s2done;
  const totalDone = [...set.stage1, ...set.stage2, ...set.stage3].reduce((s, i) => s + Math.min(i.reps, i.repsDone || 0), 0);

  return shell(<>
    {/* ── The brief: today's #1, the evidence, the why ── */}
    <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'rgba(59,130,246,0.08)', border: '1px solid var(--accent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={stageTitle}>ENGPASS NR. 1 HEUTE{/* OWNER-AR slot */}</span>
        {bn?.repeat && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>Tag-Serie ×{bn.dayStreak}</span>}
      </div>
      <div style={{ marginTop: 5, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{set.title_de}</div>
      {set.title_ar && <div dir="rtl" style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2, textAlign: 'right' }}>{set.title_ar}</div>}
      {(bn?.evidenceQuotes || []).slice(0, 3).map((q, i) => (
        <div key={i} style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
          <span style={{ color: 'var(--bad)', textDecoration: 'line-through' }}>{q.quote}</span>
          {q.corrected && <>{' '}<span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{q.corrected}</span></>}
        </div>
      ))}
      {bn?.why && <div style={{ ...dim, marginTop: 7 }}>{bn.why}</div>}
      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-dim)' }}>
        {totalDone} von {set.totalReps} · ca. {set.estMinutes} Min.{set.fallback ? ' · Basis-Modus' : ''}
      </div>
      {set.fallback && !completed && (
        <button onClick={regenerate} disabled={busyItem === 'regen'}
          style={{ ...ghostBtn, marginTop: 8, minHeight: 40, fontSize: 11 }}>
          {busyItem === 'regen' ? 'Generiere …' : '↻ NEUEN ÜBUNGSBLOCK GENERIEREN'}{/* OWNER-AR slot */}
        </button>
      )}
      <div style={{ marginTop: 5, height: 4, borderRadius: 2, background: 'var(--surface-2)' }}>
        <div style={{ width: `${Math.round((totalDone / Math.max(1, set.totalReps)) * 100)}%`, height: 4, borderRadius: 2, background: 'var(--accent)' }} />
      </div>
    </div>

    {err && <div style={{ ...card, borderColor: 'rgba(248,113,113,0.4)', fontSize: 12, color: 'var(--bad)', ...rtl }}>{ar && err.ar ? err.ar : err.de}</div>}

    {/* ── Stage 1 · ERKENNEN ── */}
    {!!set.stage1.length && (
      <div style={{ marginTop: 16 }}>
        <span style={stageTitle}>1 · ERKENNEN {s1done ? '✓' : ''}</span>
        <div style={{ ...dim, marginTop: 2 }}>Tippe den korrekten Satz — dein Auge lernt den Unterschied zu sehen.{/* OWNER-AR slot */}</div>
        {set.stage1.map((item) => {
          const a = answered[item.id];
          const done = (item.repsDone || 0) >= item.reps;
          return (
            <div key={item.id} style={card}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>Welcher Satz ist korrekt?{done ? ' · ✓' : ''}</div>
              {item.options.map((opt, oi) => {
                const chosen = a?.chosen === opt;
                const isCorrect = a && opt.trim() === a.corrected?.trim();
                return (
                  <button key={oi} onClick={() => answer(item, opt)} disabled={!!a || busyItem === item.id}
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 6, padding: '10px 12px',
                      minHeight: 44, borderRadius: 10, cursor: a ? 'default' : 'pointer', fontSize: 12.5, lineHeight: 1.55,
                      color: a ? (isCorrect ? 'var(--accent-2)' : chosen ? 'var(--bad)' : 'var(--text-dim)') : 'var(--text)',
                      background: 'var(--surface-2)',
                      border: `1px solid ${a ? (isCorrect ? 'var(--accent-2)' : chosen ? 'var(--bad)' : 'var(--line)') : 'var(--line-strong)'}` }}>
                    {opt}
                  </button>
                );
              })}
              {a && (
                <div style={{ marginTop: 7, fontSize: 11.5, lineHeight: 1.6, color: 'var(--text)', ...rtl }}>
                  {a.correct ? '✓ ' : ''}{ar && a.why_ar ? a.why_ar : a.why_de}
                  {!a.correct && <div style={{ marginTop: 3, color: 'var(--text-dim)', fontSize: 10.5 }}>Nicht gezählt — gleich nochmal im Sprechen.{/* OWNER-AR slot */}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}

    {/* ── Stage 2 · KONTROLLIERT SAGEN ── */}
    {!!set.stage2.length && (
      <div style={{ marginTop: 16, opacity: s2locked ? 0.45 : 1 }}>
        <span style={stageTitle}>2 · LAUT SAGEN {s2done ? '✓' : ''}</span>
        <div style={{ ...dim, marginTop: 2 }}>
          {s2locked ? 'Erst Stufe 1 abschließen.' : 'Sag die korrekte Version laut — dein Mund muss sie können, nicht dein Auge.'}{/* OWNER-AR slot */}
        </div>
        {!s2locked && set.stage2.map((item) => {
          const res = speakRes[item.id];
          const done = (item.repsDone || 0) >= item.reps;
          return (
            <div key={item.id} style={card}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{item.instruction_de} · {item.repsDone || 0}/{item.reps}{done ? ' ✓' : ''}</div>
              <div style={{ marginTop: 5, fontSize: 12.5, color: 'var(--bad)', textDecoration: 'line-through', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{item.prompt}</div>
              <div style={{ ...dim, marginTop: 5, ...rtl }}>{ar && item.why_ar ? item.why_ar : item.why_de}</div>
              {!done && (
                recItem === item.id
                  ? <button onClick={() => stopRec(item)} style={{ ...actionBtn, marginTop: 8, minHeight: 44 }}>■ STOPP & PRÜFEN</button>
                  : <button onClick={() => startRec(item, 20)} disabled={!!recItem || busyItem === item.id}
                      style={{ ...ghostBtn, marginTop: 8, minHeight: 44 }}>{busyItem === item.id ? 'Prüfe …' : '● AUFNEHMEN'}</button>
              )}
              {res && (
                <div style={{ marginTop: 7, fontSize: 11.5, lineHeight: 1.6 }}>
                  <div style={{ color: res.passed ? 'var(--accent-2)' : 'var(--warn)' }}>
                    {res.passed ? '✓ Sauber gesagt.' : res.practiced ? 'Geübt — weiter geht es.' : 'Noch nicht ganz — einmal noch.'}{/* OWNER-AR slot */}
                  </div>
                  <div style={{ color: 'var(--text-dim)', marginTop: 3 }}>Gehört: „{res.heard}“</div>
                  <div style={{ color: 'var(--accent-2)', marginTop: 3 }}>Ziel: „{res.target}“</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}

    {/* ── Stage 3 · TRANSFER ── */}
    {!!set.stage3.length && (
      <div style={{ marginTop: 16, opacity: s3locked ? 0.45 : 1 }}>
        <span style={stageTitle}>3 · TRANSFER — WIE IM ECHTEN INTERVIEW</span>
        <div style={{ ...dim, marginTop: 2 }}>
          {s3locked ? 'Erst Stufe 2 abschließen.' : 'Antworte laut, bevor der Countdown endet — ohne Skript, wie vor einem Personaler.'}{/* OWNER-AR slot */}
        </div>
        {!s3locked && set.stage3.map((item) => {
          const res = speakRes[item.id];
          const done = (item.repsDone || 0) >= item.reps;
          return (
            <div key={item.id} style={card}>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, fontStyle: 'italic' }}>„{item.frage}“</div>
              <div style={{ ...dim, marginTop: 4, ...rtl }}>{ar && item.why_ar ? item.why_ar : item.why_de}</div>
              {!done && (
                recItem === item.id
                  ? <button onClick={() => stopRec(item)} style={{ ...actionBtn, marginTop: 8, minHeight: 44 }}>
                      ■ FERTIG{countLeft != null ? ` · ${countLeft}s` : ''}
                    </button>
                  : <button onClick={() => startRec(item, item.countdownS || 45)} disabled={!!recItem || busyItem === item.id}
                      style={{ ...ghostBtn, marginTop: 8, minHeight: 44 }}>{busyItem === item.id ? 'Prüfe …' : `● ANTWORTEN (${item.countdownS || 45}s)`}</button>
              )}
              {res && (
                <div style={{ marginTop: 7, fontSize: 11.5, lineHeight: 1.6 }}>
                  <div style={{ color: res.passed ? 'var(--accent-2)' : 'var(--warn)' }}>
                    {res.passed ? '✓ Zielstruktur benutzt.' : res.practiced ? 'Geübt — die Struktur kommt mit der Wiederholung.' : 'Die Zielstruktur war nicht zu hören — noch ein Versuch.'}{/* OWNER-AR slot */}
                  </div>
                  {res.must_use_de && <div style={{ color: 'var(--text-dim)', marginTop: 3, ...rtl }}>Gefragt war: {ar && res.must_use_ar ? res.must_use_ar : res.must_use_de}</div>}
                  <div style={{ color: 'var(--text-dim)', marginTop: 3 }}>Gehört: „{res.heard}“</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}

    {/* ── Completion → the RE-INTERVIEW unlock (server-confirmed) ── */}
    <div style={{ marginTop: 18 }}>
      {completed ? (
        <div style={{ padding: '13px 15px', borderRadius: 'var(--r-md)', background: 'rgba(59,130,246,0.08)', border: '1px solid var(--accent)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5 }}>
            Block abgeschlossen — serverseitig bestätigt.{/* OWNER-AR slot */}
          </div>
          <div style={{ ...dim, marginTop: 3 }}>
            Jetzt beweist du es: ein kurzes Interview, das genau diese Stelle erneut prüft. Deine Akte entscheidet danach.{/* OWNER-AR slot */}
          </div>
          <button onClick={onStartInterview} style={{ ...actionBtn, marginTop: 10, width: '100%', minHeight: 48 }}>
            RE-INTERVIEW STARTEN
          </button>
        </div>
      ) : (
        <div style={{ ...dim, textAlign: 'center' }}>
          Das Re-Interview schaltet frei, wenn alle Stufen abgeschlossen sind.{/* OWNER-AR slot */}
        </div>
      )}
    </div>
  </>);
}
