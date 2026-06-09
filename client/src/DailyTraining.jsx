/**
 * DailyTraining.jsx — "Tägliches Training": a 3–5 minute daily micro-session.
 *
 * Quizzes the user on their OWN past mistakes (from the backend SRS store), shows a BPO
 * phrase of the day, and advances a daily streak on completion. All content + grading
 * comes from the backend (source of truth); the client only displays and submits answers.
 */
import { useState, useEffect, useCallback } from 'react';

export default function DailyTraining({ token, apiUrl, onClose, onComplete, lang = 'de' }) {
  const [data, setData]   = useState(null);     // null = loading
  const [idx, setIdx]     = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);   // grade result for the current question
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(false);
  const [finalStreak, setFinalStreak] = useState(null);
  const [err, setErr]     = useState('');
  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/daily`, { headers: headers() });
        const d = await r.json();
        if (!cancelled) setData(d);
      } catch { if (!cancelled) setErr('Server nicht erreichbar.'); }
    })();
    return () => { cancelled = true; };
  }, [apiUrl, headers]);

  const questions = data?.questions || [];
  const q = questions[idx];

  const submit = async () => {
    if (!answer.trim() || busy || result) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${apiUrl}/api/daily/grade`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: q.id, answer }) });
      setResult(await r.json());
    } catch { setErr('Bewertung fehlgeschlagen.'); }
    setBusy(false);
  };

  const next = async () => {
    if (idx + 1 < questions.length) {
      setIdx(idx + 1); setAnswer(''); setResult(null);
      return;
    }
    // last question → complete the session
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/api/daily/complete`, { method: 'POST', headers: headers(), body: '{}' });
      const s = await r.json();
      setFinalStreak(s.streak ?? data?.streak ?? 0);
      onComplete?.(s);
    } catch { setFinalStreak(data?.streak ?? 0); }
    setBusy(false);
    setDone(true);
  };

  return (
    <div style={ov}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '0.1em',
            color: 'var(--warn)', textShadow: '0 0 14px rgba(245,158,11,0.5)' }}>TÄGLICHES TRAINING</div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>3–5 MINUTEN · DEINE FEHLER VON GESTERN</div>
        </div>
        <button onClick={onClose} style={ghost}>✕</button>
      </div>

      {err && <div style={errBox}>⚠ {err}</div>}

      {!data && !err && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>Lade…</div>}

      {/* ── Completion screen ── */}
      {done && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 56, animation: 'rank-pop 0.7s var(--ease-spring)' }}>🔥</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, color: '#fbbf24', textShadow: '0 0 18px rgba(245,158,11,0.6)' }}>
            Trainingsserie: {finalStreak} {finalStreak === 1 ? 'Tag' : 'Tage'}
          </div>
          <div style={{ fontSize: 13, color: '#a7f3d0' }}>Erledigt für heute. Komm morgen wieder, um die Serie zu halten.</div>
          <button onClick={onClose} style={{ ...primary, marginTop: 8 }}>FERTIG</button>
        </div>
      )}

      {/* ── Session ── */}
      {data && !done && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Phrase of the day */}
          {data.phrase && (
            <div style={{ ...card, borderColor: 'rgba(0,229,255,0.3)' }}>
              <div style={{ ...secTitle, color: 'var(--accent)' }}>PHRASE DES TAGES</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#e2e8f0', lineHeight: 1.4 }}>{data.phrase.de}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{data.phrase.en}</div>
              {data.phrase.drill && <div style={{ fontSize: 11, color: 'var(--accent-dim)', marginTop: 6, lineHeight: 1.4 }}>▸ {data.phrase.drill}</div>}
            </div>
          )}

          {/* Quiz */}
          {q && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ ...secTitle, color: 'var(--warn)', margin: 0 }}>
                  {q.source === 'mistake' ? 'DEIN FEHLER · ÜBEN' : 'BPO-DRILL'}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>Frage {idx + 1}/{questions.length}</span>
              </div>
              <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.5 }}>{q.prompt}</div>
              {q.hint && <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 5, fontStyle: 'italic' }}>{q.hint}</div>}

              <input autoFocus value={answer} disabled={!!result}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (result ? next() : submit()); }}
                placeholder="Auf Deutsch tippen…"
                style={{ ...input, marginTop: 10,
                  borderColor: result ? (result.correct ? 'var(--player)' : 'var(--boss)') : 'var(--line)' }} />

              {result && (
                <div className="flash" style={{ marginTop: 10, padding: '9px 11px', borderRadius: 'var(--r-sm)',
                  background: result.correct ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${result.correct ? '#10b98155' : '#ef444455'}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: result.correct ? '#34d399' : '#f87171' }}>
                    {result.correct ? '✓ Richtig' : '✗ Nochmal üben'}
                  </div>
                  {!result.correct && result.expected && (
                    <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 3 }}>Lösung: <b style={{ color: '#e2e8f0' }}>{result.expected}</b></div>
                  )}
                  {(result.note || result.note_ar) && (
                    <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 4,
                      direction: lang === 'ar' ? 'rtl' : 'ltr', textAlign: lang === 'ar' ? 'right' : 'left' }}>
                      ⚠ {lang === 'ar' && result.note_ar ? result.note_ar : result.note}
                    </div>
                  )}
                </div>
              )}

              <button onClick={result ? next : submit} disabled={busy || (!result && !answer.trim())}
                style={{ ...primary, marginTop: 11, width: '100%', opacity: (busy || (!result && !answer.trim())) ? 0.5 : 1 }}>
                {busy ? '…' : result ? (idx + 1 < questions.length ? 'WEITER →' : 'ABSCHLIESSEN ✓') : 'PRÜFEN'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ov = { position: 'absolute', inset: 0, zIndex: 220, display: 'flex', flexDirection: 'column', background: 'rgba(2,4,9,0.98)', backdropFilter: 'blur(6px)', animation: 'flash-in 0.3s ease' };
const card = { padding: '12px 13px', borderRadius: 'var(--r-md)', background: 'linear-gradient(180deg, rgba(8,16,28,0.9), rgba(4,8,14,0.92))', border: '1px solid var(--line)', boxShadow: 'inset 0 0 24px rgba(0,0,0,0.45)' };
const secTitle = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-dim)', marginBottom: 6 };
const input = { width: '100%', padding: '11px', borderRadius: 'var(--r-sm)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontFamily: 'var(--font-body)', fontSize: 14, border: '1px solid var(--line)', outline: 'none' };
const primary = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', padding: '11px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--warn)', color: '#04070d', background: 'linear-gradient(135deg, #fbbf24, var(--warn))' };
const ghost = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, padding: '7px 11px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)' };
const errBox = { margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8, fontSize: 11, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' };
