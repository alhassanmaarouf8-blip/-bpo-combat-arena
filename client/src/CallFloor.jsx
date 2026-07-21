/**
 * CallFloor.jsx — Mode 2's standalone client (Der Anruf-Floor). Reached ONLY via ?callfloor
 * (main.jsx branch — the shipped ?feedback pattern); the protected home/App is untouched.
 * Server flag CALLFLOOR_ENABLED=1 is the kill switch: with it off every API call 404s and this
 * screen shows the honest "nicht verfügbar" state.
 *
 * Design law: dark shell, blue + ONE orange object per screen, real SVG (no emoji chrome),
 * 44px targets, primitives-only buttons. All Arabic = OWNER-AR slots (German renders until the
 * owner fills them server-side).
 */
import { useEffect, useRef, useState } from 'react';
import { API_URL } from './config.js';
import { ClipRecorder } from './clipRecorder.js';
import { playNative } from './nativeVoice.js';
import { actionBtn, ghostBtn, cardSurface, screenTitle } from './ui/primitives.js';

const token = () => localStorage.getItem('bpo_token');

// The customer's mood, drawn — 1 (angry) … 5 (happy). Stroke SVG, currentColor, no emoji.
function MoodFace({ mood = 3, size = 72 }) {
  const m = Math.max(1, Math.min(5, Number(mood) || 3));
  const browTilt = [14, 8, 0, -2, -4][m - 1];
  const mouth = [
    'M 22 46 Q 32 38 42 46',      // 1: deep frown
    'M 22 45 Q 32 40 42 45',      // 2: frown
    'M 23 44 L 41 44',            // 3: flat
    'M 22 42 Q 32 48 42 42',      // 4: smile
    'M 21 41 Q 32 52 43 41',      // 5: big smile
  ][m - 1];
  const color = m <= 2 ? 'var(--bad)' : m === 3 ? '#7d93b8' : 'var(--accent, #3b82f6)';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ color, transition: 'color 400ms' }}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <line x1="19" y1={24 + browTilt / 4} x2="27" y2={24 - browTilt / 4} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="37" y1={24 - browTilt / 4} x2="45" y2={24 + browTilt / 4} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="23" cy="29" r="2.4" fill="currentColor" />
      <circle cx="41" cy="29" r="2.4" fill="currentColor" />
      <path d={mouth} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}

