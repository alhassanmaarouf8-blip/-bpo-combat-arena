/**
 * DailyTraining.jsx — "Tägliches Training": a 3–5 minute daily micro-session.
 *
 * Science-backed learning engine:
 *  • Interleaved practice  (Shea & Morgan 1979)  — server already shuffles item sources
 *  • Active recall / write-it-again (Bjork 1994)  — wrong answer requires re-typing correct form
 *  • Generation effect (Slamecka & Graf 1978)     — first-letter cue hides the answer until requested
 *  • Variable ratio reward (Skinner 1938)         — ~15% mystery XP bonus on correct answers
 *  • Combo counter                                — consecutive streak drives flow state
 *  • Streak shield (Kahneman loss aversion)       — 7-day shield display + earned notification
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// Minimal client-side normaliser for the re-type gate (no levenshtein — they've seen the answer).
function normClient(s) {
  return String(s ?? '').toLowerCase().normalize('NFC')
    .replace(/[''ʼ´`]/g, "'").replace(/\s+/g, ' ').trim();
}

export default function DailyTraining({ token, apiUrl, onClose, onComplete, lang = 'de' }) {
  const [data, setData]   = useState(null);
  const [idx, setIdx]     = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(false);
  const [finalStreak, setFinalStreak] = useState(null);
  const [shieldMsg, setShieldMsg] = useState(null); // 'earned' | 'used' | null
  const [err, setErr]     = useState('');

  // ── Science engine state ────────────────────────────────────────────────────
  const [combo, setCombo] = useState(0);
  const [bonus, setBonus] = useState(null);   // { label, xp } — variable ratio reward
  const [showCue, setShowCue] = useState(false); // first-letter generation cue
  // Write-it-again: when wrong, student must retype the correct answer before advancing
  const [retypeMode, setRetypeMode] = useState(false);
  const [retypeValue, setRetypeValue] = useState('');
  const [retypeOk, setRetypeOk] = useState(false);

  const bonusTimer = useRef(null);
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

  useEffect(() => () => { clearTimeout(bonusTimer.current); }, []);

  const questions = data?.questions || [];
  const q = questions[idx];

  const resetItemState = () => {
    setAnswer(''); setResult(null); setRetypeMode(false);
    setRetypeValue(''); setRetypeOk(false); setShowCue(false);
  };

  const submit = async () => {
    if (!answer.trim() || busy || result) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${apiUrl}/api/daily/grade`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ id: q.id, answer }),
      });
      const res = await r.json();
      setResult(res);
      if (res.correct) {
        const newCombo = combo + 1;
        setCombo(newCombo);
        // Variable ratio reinforcement (Skinner VR schedule): random ~15% bonus XP.
        // Variable rewards produce the highest response rate and greatest resistance to extinction.
        if (Math.random() < 0.15) {
          clearTimeout(bonusTimer.current);
          const isJackpot = newCombo >= 5;
          setBonus({
            label: isJackpot ? '⚡ JACKPOT!' : '🎲 GLÜCKSTAG!',
            xp: isJackpot ? Math.floor(Math.random() * 4) + 5 : Math.floor(Math.random() * 3) + 3,
          });
          bonusTimer.current = setTimeout(() => setBonus(null), 2600);
        }
      } else {
        setCombo(0);
        // Active recall / write-it-again (desirable difficulty, Bjork 1994):
        // After seeing a wrong answer, student must produce the correct form from memory.
        setRetypeMode(true);
        setRetypeValue('');
        setRetypeOk(false);
      }
    } catch { setErr('Bewertung fehlgeschlagen.'); }
    setBusy(false);
  };

  const checkRetype = (val) => {
    if (!result?.expected) return;
    setRetypeOk(normClient(val) === normClient(result.expected));
  };

  const canAdvance = result ? (result.correct || retypeOk) : false;

  const next = async () => {
    if (idx + 1 < questions.length) {
      setIdx(idx + 1); resetItemState();
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/api/daily/complete`, { method: 'POST', headers: headers(), body: '{}' });
      const s = await r.json();
      setFinalStreak(s.streak ?? data?.streak ?? 0);
      if (s.shieldEarned) setShieldMsg('earned');
      else if (s.shieldUsed) setShieldMsg('used');
      onComplete?.(s);
    } catch { setFinalStreak(data?.streak ?? 0); }
    setBusy(false);
    setDone(true);
  };

  const loadMore = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${apiUrl}/api/daily/next`, { method: 'POST', headers: headers(), body: '{}' });
      if (r.status === 402) {
        setErr(lang === 'ar' ? 'الجولات الإضافية متاحة في الخطة المدفوعة.' : 'Weitere Runden gibt es im bezahlten Plan.');
        setBusy(false); return;
      }
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.questions) || !d.questions.length) throw new Error('no_set');
      setData(d); setIdx(0); resetItemState(); setFinalStreak(null); setDone(false);
      setCombo(0); setShieldMsg(null);
    } catch { setErr(lang === 'ar' ? 'مقدرناش نجيب جولة جديدة.' : 'Konnte keine neue Runde laden.'); }
    setBusy(false);
  };

  // ── Combo label (flow state calibration) ─────────────────────────────────────
  const comboLabel = combo >= 5 ? `${combo}x SERIE ⚡` : combo >= 3 ? `${combo}x 🔥` : null;

  return (
    <div style={ov}>
      {/* ── Variable ratio bonus pop (Skinner VR reward) ── */}
      {bonus && (
        <div style={{
          position: 'absolute', top: 60, left: 0, right: 0, zIndex: 300,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          animation: 'rank-pop 0.5s var(--ease-spring)',
          pointerEvents: 'none',
        }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22,
            color: '#fbbf24', textShadow: '0 0 30px rgba(245,158,11,0.9)',
            letterSpacing: '0.06em',
          }}>{bonus.label}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: '#34d399', fontWeight: 700, marginTop: 2 }}>
            +{bonus.xp} XP
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '0.1em',
            color: 'var(--warn)', textShadow: '0 0 14px rgba(245,158,11,0.5)' }}>TÄGLICHES TRAINING</div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>3–5 MINUTEN · DEINE FEHLER VON GESTERN</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Combo counter (flow state) */}
          {comboLabel && (
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11,
              color: combo >= 5 ? '#a78bfa' : '#34d399',
              textShadow: combo >= 5 ? '0 0 12px rgba(167,139,250,0.7)' : '0 0 10px rgba(52,211,153,0.6)',
              animation: combo >= 5 ? 'pulse 0.7s ease-in-out infinite' : 'none',
              padding: '4px 8px', borderRadius: 'var(--r-pill)',
              border: `1px solid ${combo >= 5 ? 'rgba(167,139,250,0.4)' : 'rgba(52,211,153,0.35)'}`,
              background: combo >= 5 ? 'rgba(167,139,250,0.08)' : 'rgba(52,211,153,0.08)',
            }}>{comboLabel}</div>
          )}
          <button onClick={onClose} style={ghost}>✕</button>
        </div>
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

          {/* Shield notifications */}
          {shieldMsg === 'earned' && (
            <div style={{ padding: '10px 16px', borderRadius: 'var(--r-md)', background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.4)', fontSize: 12.5, color: '#c4b5fd', lineHeight: 1.5 }}>
              🛡️ <b>Schutzschild verdient!</b><br />
              <span style={{ fontSize: 11, color: '#a78bfa' }}>7 Tage in Folge — ein verpasster Tag wird vergeben.</span>
            </div>
          )}
          {shieldMsg === 'used' && (
            <div style={{ padding: '10px 16px', borderRadius: 'var(--r-md)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', fontSize: 12.5, color: '#fde68a', lineHeight: 1.5 }}>
              🛡️ <b>Schutzschild aktiviert!</b><br />
              <span style={{ fontSize: 11, color: '#fbbf24' }}>Deine Serie lebt — der Schild hat den Bruch absorbiert.</span>
            </div>
          )}

          <div style={{ fontSize: 13, color: '#a7f3d0' }}>Erledigt für heute. Komm morgen wieder, um die Serie zu halten.</div>
          <button onClick={loadMore} disabled={busy} style={{ ...primary, marginTop: 8, opacity: busy ? 0.5 : 1 }}>
            {busy ? '…' : (lang === 'ar' ? 'جولة تانية ↻' : 'NOCH EINE RUNDE ↻')}
          </button>
          <button onClick={onClose} style={{ ...ghost, padding: '11px 16px' }}>{lang === 'ar' ? 'تمام' : 'FERTIG'}</button>
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

              {/* Generation effect cue (Slamecka & Graf): first-letter scaffold, hidden until requested */}
              {q.cue && !result && (
                <div style={{ marginTop: 6 }}>
                  {!showCue ? (
                    <button onClick={() => setShowCue(true)} style={cueBtn}>
                      🔍 TIPP — Anfangsbuchstaben anzeigen
                    </button>
                  ) : (
                    <div style={{ fontSize: 12, color: '#a78bfa', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', padding: '5px 8px', borderRadius: 'var(--r-sm)', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
                      {q.cue}
                    </div>
                  )}
                </div>
              )}

              <input autoFocus={!retypeMode} value={answer} disabled={!!result}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (result ? (canAdvance ? next() : undefined) : submit()); }}
                placeholder="Auf Deutsch tippen…"
                style={{ ...inputSt, marginTop: 10,
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

              {/* Write-it-again (Bjork active recall / desirable difficulty):
                  After a wrong answer, student MUST produce the correct form before advancing.
                  Passive reading of corrections has near-zero transfer to spoken interviews. */}
              {retypeMode && !retypeOk && (
                <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 'var(--r-sm)',
                  background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.35)' }}>
                  <div style={{ fontSize: 10, color: '#a78bfa', letterSpacing: '0.1em', marginBottom: 6 }}>
                    ✍ TIPPE DIE RICHTIGE ANTWORT — dann weiter
                  </div>
                  <input autoFocus
                    value={retypeValue}
                    onChange={(e) => { setRetypeValue(e.target.value); checkRetype(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && retypeOk) next(); }}
                    placeholder={result?.expected ?? '…'}
                    style={{ ...inputSt, borderColor: 'rgba(167,139,250,0.5)' }} />
                </div>
              )}
              {retypeOk && (
                <div style={{ fontSize: 11, color: '#34d399', marginTop: 5 }}>✓ Perfekt! Weiter.</div>
              )}

              <button onClick={canAdvance ? next : (result ? undefined : submit)}
                disabled={busy || (result ? !canAdvance : !answer.trim())}
                style={{ ...primary, marginTop: 11, width: '100%',
                  opacity: (busy || (result ? !canAdvance : !answer.trim())) ? 0.5 : 1 }}>
                {busy ? '…'
                  : result
                  ? (canAdvance ? (idx + 1 < questions.length ? 'WEITER →' : 'ABSCHLIESSEN ✓') : '✍ ERST TIPPEN')
                  : 'PRÜFEN'}
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
const inputSt = { width: '100%', padding: '11px', borderRadius: 'var(--r-sm)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontFamily: 'var(--font-body)', fontSize: 14, border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box' };
const primary = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', padding: '11px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--warn)', color: '#04070d', background: 'linear-gradient(135deg, #fbbf24, var(--warn))' };
const ghost = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, padding: '7px 11px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)' };
const cueBtn = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 9, letterSpacing: '0.08em', padding: '4px 9px', borderRadius: 'var(--r-pill)', cursor: 'pointer', border: '1px solid rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.06)', color: '#a78bfa', marginTop: 2 };
const errBox = { margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8, fontSize: 11, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' };
