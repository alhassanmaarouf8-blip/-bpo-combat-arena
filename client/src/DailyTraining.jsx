/**
 * DailyTraining.jsx — "Tägliches Training": a 3–5 minute daily micro-session on the learner's own
 * mistakes. Real methods only: interleaved item sources (server-shuffled), active recall (a wrong
 * answer must be re-typed correctly before advancing), and a first-letter cue that hides the answer
 * until requested. The engagement gimmicks it once carried (random-XP jackpot, combo meter, streak
 * shield) were removed 2026-07-13 as AI slop — see the anti-slop skill.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { SpeakerIcon, SpeakerQuietIcon, CloseIcon } from './icons/AudioIcons';
import { Spinner } from './Loading.jsx';
import { playNative } from './nativeVoice.js';

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
  const [err, setErr]     = useState('');

  // ── Science engine state ────────────────────────────────────────────────────
  const [showCue, setShowCue] = useState(false); // first-letter generation cue
  // Session receipt: counted from REAL graded answers only (source==='mistake' items answered
  // correctly + total correct) — deterministic, never invented, shown on the completion screen.
  const [tally, setTally] = useState({ correct: 0, mistakeFixed: 0 });
  // Write-it-again: when wrong, student must retype the correct answer before advancing
  const [retypeMode, setRetypeMode] = useState(false);
  const [retypeValue, setRetypeValue] = useState('');
  const [retypeOk, setRetypeOk] = useState(false);

  const [speaking, setSpeaking] = useState(null);   // which text id is being spoken
  const stopSpeakRef = useRef(null);                // stop() of the current playNative playback
  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  // TTS: the SHARED native-voice helper (nativeVoice.js) — same native-German Aura-2 family the
  // interview uses, via /tts-stream?drill=1 so the interview-minute gate never blocks a drill.
  // The old /api/tts path here used the RETIRED 'aura-2-lara-de' voice AND burned interview minutes.
  // playNative falls back to browser SpeechSynthesis by itself, so audio never just goes silent.
  const speakCard = useCallback((text, id) => {
    if (!text) return;
    stopSpeakRef.current?.();   // one voice at a time — kill any running playback (server or browser)
    setSpeaking(id);
    stopSpeakRef.current = playNative({
      apiUrl, token, text: String(text).slice(0, 500),
      voice: 'aura-2-elara-de',
      onEnd: () => setSpeaking(null),
    });
  }, [apiUrl, token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/daily?t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
        if (!r.ok) throw new Error(`daily ${r.status}`);   // a non-OK JSON body must NOT become card data
        const d = await r.json();
        if (!cancelled) setData(d);
      } catch { if (!cancelled) setErr('Server nicht erreichbar.'); }
    })();
    return () => { cancelled = true; };
  }, [apiUrl, headers]);

  useEffect(() => () => { stopSpeakRef.current?.(); }, []);   // don't let audio outlive the overlay

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
        // submit() is guarded (`|| result`) so each question grades exactly ONCE — no double counts.
        setTally((t) => ({ correct: t.correct + 1, mistakeFixed: t.mistakeFixed + (q?.source === 'mistake' ? 1 : 0) }));
      } else {
        // Active recall / write-it-again (desirable difficulty, Bjork 1994):
        // After seeing the correct answer, student MUST re-type it before advancing.
        // Passive reading has near-zero transfer to spoken production.
        setRetypeMode(true);
        setRetypeValue('');
        setRetypeOk(false);
        // Speak the solution the moment it renders — hearing the correct form beats silently
        // reading it (the phone job tests the EAR), and it models the retype they must now do.
        if (res.expected) speakCard(res.expected, 'answer');
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
      setTally({ correct: 0, mistakeFixed: 0 });   // fresh round, fresh receipt
    } catch { setErr(lang === 'ar' ? 'مقدرناش نجيب جولة جديدة.' : 'Konnte keine neue Runde laden.'); }
    setBusy(false);
  };

  return (
    <div style={ov}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '0.1em',
            color: 'var(--warn)', textShadow: '0 0 14px rgba(249,115,22,0.5)' }}>TÄGLICHES TRAINING</div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>HEUTIGER AKTIVER ABRUF</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onClose} aria-label="Schließen" style={ghost}><CloseIcon /></button>
        </div>
      </div>

      {err && <div style={errBox}>⚠ {err}</div>}

      {!data && !err && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>}

      {/* ── Completion screen ── */}
      {done && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#e2e8f0' }}>
            Trainingsserie: {finalStreak} {finalStreak === 1 ? 'Tag' : 'Tage'}
          </div>
          {/* Deterministic receipt — counted client-side from graded answers; rendered ONLY when the
              payload actually carries per-question `source`, so "deiner Fehler" always has real data
              behind it (never invented numbers). */}
          {questions.some((x) => x && Object.prototype.hasOwnProperty.call(x, 'source')) && (
            /* OWNER-AR slot */
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-2)', padding: '6px 14px',
              borderRadius: 'var(--r-pill)', background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.30)' }}>
              {tally.correct} in dieser Runde richtig beantwortet
              {tally.mistakeFixed > 0 ? ` · ${tally.mistakeFixed} frühere Fehler heute korrekt` : ''}
            </div>
          )}
          <div style={{ fontSize: 13, color: 'var(--accent-2)' }}>Erledigt für heute.</div>
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
            <div style={{ ...card, borderColor: 'rgba(59,130,246,0.3)' }}>
              <div style={{ ...secTitle, color: 'var(--accent)' }}>PHRASE DES TAGES</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#e2e8f0', lineHeight: 1.4 }}>{data.phrase.de}</div>
                <button onClick={() => speakCard(data.phrase.de, 'phrase')} style={speakBtnSt} title="Anhören">
                  {speaking === 'phrase' ? <SpeakerIcon /> : <SpeakerQuietIcon />}
                </button>
              </div>
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 14, color: '#e2e8f0', lineHeight: 1.5 }}>{q.prompt}</div>
                <button onClick={() => speakCard(q.prompt, 'prompt')} style={speakBtnSt} title="Frage vorlesen">
                  {speaking === 'prompt' ? <SpeakerIcon /> : <SpeakerQuietIcon />}
                </button>
              </div>
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
                  background: result.correct ? 'rgba(59,130,246,0.12)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${result.correct ? 'var(--accent)55' : '#ef444455'}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: result.correct ? 'var(--accent)' : '#f87171' }}>
                    {result.correct ? '✓ Richtig' : '✗ Nochmal üben'}
                  </div>
                  {!result.correct && result.expected && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <div style={{ fontSize: 12, color: '#cbd5e1' }}>Lösung: <b style={{ color: '#e2e8f0' }}>{result.expected}</b></div>
                      <button onClick={() => speakCard(result.expected, 'answer')} style={speakBtnSt} title="Lösung anhören">
                        {speaking === 'answer' ? <SpeakerIcon /> : <SpeakerQuietIcon />}
                      </button>
                    </div>
                  )}
                  {(result.note || result.note_ar) && (
                    <div style={{ fontSize: 11, color: 'var(--action)', marginTop: 4,
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

              {/* (Daily shadow step removed — it used the browser SpeechRecognition grader, which could
                   disagree with the standalone SHADOWING drill's reliable server Whisper grader on the
                   same repeat. Shadowing now lives in ONE place, with the trustworthy grader.) */}

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
// minWidth/minHeight 44 = the mobile touch-target floor — these are tap-mid-drill buttons.
const cueBtn = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', padding: '4px 9px', minWidth: 44, minHeight: 44, borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid rgba(59,130,246,0.35)', background: 'rgba(59,130,246,0.07)', color: 'var(--accent-dim)' };
const primary = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', padding: '11px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--warn)', color: '#04070d', background: 'linear-gradient(135deg, var(--action), var(--warn))' };
const ghost = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, padding: '7px 11px', minWidth: 44, minHeight: 44, borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)' };
const errBox = { margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8, fontSize: 11, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' };
const speakBtnSt = { flexShrink: 0, fontSize: 14, padding: '2px 5px', minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid rgba(59,130,246,0.25)', background: 'rgba(59,130,246,0.06)', color: 'var(--accent-dim)', lineHeight: 1 };