const api = async (path, opts = {}) => {
  const r = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

export default function CallFloor() {
  const [floor, setFloor] = useState(null);          // /state payload
  const [gate, setGate] = useState('loading');       // loading | off | noauth | ready
  const [call, setCall] = useState(null);            // live call payload
  const [phase, setPhase] = useState('idle');        // idle | customer | yourturn | sending | ended
  const [mood, setMood] = useState(3);
  const [verdict, setVerdict] = useState(null);      // {pending, result}
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(null);
  const recRef = useRef(null);
  const callRef = useRef(null);
  const stopVoiceRef = useRef(null);

  const loadFloor = async () => {
    if (!token()) { setGate('noauth'); return; }
    const { status, data } = await api('/api/callfloor/state');
    if (status === 404) { setGate('off'); return; }
    if (status === 401) { setGate('noauth'); return; }
    setFloor(data); setGate('ready');
  };
  useEffect(() => { loadFloor(); }, []);
  useEffect(() => () => { try { stopVoiceRef.current?.(); } catch {} }, []);

  const speak = (text, voice, onEnd) => {
    try { stopVoiceRef.current?.(); } catch {}
    // playNative returns a stop() function directly (nativeVoice.js contract).
    const stop = playNative({ apiUrl: API_URL, token: token(), text, voice, onEnd });
    stopVoiceRef.current = typeof stop === 'function' ? stop : null;
  };

  const startCall = async (quadrant) => {
    setErr(''); setVerdict(null);
    const { status, data } = await api('/api/callfloor/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quadrant }),
    });
    if (status === 429) { setErr(`Tageslimit erreicht — heute schon ${Math.round((data.usedSec || 0) / 60)} Min. telefoniert.`); return; }
    if (status !== 200) { setErr('Anruf konnte nicht gestartet werden.'); return; }
    callRef.current = data; setCall(data); setMood(data.mood);
    if (data.opening?.text) {
      setPhase('customer');
      speak(data.opening.text, data.scenario.voice, () => setPhase('yourturn'));
    } else {
      setPhase('yourturn');   // inbound: YOU answer the ringing phone — greet the customer
    }
  };

  const record = async () => {
    setErr('');
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); } catch { setErr('Mikrofon nicht verfügbar.'); return; }
    recRef.current = rec; setPhase('recording');
  };

  const sendTurn = async () => {
    const rec = recRef.current; if (!rec) return;
    recRef.current = null;
    let clip; try { clip = await rec.stop(); } catch { setErr('Aufnahme fehlgeschlagen.'); setPhase('yourturn'); return; }
    if (!clip?.blob || clip.blob.size < 1200) { setErr('Nichts aufgenommen — sprich bitte.'); setPhase('yourturn'); return; }
    setPhase('sending');
    const c = callRef.current;
    const r = await fetch(`${API_URL}/api/callfloor/session/${encodeURIComponent(c.sessionId)}/turn`, {
      method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'audio/wav' }, body: clip.blob,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 422) { setErr('Nichts gehört — sprich bitte deutlich.'); setPhase('yourturn'); return; }
    if (!r.ok) { setErr('Verbindung gestört — versuch es nochmal.'); setPhase('yourturn'); return; }
    if (data.customer?.text) {
      setMood(data.mood);
      setPhase('customer');
      speak(data.customer.text, c.scenario.voice, () => {
        if (data.forceEnd) endCall(); else setPhase('yourturn');
      });
    } else if (data.forceEnd) endCall();
  };

  const endCall = async () => {
    const c = callRef.current; if (!c) return;
    setPhase('ended'); setVerdict({ pending: true });
    const { data } = await api(`/api/callfloor/session/${encodeURIComponent(c.sessionId)}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (data.pending) pollResult(c.sessionId);
    else setVerdict({ pending: false, result: data.result, satisfactionFinal: data.satisfactionFinal });
  };

  const pollResult = async (id, tries = 0) => {
    if (tries > 20) { setVerdict({ pending: false, failed: true }); return; }
    const { data } = await api(`/api/callfloor/session/${encodeURIComponent(id)}/result`);
    if (data.pending) { setTimeout(() => pollResult(id, tries + 1), 3000); return; }
    setVerdict({ pending: false, result: data.result, failed: data.failed && !data.result });
  };

  const shell = (children) => (
    <div dir="ltr" style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: 'var(--bg, #04070d)',
      color: '#e2e8f0', padding: '20px 16px 48px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>{children}</div>
    </div>
  );

  if (gate === 'loading') return shell(<div style={{ opacity: 0.7, padding: 40, textAlign: 'center' }}>Lädt…</div>);
  if (gate === 'off') return shell(
    <div style={{ ...cardSurface, padding: 24, textAlign: 'center', marginTop: 60 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Der Anruf-Floor ist noch nicht freigeschaltet.</div>
      <a href="/" style={{ color: 'var(--accent, #3b82f6)' }}>Zurück zur App</a>
    </div>);
  if (gate === 'noauth') return shell(
    <div style={{ ...cardSurface, padding: 24, textAlign: 'center', marginTop: 60 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Bitte zuerst in der App anmelden.</div>
      <a href="/" style={{ color: 'var(--accent, #3b82f6)' }}>Zur App</a>
    </div>);

  // ── Verdict screen ──────────────────────────────────────────────────────────────────────────
  if (verdict) {
    const r = verdict.result;
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 14 }}>ANRUF BEENDET{/* OWNER-AR slot */}</div>
      {verdict.pending && <div style={{ ...cardSurface, padding: 20, textAlign: 'center' }}>Auswertung läuft…</div>}
      {!verdict.pending && !r && <div style={{ ...cardSurface, padding: 20 }}>
        Die Auswertung ist gerade nicht verfügbar. Deine Fehler fließen trotzdem in deine Diagnose ein.</div>}
      {r && <>
        <div style={{ ...cardSurface, padding: 18, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <MoodFace mood={r.satisfactionFinal ?? mood} size={64} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>
              {r.resolved === true ? 'Anliegen gelöst' : r.resolved === false ? 'Anliegen nicht gelöst' : 'Ergebnis nicht bewertbar'}
            </div>
            <div style={{ opacity: 0.75, fontSize: 14, marginTop: 3 }}>
              {Math.floor((r.handleSeconds || 0) / 60)}:{String((r.handleSeconds || 0) % 60).padStart(2, '0')} Min ·
              Kundenstimmung am Ende: {(r.satisfactionFinal ?? '–')}/5
            </div>
            {typeof r.meta?.overall === 'number' &&
              <div style={{ opacity: 0.75, fontSize: 14 }}>Gesamteindruck: {r.meta.overall}/100</div>}
          </div>
        </div>
        {r.meta?.summaryDe && <div style={{ ...cardSurface, padding: 16, marginBottom: 12, fontSize: 14.5, lineHeight: 1.5 }}>{r.meta.summaryDe}</div>}
        {(r.skills || []).map((s) => (
          <div key={s.key} style={{ ...cardSurface, padding: 14, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{s.key.replace(/_/g, ' ')}</span>
              <span style={{ color: s.score >= 4 ? 'var(--accent, #3b82f6)' : s.score <= 2 ? 'var(--bad)' : '#7d93b8' }}>{s.score}/5</span>
            </div>
            {s.why_de && <div style={{ opacity: 0.75, fontSize: 13.5, marginTop: 4 }}>{s.why_de}</div>}
            {s.quote && <div style={{ opacity: 0.6, fontSize: 13, marginTop: 4, fontStyle: 'italic' }}>„{s.quote}"</div>}
          </div>
        ))}
      </>}
      <button style={{ ...actionBtn, width: '100%', marginTop: 16, minHeight: 48 }}
        onClick={() => { setCall(null); setVerdict(null); setPhase('idle'); setPicked(null); loadFloor(); }}>
        NÄCHSTER ANRUF
      </button>
    </>);
  }

  // ── Live call screen ────────────────────────────────────────────────────────────────────────
  if (call) {
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 6 }}>{call.scenario.title_de}</div>
      <div style={{ opacity: 0.75, fontSize: 14, marginBottom: 18 }}>{call.scenario.brief_de}</div>
      <div style={{ ...cardSurface, padding: 22, textAlign: 'center', marginBottom: 16 }}>
        <MoodFace mood={mood} size={84} />
        <div style={{ fontWeight: 600, marginTop: 8 }}>{call.scenario.customerName}</div>
        <div style={{ opacity: 0.7, fontSize: 14, marginTop: 6, minHeight: 20 }}>
          {phase === 'customer' && 'spricht…'}
          {phase === 'yourturn' && 'wartet auf dich.'}
          {phase === 'recording' && 'hört zu — sprich jetzt.'}
          {phase === 'sending' && '…'}
        </div>
      </div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 14, marginBottom: 10 }}>{err}</div>}
      {phase === 'yourturn' &&
        <button style={{ ...actionBtn, width: '100%', minHeight: 52, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center' }} onClick={record}>
          <MicIcon /> ANTWORTEN
        </button>}
      {phase === 'recording' &&
        <button style={{ ...actionBtn, width: '100%', minHeight: 52 }} onClick={sendTurn}>FERTIG — SENDEN</button>}
      {(phase === 'customer' || phase === 'sending') &&
        <button style={{ ...ghostBtn, width: '100%', minHeight: 48, opacity: 0.5 }} disabled>…</button>}
      <button style={{ ...ghostBtn, width: '100%', marginTop: 10, minHeight: 44 }} onClick={endCall}>AUFLEGEN</button>
    </>);
  }

  // ── The floor (quadrant picker) ─────────────────────────────────────────────────────────────
  const usedMin = Math.round((floor?.usedTodaySec || 0) / 60);
  const limitMin = Math.round((floor?.dailyLimitSec || 600) / 60);
  return shell(<>
    <div style={{ ...screenTitle, marginBottom: 4 }}>DER ANRUF-FLOOR{/* OWNER-AR slot */}</div>
    <div style={{ opacity: 0.75, fontSize: 14, marginBottom: 16 }}>
      Echte Anrufe, echte Kunden-Typen — dein Training für den Job. Heute: {usedMin}/{limitMin} Min.
    </div>
    {(floor?.quadrants || []).map((q) => (
      <button key={q.id}
        style={{ ...ghostBtn, width: '100%', textAlign: 'left', padding: 14, marginBottom: 8, minHeight: 56,
          borderColor: picked === q.id ? 'var(--accent, #3b82f6)' : undefined }}
        onClick={() => setPicked(q.id)}>
        <div style={{ fontWeight: 600 }}>{q.label_ar || q.label_de}</div>
        <div style={{ opacity: 0.7, fontSize: 13, marginTop: 2 }}>{q.skill_de}</div>
      </button>
    ))}
    {err && <div style={{ color: 'var(--bad)', fontSize: 14, margin: '8px 0' }}>{err}</div>}
    <button style={{ ...actionBtn, width: '100%', marginTop: 10, minHeight: 52, opacity: picked ? 1 : 0.45 }}
      disabled={!picked} onClick={() => startCall(picked)}>
      {picked?.startsWith('outbound') ? 'ANRUFEN' : 'ANRUF ANNEHMEN'}
    </button>
    <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 18, color: '#7d93b8', fontSize: 14 }}>Zurück zur App</a>
  </>);
}
