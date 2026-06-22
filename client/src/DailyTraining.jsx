/**
 * DailyTraining.jsx — "Tägliches Training": a 3–5 minute daily micro-session.
 *
 * Science-backed learning engine:
 *  • Interleaved practice  (Shea & Morgan 1979)  — server shuffles item sources
 *  • Active recall / write-it-again (Bjork 1994)  — wrong answer requires re-typing correct form
 *  • Generation effect (Slamecka & Graf 1978)     — first-letter cue hides answer until requested
 *  • Variable ratio reward (Skinner 1938)         — ~15% mystery XP bonus on correct answers
 *  • Combo counter                                — consecutive streak drives flow state
 *  • Streak shield (Kahneman loss aversion)       — 7-day shield display + earned notification
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// Minimal client-side normaliser for the re-type gate (strict — they've seen the answer).
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
  const [shadowState, setShadowState] = useState(null); // null | 'speaking' | 'listening' | 'ok' | 'fail'

  const bonusTimer = useRef(null);
  const recogRef = useRef(null);
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
  useEffect(() => () => { recogRef.current?.abort?.(); window.speechSynthesis?.cancel?.(); }, []);

  const questions = data?.questions || [];
  const q = questions[idx];

  const resetItemState = () => {
    setAnswer(''); setResult(null); setRetypeMode(false);
    setRetypeValue(''); setRetypeOk(false); setShowCue(false); setShadowState(null);
    recogRef.current?.abort?.(); window.speechSynthesis?.cancel?.();
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
        // Variable rewards produce the highest response rate and greatest extinction resistance.
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
        // After seeing the correct answer, student MUST re-type it before advancing.
        // Passive reading has near-zero transfer to spoken production.
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

  const startShadow = (text) => {
    if (!text) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    recogRef.current?.abort?.();
    window.speechSynthesis.cancel();
    setShadowState('speaking');
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'de-DE'; utt.rate = 0.85;
    utt.onend = () => {
      setShadowState('listening');
      const r = new SR();
      recogRef.current = r;
      r.lang = 'de-DE'; r.interimResults = false; r.maxAlternatives = 3;
      r.onresult = (e) => {
        const heard = Array.from(e.results[0]).map(a => a.transcript.toLowerCase()).join(' ');
        const exp = text.toLowerCase().replace(/[.,!?]/g, '');
        const wordMatch = exp.split(' ').filter(w => w.length > 3).every(w => heard.includes(w));
        setShadowState(wordMatch ? 'ok' : 'fail');
      };
      r.onerror = () => setShadowState('fail');
      r.onend = () => setShadowState(s => s === 'listening' ? 'fail' : s);
      r.start();
    };
    window.speechSynthesis.speak(utt);
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
      if (r.status === 402) { setErr(lang === 'ar' ? 'الجولات الإضافية متاحة في الخطة المدفوعة.' : 'Weitere Runden gibt es im bezahlten Plan.'); setBusy(false); return; }
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
      {/* Variable ratio bonus pop — Skinner VR schedule: unexpected reward maximises engagement */}
      {bonus && (
        <div style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
          background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#04070d',
          fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 18, letterSpacing: '0.12em',
          padding: '10px 22px', borderRadius: 'var(--r-sm)', boxShadow: '0 0 32px rgba(245,158,11,0.7)',
          animation: 'rank-pop 0.4s var(--ease-spring)', pointerEvents: 'none' }}>
          {bonus.label} <span style={{ fontSize: 13 }}>+{bonus.xp} XP</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '0.1em',
            color: 'var(--warn)', textShadow: '0 0 14px rgba(245,158,11,0.5)' }}>TÄGLICHES TRAINING</div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>3–5 MINUTEN · DEINE FEHLER VON GESTERN</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {comboLabel && (
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11,
              color: combo >= 5 ? '#fbbf24' : '#f97316', letterSpacing: '0.1em',
              textShadow: combo >= 5 ? '0 0 10px rgba(245,158,11,0.7)' : 'none' }}>{comboLabel}</span>
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
          {/* Streak shield notifications — loss aversion (Kahneman & Tversky 1979) */}
          {shieldMsg === 'earned' && (
            <div style={{ padding: '8px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(251,191,36,0.15)',
              border: '1px solid rgba(251,191,36,0.4)', fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>
              🛡 SCHUTZSCHILD VERDIENT! 7 Tage am Stück — ein verpasster Tag wird vergeben.
            </div>
          )}
          {shieldMsg === 'used' && (
            <div style={{ padding: '8px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.35)', fontSize: 12, color: '#34d399', fontWeight: 700 }}>
              🛡 SCHUTZSCHILD AKTIVIERT! Deine Serie ist gerettet.
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

              <input autoFocus value={answer} disabled={!!result}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (result ? (canAdvance && next()) : submit()); }}
                placeholder="Auf Deutsch tippen…"
                style={{ ...inputSt, marginTop: 10,
                  borderColor: result ? (result.correct ? 'var(--player)' : 'var(--boss)') : 'var(--line)' }} />

              {/* Generation-effect cue — revealed only on request; forces recall over recognition */}
              {!result && q.cue && (
                <div style={{ marginTop: 6, textAlign: 'right' }}>
                  {showCue
                    ? <span style={{ fontSize: 12, color: 'var(--accent-dim)', fontFamily: 'monospace', letterSpacing: '0.06em' }}>{q.cue}</span>
                    : <button onClick={() => setShowCue(true)} style={cueBtn}>💡 Tipp anzeigen</button>
                  }
                </div>
              )}

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
                  {/* Write-it-again gate (Bjork 1994): retype correct form before advancing */}
                  {retypeMode && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, letterSpacing: '0.06em' }}>SCHREIB ES AB, UM FORTZUFAHREN:</div>
                      <input value={retypeValue}
                        onChange={(e) => { setRetypeValue(e.target.value); checkRetype(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && retypeOk) next(); }}
                        placeholder={result.expected}
                        style={{ ...inputSt, fontSize: 13,
                          borderColor: retypeOk ? 'var(--player)' : retypeValue ? 'var(--boss)' : 'var(--line)' }} />
                    </div>
                  )}
                </div>
              )}

              {/* Shadow pronunciation (motor-memory bridge: hear → repeat → confirm) */}
              {result && result.expected && !retypeMode && (window.SpeechRecognition || window.webkitSpeechRecognition) && (
                <div style={{ marginTop: 8 }}>
                  {shadowState === null && (
                    <button onClick={() => startShadow(result.expected)} style={shadowBtn}>
                      🎙 AUSSPRECHEN — Wiederhole den Satz
                    </button>
                  )}
                  {shadowState === 'speaking' && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>🔊 Hör zu…</div>}
                  {shadowState === 'listening' && <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 2 }}>🎙 Jetzt sprechen…</div>}
                  {shadowState === 'ok' && <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginTop: 2 }}>✓ Gut gesagt! أحسنت!</div>}
                  {shadowState === 'fail' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: '#f87171' }}>Noch einmal versuchen.</span>
                      <button onClick={() => startShadow(result.expected)} style={shadowBtn}>↺</button>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={result ? (canAdvance ? next : undefined) : submit}
                disabled={busy || (!result && !answer.trim()) || (result && !canAdvance)}
                style={{ ...primary, marginTop: 11, width: '100%',
                  opacity: (busy || (!result && !answer.trim()) || (result && !canAdvance)) ? 0.5 : 1 }}>
                {busy ? '…'
                  : !result ? 'PRÜFEN'
                  : !canAdvance ? '✍ ERST TIPPEN'
                  : idx + 1 < questions.length ? 'WEITER →' : 'ABSCHLIESSEN ✓'}
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
const cueBtn = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', padding: '4px 9px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid rgba(0,229,255,0.35)', background: 'rgba(0,229,255,0.07)', color: 'var(--accent-dim)' };
const shadowBtn = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', padding: '5px 10px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24' };
const primary = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', padding: '11px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--warn)', color: '#04070d', background: 'linear-gradient(135deg, #fbbf24, var(--warn))' };
const ghost = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, padding: '7px 11px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)' };
const errBox = { margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8, fontSize: 11, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' };
