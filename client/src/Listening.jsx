/**
 * Listening.jsx — LISTENING + LIVE DATA-CAPTURE drill (PAID). "The interview in reverse."
 *
 * A NATIVE Aura-2 voice speaks a natural German line at full speed through the phone-band filter
 * (playNative — the robotic browser voice is banned app-wide, owner rule 2026-07-02). The learner
 * NEVER sees the text — they must catch the detail (number/name/date/amount) by EAR and TYPE it.
 * Grading is deterministic on the server (no model). Trains the #1 thing that gets candidates
 * rejected: understanding a fast native speaker and capturing data correctly. Zero added cost.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { actionBtn, ghostBtn, ghostBtnWide } from './ui/primitives.js';
import { SpeakerIcon } from './icons/AudioIcons';
import { SalmaTutorPanel, useSalmaDrillSession } from './SalmaTutorPanel.jsx';
import { reportDrillEvent } from './salmaCoachClient.js';
import { playNative } from './nativeVoice.js';
import { DrillIntro } from './drillIntros.jsx';
import { useAccessibleOverlay } from './useAccessibleOverlay.js';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

export function Listening({ token, apiUrl, lang = 'de', onClose, onGoPricing, why = null }) {
  const overlayProps = useAccessibleOverlay(onClose, 'Hör-Check');
  const tutorSession = useSalmaDrillSession(token, 'hoer-check');
  const [phase, setPhase] = useState('loading'); // loading | practice | done | error
  const [items, setItems] = useState([]);
  const [baseRate, setBaseRate] = useState(1.0);  // level-scaled base speed from the server
  const [opaqueMedia, setOpaqueMedia] = useState(false);
  const [idx, setIdx]     = useState(0);
  const [played, setPlayed] = useState(0);        // how many times current item was played
  const [playing, setPlaying] = useState(false);  // ticket/audio startup in progress
  const [response, setResponse] = useState('');
  const [busy, setBusy]   = useState(false);
  const [result, setResult] = useState(null);     // { correct, expected }
  const [ttsOk, setTtsOk] = useState(true);
  const [err, setErr]     = useState(null);
  const inputRef = useRef(null);
  const closeRef = useRef(onClose);
  const pricingRef = useRef(onGoPricing);

  // Parent renders must never restart an active listening set. Keep the latest navigation
  // callbacks behind stable refs so `load` remains tied only to the account/API identity.
  useEffect(() => {
    closeRef.current = onClose;
    pricingRef.current = onGoPricing;
  }, [onClose, onGoPricing]);

  const blocked = useCallback(() => { pricingRef.current?.(); closeRef.current?.(); }, []);

  const load = useCallback(async () => {
    setPhase('loading'); setErr(null); setResult(null); setIdx(0); setResponse(''); setPlayed(0); setPlaying(false); setTtsOk(true); setOpaqueMedia(false);
    try {
      // Unique URL + no-store so the browser can NEVER serve a cached set → fresh items every open/round.
      const r = await fetch(`${apiUrl}/api/listening?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, 'X-Listening-Media-Version': '2' },
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.items) || !d.items.length) throw new Error('load_failed');
      if (typeof d.baseRate === 'number') setBaseRate(d.baseRate);
      setOpaqueMedia(d.mediaMode === 'opaque_v2');
      setItems(d.items); setPhase('practice');
    } catch {
      setErr({ de: 'Konnte die Übung nicht laden. Bitte erneut.', ar: 'مقدرناش نحمّل التمرين. حاول تاني.' });
      setPhase('error');
    }
  }, [apiUrl, token, blocked]);

  useEffect(() => { load(); }, [load]);

  const item = items[idx];
  const maxPlays = (item?.replays ?? 1) + 1;   // initial play + N replays
  const canPlay  = played < maxPlays && !result && !playing;

  // Keep the stop handle so closing the drill (or replaying) actually SILENCES the caller —
  // an orphaned line talking over the next screen reads as a bug.
  const stopVoiceRef = useRef(null);
  const activePlayRef = useRef(null);
  useEffect(() => () => {
    try { stopVoiceRef.current?.(); } catch { /* ignore */ }
    const active = activePlayRef.current;
    if (active) fetch(`${apiUrl}/api/listening/play/complete`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...active, completed: false }),
    }).catch(() => {});
  }, [apiUrl, token]);

  const play = async () => {
    if (!item || !canPlay) return;
    setPlaying(true);
    setTtsOk(true);
    let playNumber = null;
    try {
      const authorization = await fetch(`${apiUrl}/api/listening/play`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id }),
      });
      const body = await authorization.json().catch(() => ({}));
      if (!authorization.ok || !Number.isInteger(body.playNumber)) throw new Error(body.error || 'play_not_authorized');
      playNumber = body.playNumber;
      activePlayRef.current = { id: item.id, playNumber };
    } catch {
      setPlaying(false);
      setTtsOk(false);
      return;
    }
    const completePlayback = async (completed) => {
      try {
        // The server records successful media delivery only after the exact audio response has fully
        // finished. `onEnd` can beat a slow durable-store write by a few milliseconds, so retry only
        // that narrow pending-receipt state. A failed/aborted audio response never creates the receipt
        // and therefore still fails closed after the bounded retries.
        const waits = [0, 120, 300, 700];
        let confirmed = false;
        for (const waitMs of waits) {
          if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
          const response = await fetch(`${apiUrl}/api/listening/play/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id: item.id, playNumber, completed }),
          });
          if (response.ok) { confirmed = true; break; }
          const body = await response.json().catch(() => ({}));
          if (completed !== true || body.error !== 'listening_media_required') break;
        }
        if (!confirmed) throw new Error('play_completion_failed');
        activePlayRef.current = null;
        if (completed) setPlayed(playNumber);
        setPlaying(false);
        setTtsOk(completed);
      } catch {
        activePlayRef.current = null;
        setPlaying(false);
        setTtsOk(false);
      }
    };
    // Level-scaled base speed (beginner slower, advanced faster) + progressive overload within the
    // session (each item faster than the last), so you train catching a native at YOUR edge.
    // Native Aura-2 caller voice; the level+overload speed ramp still applies via audio playbackRate.
    // (No browser-voice fallback — robotic voice is banned app-wide; on TTS failure it stays silent.)
    // phone:true → route the caller through a telephone-band filter. The job is on the PHONE, so clean
    // studio audio over-prepares on the wrong channel. Shadowing stays clean; only this caller line is phoned.
    try { stopVoiceRef.current?.(); } catch { /* ignore */ }
    // Each item carries its own server-assigned Aura-2 German voice (a different human per caller —
    // real inbound work is a parade of voices). Older payloads without `voice` use the default.
    stopVoiceRef.current = playNative({
      apiUrl,
      token,
      ...(opaqueMedia
        ? { ticketRequest: { listeningRef: { id: item.id, playNumber } } }
        : { text: item.audioText, voice: item.voice || undefined }),
      rate: Math.min(1.7, baseRate + idx * 0.12),
      phone: true,
      onStart: () => setTtsOk(true),
      onError: () => {
        completePlayback(false);
      },
      onEnd: () => completePlayback(true),
    });
  };

  const submit = async (explicit) => {
    const resp = explicit != null ? String(explicit) : response;   // MCQ passes the chosen index directly (no stale state)
    if (resp.trim() === '' || busy || result || playing || played === 0) return;
    if (explicit != null) setResponse(resp);                        // remember the choice for the result highlight
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/listening/grade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, response: resp }),
      });
      if (r.status === 402) { blocked(); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'grade_failed');
      const coachCue = await reportDrillEvent({ apiUrl, token, event: {
        drill: 'hoer-check', evidenceReceipt: d.evidenceReceipt,
      } });
      setResult({ ...d, ...(coachCue ? { coachCue } : {}) });
    } catch {
      setErr({ de: 'Konnte nicht prüfen. Bitte erneut.', ar: 'مقدرناش نصحّح. حاول تاني.' });
    }
    setBusy(false);
  };

  const next = () => {
    try { stopVoiceRef.current?.(); } catch { /* ignore */ }
    setResult(null); setResponse(''); setPlayed(0); setPlaying(false); setTtsOk(true); setErr(null);
    if (idx < items.length - 1) setIdx(idx + 1);
    else {
      // Feed the brain: a completed Hör-Check set is listening prep (per-answer accuracy already
      // lands in listeningStats server-side; this event is what flips the brain's prep/READY).
      setPhase('done');
    }
  };

  const shell = (children) => (
    <div {...overlayProps} style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, var(--bg-2) 0%, var(--bg-0) 65%)',
      color: 'var(--text)', padding: '20px 16px 32px', boxSizing: 'border-box', animation: 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (
    <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, letterSpacing: '0.02em', color: 'var(--text)' }}>
        HÖR-CHECK · فهم السمع
      </span>
      <button onClick={onClose} style={ghostBtn}>{T(lang, 'Schließen', 'إغلاق')}</button>
    </div>
    {/* WHY-YOU framing: set only when the brain/debrief prescribed this drill (owner law 5). */}
    {why && (
      <div style={{ margin: '0 0 12px', padding: '9px 11px', borderRadius: 8, fontSize: 12, lineHeight: 1.55,
        color: 'var(--text-dim)', background: 'var(--surface-2)', border: '1px solid var(--line-strong)', textAlign: 'left' }}>
        {why}
      </div>
    )}
    </>
  );

  if (phase === 'loading') return shell(<>{header}
    <div style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{T(lang, 'Hör-Übungen werden erstellt …', 'بنجهّزلك تمارين استماع …')}</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{T(lang, 'Frische Anrufe für dich — einen Moment.', 'مكالمات جديدة ليك — لحظة واحدة.')}</div>
      <div style={{ marginTop: 18, fontSize: 22, letterSpacing: 6, color: 'var(--accent-2)', animation: 'pulse 1.2s infinite' }}>● ● ●</div>
    </div></>);

  if (phase === 'error') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '30px 0' }}>
      <div style={{ fontSize: 36 }}>⚠</div>
      <div style={{ fontSize: 13, color: 'var(--bad)', lineHeight: 1.6, marginTop: 8 }}>{err?.de}<br /><span dir="rtl">{err?.ar}</span></div>
      <button onClick={load} style={{ ...actionBtn, marginTop: 18 }}>{T(lang, 'Erneut', 'حاول تاني')}</button>
    </div>
  </>);

  if (phase === 'done') return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '26px 0' }}>
      <div style={{ fontSize: 40 }}>✅</div>
      <div style={{ fontSize: 16, color: 'var(--text)', fontWeight: 700, marginTop: 8 }}>{T(lang, 'Geschafft!', 'خلّصت!')}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.6 }}>
        {T(lang, 'Verstehen am Telefon ist die halbe Miete im echten Job.', 'إنك تفهم في التليفون ده نص الشغل الحقيقي.')}
      </div>
      <button onClick={load} style={{ ...actionBtn, marginTop: 18 }}>{T(lang, 'Neue Runde', 'جولة جديدة')} ▸</button>
      <button onClick={onClose} style={{ ...ghostBtnWide, marginTop: 10, width: '100%' }}>{T(lang, 'Fertig', 'تمام')}</button>
    </div>
  </>);

  // PRACTICE
  return shell(<>
    {header}
    <DrillIntro drillKey="listening" />
    <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-display)', letterSpacing: '0.1em', marginBottom: 8 }}>
      {T(lang, 'ANRUF', 'مكالمة')} {idx + 1} / {items.length}
    </div>
    <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
      {items.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < idx ? 'var(--accent)' : i === idx ? 'var(--action)' : 'var(--surface-2)' }} />
      ))}
    </div>

    {/* Play card — NO text shown; the whole point is to catch it by ear */}
    <div style={{ padding: '16px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line-strong)', textAlign: 'center' }}>
      <button onClick={play} disabled={!canPlay} style={{ ...actionBtn, opacity: canPlay ? 1 : 0.45, cursor: canPlay ? 'pointer' : 'default' }}>
        <SpeakerIcon style={{ marginRight: 6 }} /> {playing
          ? T(lang, 'Audio wird vorbereitet…', 'بنجهّز الصوت…')
          : (played === 0 ? T(lang, 'Anruf abspielen', 'شغّل المكالمة') : T(lang, `Nochmal (${maxPlays - played} übrig)`, `كمان مرة (فاضل ${maxPlays - played})`))}
      </button>
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 10, lineHeight: 1.5 }}>
        {T(lang, 'Echtes Tempo. Hör genau hin — du siehst den Text nicht.', 'سرعة حقيقية. ركّز كويس — مش هتشوف النص.')}
      </div>
      {!ttsOk && (
        <div style={{ fontSize: 10, color: 'var(--action)', marginTop: 8 }}>
          {T(lang, 'Sprachausgabe in diesem Browser nicht verfügbar.', 'تشغيل الصوت مش متاح في المتصفح ده.')}
        </div>
      )}
    </div>

    {/* Question + capture input */}
    {played > 0 && (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, marginBottom: 8, ...(lang === 'ar' ? { direction: 'rtl', textAlign: 'right' } : {}) }}>
          {T(lang, item.question_de, item.question_ar)}
        </div>
        {item.kind === 'verstehen' ? (
          // COMPREHENSION: pick the meaning (MCQ). Clicking an option grades it immediately.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(item.options || []).map((o, oi) => {
              const chose   = result && Number(response) === oi;
              const isRight = result && result.correctIndex === oi;
              return (
                <button key={oi} disabled={busy || playing || !!result} onClick={() => submit(oi)}
                  style={{ textAlign: lang === 'ar' ? 'right' : 'left', direction: lang === 'ar' ? 'rtl' : 'ltr',
                    padding: '11px 13px', borderRadius: 9, fontSize: 13.5, cursor: result ? 'default' : 'pointer', color: 'var(--text)',
                    background: result && isRight ? 'rgba(34,197,94,0.12)' : (result && chose ? 'rgba(239,68,68,0.1)' : 'var(--surface-2)'),
                    border: `1px solid ${result ? (isRight ? 'rgba(34,197,94,0.6)' : (chose ? 'rgba(239,68,68,0.6)' : 'var(--line)')) : 'rgba(148,163,184,0.35)'}` }}>
                  {result && isRight ? '✓ ' : ''}{T(lang, o.de, o.ar)}
                </button>
              );
            })}
          </div>
        ) : (
          <input ref={inputRef} value={response} onChange={(e) => setResponse(e.target.value)} disabled={playing || !!result}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={T(lang, 'Tippe, was du gehört hast…', 'اكتب اللي سمعته…')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: 9, fontSize: 15,
              background: 'var(--surface-2)', border: '1px solid rgba(148,163,184,0.35)', color: 'var(--text)', outline: 'none' }} />
        )}
      </div>
    )}

    {err && (
      <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 11, color: 'var(--bad)' }}>
        {err.de}<br /><span dir="rtl">{err.ar}</span>
      </div>
    )}

    {/* Result */}
    {result ? (
      <>
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 11,
          background: result.correct ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${result.correct ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
          <div style={{ fontSize: 13.5, color: result.correct ? 'var(--accent-2)' : 'var(--bad)', fontWeight: 700 }}>
            {result.correct
              ? (item.kind === 'verstehen' ? T(lang, '✓ Richtig verstanden!', '✓ فهمتها صح!') : T(lang, '✓ Richtig erfasst!', '✓ صح كده!'))
              : T(lang, '✗ Nicht ganz', '✗ مش مظبوط')}
          </div>
          {/* comprehension already highlights the right option green; only the detail path needs the answer echoed */}
          {!result.correct && item.kind !== 'verstehen' && (
            <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 6 }}>
              {T(lang, 'Richtig war: ', 'الصح كان: ')}<b style={{ color: 'var(--action)' }}>{result.expected}</b>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!result.correct && <button onClick={() => { setResult(null); setResponse(''); setPlayed(0); setPlaying(false); setTtsOk(true); }} style={ghostBtnWide}>{T(lang, 'Nochmal hören', 'اسمع تاني')}</button>}
          <button onClick={next} style={{ ...actionBtn, flex: 1 }}>
            {idx < items.length - 1 ? T(lang, 'Weiter ▸', 'التالي ▸') : T(lang, 'Fertig ▸', 'خلصت ▸')}
          </button>
        </div>
      </>
    ) : (played > 0 && item.kind !== 'verstehen') ? (
      <button onClick={() => submit()} disabled={busy || !response.trim()} style={{ ...actionBtn, marginTop: 12, opacity: (busy || !response.trim()) ? 0.5 : 1 }}>
        {busy ? T(lang, 'Prüfe…', 'بصحّح…') : T(lang, 'Antwort prüfen', 'صحّح الإجابة')}
      </button>
    ) : null}
    {result && !busy && !playing && <SalmaTutorPanel token={token} apiUrl={apiUrl} screen="drill" drillId="hoer-check" initialCue={result.coachCue} drillSession={tutorSession} />}
  </>);
}

