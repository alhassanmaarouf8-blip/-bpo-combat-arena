/**
 * SatzbauSchmiede.jsx — SATZBAU-SCHMIEDE verb-final word-order builder drill (PAID).
 *
 * The learner taps German word-tiles back into the correct order against the clock, building a
 * verb-final subordinate clause (weil/dass/wenn/obwohl/nachdem/damit…) — the single highest-leverage
 * structure for an Arabic-L1 speaker, since Arabic doesn't push the verb to the clause end.
 *
 * Grading is 100% deterministic on the server (server/satzbauSchmiede.js: gradeSatzbau) — no model.
 * The on-screen countdown is a PRESSURE cue only: running out of time never turns a correct answer
 * into a wrong one and never blocks a late submit — only the learner's actual final tile order is
 * ever graded (feedback-accuracy-doctrine: never fabricate a "wrong" for something outside their
 * control, like a UI timer).
 *
 * Arabic labels: only strings ALREADY used verbatim elsewhere in the app are carried over; every
 * new label is German-only with an OWNER-AR slot (hard rule: the builder never authors masri —
 * T() falls back to German while the slot is empty).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { LoadingPane } from './Loading.jsx';
import { SpeakerIcon } from './icons/AudioIcons';
import { SalmaTutorPanel, useSalmaDrillSession } from './SalmaTutorPanel.jsx';
import { reportDrillEvent } from './salmaCoachClient.js';
import { playNative } from './nativeVoice.js';
import { DrillIntro } from './drillIntros.jsx';

const T = (lang, de, ar) => (lang === 'ar' && ar ? ar : de);

const TIME_START = 22;   // seconds for the first (shortest) item
const TIME_FLOOR = 10;   // never ramps below this
const TIME_STEP  = 2;    // shaved off per subsequent item — the difficulty ramp

export function SatzbauSchmiede({ token, apiUrl, lang = 'de', onClose, onGoPricing, why = null }) {
  const tutorSession = useSalmaDrillSession(token, 'satzbau-schmiede');
  const [phase, setPhase]   = useState('loading'); // loading | practice | done | error
  const [items, setItems]   = useState([]);
  const [idx, setIdx]       = useState(0);
  const [tiles, setTiles]   = useState([]);         // shuffled tiles for the current item, as { text, used }
  const [chosen, setChosen] = useState([]);         // indices into `tiles`, in tap order
  const [seconds, setSeconds] = useState(TIME_START);
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);       // { correct, matchedCount, total, target }
  const [err, setErr]       = useState(null);

  const timerRef = useRef(null);

  // Native-voice stop handle: closing the drill (or re-listening) must SILENCE the previous line —
  // an orphaned model voice talking over the next screen reads as a bug.
  const stopVoiceRef = useRef(null);
  useEffect(() => () => { try { stopVoiceRef.current?.(); } catch { /* ignore */ } }, []);

  const blocked = useCallback(() => { onGoPricing?.(); onClose?.(); }, [onGoPricing, onClose]);

  const load = useCallback(async () => {
    setPhase('loading'); setErr(null); setResult(null); setIdx(0);
    try {
      const r = await fetch(`${apiUrl}/api/satzbau?t=${Date.now()}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.items) || !d.items.length) throw new Error('load_failed');
      setItems(d.items);
      setPhase('practice');
    } catch {
      setErr({ de: 'Konnte die Übung nicht laden. Bitte erneut.', ar: 'مقدرناش نحمّل التمرين. حاول تاني.' });   // ar = verbatim reuse (Shadowing/Listening)
      setPhase('error');
    }
  }, [apiUrl, token, blocked]);

  useEffect(() => { load(); }, [load]);

  // Reset the tile board + countdown whenever the current item changes.
  useEffect(() => {
    const item = items[idx];
    if (!item) return;
    setTiles(item.tiles.map((text) => ({ text, used: false })));
    setChosen([]);
    setResult(null);
    setErr(null);
    setSeconds(Math.max(TIME_FLOOR, TIME_START - idx * TIME_STEP));
  }, [items, idx]);

  // Countdown is cosmetic pressure only — it never blocks submission or affects grading.
  useEffect(() => {
    clearInterval(timerRef.current);
    if (phase !== 'practice' || result) return;
    timerRef.current = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, result, idx]);

  const item = items[idx];

  const tapTile = (i) => {
    if (result || busy || tiles[i]?.used) return;
    setTiles((t) => t.map((x, j) => (j === i ? { ...x, used: true } : x)));
    setChosen((c) => [...c, i]);
  };

  const undoLast = () => {
    if (result || busy || !chosen.length) return;
    const last = chosen[chosen.length - 1];
    setTiles((t) => t.map((x, j) => (j === last ? { ...x, used: false } : x)));
    setChosen((c) => c.slice(0, -1));
  };

  const clearAll = () => {
    if (result || busy) return;
    setTiles((t) => t.map((x) => ({ ...x, used: false })));
    setChosen([]);
  };

  const submit = async () => {
    if (result || busy || !chosen.length) return;
    setBusy(true); setErr(null);
    clearInterval(timerRef.current);
    try {
      const tokens = chosen.map((i) => tiles[i].text);
      const r = await fetch(`${apiUrl}/api/satzbau/grade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, tokens }),
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'grade_failed');
      const coachCue = await reportDrillEvent({ apiUrl, token, event: { drill: 'satzbau-schmiede', correct: !!d.correct } });
      setResult({ ...d, ...(coachCue ? { coachCue } : {}) });
    } catch {
      setErr({ de: 'Konnte nicht prüfen. Bitte erneut.', ar: '' });   /* OWNER-AR slot */
    }
    setBusy(false);
  };

  const next = () => {
    if (idx < items.length - 1) setIdx(idx + 1); else setPhase('done');
  };

  // Retry the same sentence: clear the board and give the countdown a fresh floor (it may have hit
  // 0 while the result card was open — a frozen "0s" would read as a bug, even though it's cosmetic).
  const retry = () => {
    setResult(null); clearAll();
    setSeconds((s) => Math.max(s, TIME_FLOOR));
  };

  const hear = () => {
    if (!item) return;
    try { stopVoiceRef.current?.(); } catch { /* ignore */ }
    stopVoiceRef.current = playNative({ apiUrl, token, text: result?.target || item.tiles.join(' '), rate: 0.95 });
  };

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
        🏗️ SATZBAU-SCHMIEDE
      </span>
      <button onClick={onClose} style={ghostBtn}>{T(lang, 'Schließen', 'إغلاق')}</button>
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

  if (phase === 'loading') return shell(<>{header}<LoadingPane /></>);

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
      <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginTop: 8 }}>{T(lang, 'Geschafft!', '')}</div>{/* OWNER-AR slot */}
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, lineHeight: 1.6 }}>
        {T(lang, 'Das Verb am Satzende sitzt jetzt schneller im Kopf.', '')}{/* OWNER-AR slot */}
      </div>
      <button onClick={load} style={{ ...primaryBtn, marginTop: 18 }}>{T(lang, 'Neue Runde', 'جولة جديدة')} ▸</button>
      <button onClick={onClose} style={{ ...ghostBtnWide, marginTop: 10, width: '100%' }}>{T(lang, 'Fertig', '')}</button>{/* OWNER-AR slot */}
    </div>
  </>);

  // PRACTICE
  return shell(<>
    {header}
    <DrillIntro drillKey="satzbau" />
    <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-display)', letterSpacing: '0.1em', marginBottom: 8,
      display: 'flex', justifyContent: 'space-between' }}>
      <span>{T(lang, 'SATZ', '')} {idx + 1} / {items.length} · {item?.connector}</span>{/* OWNER-AR slot */}
      <span style={{ color: seconds <= 5 ? '#ef4444' : '#64748b' }}>⏱ {seconds}s</span>
    </div>
    <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
      {items.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < idx ? 'var(--accent)' : i === idx ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>

    {/* Communicative cue — what the sentence must accomplish */}
    <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 12 }}>
      {T(lang, item?.cue_de, item?.cue_ar)}
    </div>

    {/* Assembled sentence-so-far */}
    <div style={{ minHeight: 56, padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.35)',
      border: '1px solid rgba(59,130,246,0.25)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {chosen.length === 0 && <span style={{ fontSize: 12, color: '#64748b' }}>{T(lang, 'Tippe die Wörter in der richtigen Reihenfolge…', '')}</span>}{/* OWNER-AR slot */}
      {chosen.map((i, pos) => (
        <span key={pos} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13.5,
          background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(59,130,246,0.4)', color: '#f1f5f9' }}>
          {tiles[i]?.text}
        </span>
      ))}
    </div>

    {/* Remaining tiles to tap */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
      {tiles.map((t, i) => !t.used && (
        <button key={i} onClick={() => tapTile(i)} disabled={!!result || busy}
          style={{ padding: '9px 13px', borderRadius: 8, fontSize: 13.5, cursor: 'pointer', color: '#f1f5f9',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.35)' }}>
          {t.text}
        </button>
      ))}
    </div>

    {!result && (
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={undoLast} disabled={!chosen.length || busy} style={{ ...ghostBtnWide, opacity: chosen.length ? 1 : 0.4 }}>{T(lang, '⌫ Zurück', '')}</button>{/* OWNER-AR slot */}
        <button onClick={clearAll} disabled={!chosen.length || busy} style={{ ...ghostBtnWide, opacity: chosen.length ? 1 : 0.4 }}>{T(lang, 'Neu', '')}</button>{/* OWNER-AR slot */}
      </div>
    )}

    {err && (
      <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, color: '#fca5a5' }}>
        {err.de}{err.ar ? <><br /><span dir="rtl">{err.ar}</span></> : null}
      </div>
    )}

    {result ? (
      <>
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 11,
          background: result.correct ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${result.correct ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
          <div style={{ fontSize: 13.5, color: result.correct ? 'var(--accent-2)' : '#fca5a5', fontWeight: 700 }}>
            {result.correct ? T(lang, '✓ Richtige Reihenfolge!', '') : T(lang, `✗ ${result.matchedCount}/${result.total} richtig platziert`, '')}{/* OWNER-AR slots */}
          </div>
          {!result.correct && (
            <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 6 }}>
              {T(lang, 'Richtig war: ', '')}<b style={{ color: 'var(--action)' }}>{result.target}</b>{/* OWNER-AR slot */}
            </div>
          )}
          <button onClick={hear} style={{ ...ghostBtn, marginTop: 8 }}><SpeakerIcon style={{ marginRight: 6 }} /> {T(lang, 'Anhören', '')}</button>{/* OWNER-AR slot */}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!result.correct && <button onClick={retry} style={ghostBtnWide}>{T(lang, 'Nochmal', '')}</button>}{/* OWNER-AR slot */}
          <button onClick={next} style={{ ...primaryBtn, flex: 1 }}>
            {idx < items.length - 1 ? T(lang, 'Weiter ▸', '') : T(lang, 'Fertig ▸', '')}{/* OWNER-AR slots */}
          </button>
        </div>
      </>
    ) : (
      <button onClick={submit} disabled={busy || !chosen.length} style={{ ...primaryBtn, marginTop: 14, opacity: (busy || !chosen.length) ? 0.5 : 1 }}>
        {busy ? T(lang, 'Prüfe…', '') : T(lang, 'Prüfen', '')}{/* OWNER-AR slots */}
      </button>
    )}
    {result && !busy && <SalmaTutorPanel token={token} apiUrl={apiUrl} screen="drill" drillId="satzbau-schmiede" initialCue={result.coachCue} drillSession={tutorSession} />}
  </>);
}

const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'var(--font-display)',
  fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid var(--accent)', color: '#04070d',
  background: 'linear-gradient(135deg,var(--accent),var(--accent-2))' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10, padding: '6px 10px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10.5, padding: '12px', minHeight: 44,
  borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
