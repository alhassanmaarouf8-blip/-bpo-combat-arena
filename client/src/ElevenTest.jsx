/**
 * ElevenTest.jsx — ISOLATED ElevenLabs voice test (open with ?elevenlabs).
 *
 * Does NOT touch the interview/fight code. Lets the owner test the raw ElevenLabs full-duplex German
 * voice on his real device before we wire it into the app. Gets a signed URL from the owner-allowlisted
 * /api/eleven/session, then runs a live conversation via the @elevenlabs/react SDK (mic + turn-taking
 * + playback all handled by the SDK).
 */
import { useState, useCallback, useRef } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';

// v1.10 requires useConversation to live under a <ConversationProvider>. Wrap it (default export below).
function ElevenInner({ apiUrl }) {
  const [status, setStatus] = useState('idle');   // idle | connecting | connected | ended
  const [lines, setLines]   = useState([]);
  const [err, setErr]       = useState('');
  const [debrief, setDebrief]           = useState(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  const fullRef  = useRef([]);   // full transcript (uncapped) → fed to the real feedback pipeline
  const startMsRef = useRef(0);

  const conv = useConversation({
    onConnect:    () => { startMsRef.current = Date.now(); setStatus('connected'); },
    onDisconnect: () => setStatus('ended'),
    onError:      (e) => setErr(String(e?.message || e)),
    onMessage:    (m) => {
      if (!m?.message) return;
      fullRef.current.push({ who: m.source, text: m.message });
      setLines((ls) => [...ls, { who: m.source, text: m.message }].slice(-14));
    },
  });

  // End-of-interview: run the app's REAL feedback pipeline on the accurate ElevenLabs transcript (MUST #2).
  const fetchDebrief = useCallback(async () => {
    const full = fullRef.current;
    if (!full || full.filter((l) => l.who === 'user').length === 0) return;
    setDebriefLoading(true);
    try {
      const token = localStorage.getItem('bpo_token') || '';
      const speechMs = startMsRef.current ? (Date.now() - startMsRef.current) : 0;
      const r = await fetch(`${apiUrl}/api/eleven/debrief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transcript: full, level: 'a2-b1', speechMs }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j) setDebrief(j); else setErr(`debrief ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
    } catch (e) { setErr('debrief: ' + String(e?.message || e)); }
    finally { setDebriefLoading(false); }
  }, [apiUrl]);

  const start = useCallback(async () => {
    setErr(''); setLines([]); setStatus('connecting');
    try {
      const token = localStorage.getItem('bpo_token') || '';
      const r = await fetch(`${apiUrl}/api/eleven/session`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.signedUrl) { setErr(`session ${r.status}: ${JSON.stringify(j).slice(0, 200)}`); setStatus('idle'); return; }
      await conv.startSession({ signedUrl: j.signedUrl, connectionType: 'websocket', overrides: j.overrides });
    } catch (e) { setErr(String(e?.message || e)); setStatus('idle'); }
  }, [apiUrl, conv]);

  const stop = useCallback(() => { try { conv.endSession(); } catch { /* already ended */ } setStatus('ended'); fetchDebrief(); }, [conv, fetchDebrief]);

  const speaking = conv.isSpeaking;
  const active = status === 'connected';

  return (
    <div style={{ minHeight: '100vh', background: '#04070d', color: '#e2e8f0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui,sans-serif', gap: 20 }}>
      <div style={{ fontSize: 12, letterSpacing: '0.22em', color: '#3b82f6', fontWeight: 700 }}>ELEVENLABS · VOICE-TEST</div>
      <div aria-hidden style={{ width: 116, height: 116, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `3px solid ${speaking ? '#f97316' : active ? '#3b82f6' : '#334155'}`,
        boxShadow: speaking ? '0 0 34px #f9731688' : active ? '0 0 24px #3b82f688' : 'none',
        transition: 'all .3s', fontSize: 46 }}>{speaking ? '🔊' : active ? '🎙' : '⏸'}</div>
      <div style={{ fontSize: 14, color: active ? '#3b82f6' : '#94a3b8', minHeight: 20 }}>
        {status === 'idle' ? 'Bereit' : status === 'connecting' ? 'Verbinde…'
          : status === 'connected' ? (speaking ? 'YASMIN SPRICHT' : 'DU BIST DRAN — sprich Deutsch') : 'Beendet'}
      </div>
      {status !== 'connected' ? (
        <button onClick={start} disabled={status === 'connecting'} style={{ padding: '14px 32px', fontSize: 16, fontWeight: 700,
          borderRadius: 12, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#fff', opacity: status === 'connecting' ? 0.6 : 1 }}>
          ▶ Gespräch starten
        </button>
      ) : (
        <button onClick={stop} style={{ padding: '14px 32px', fontSize: 16, fontWeight: 700, borderRadius: 12,
          border: '1px solid #ef4444', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }}>
          ■ Beenden
        </button>
      )}
      {err && <div style={{ maxWidth: 440, fontSize: 12, color: '#fca5a5', background: '#1a0a0a', padding: 12, borderRadius: 8, wordBreak: 'break-word' }}>⚠ {err}</div>}
      <div style={{ width: '100%', maxWidth: 460 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: 13, color: l.who === 'user' ? '#60a5fa' : '#e2e8f0', padding: '3px 0' }}>
            <b style={{ opacity: 0.6 }}>{l.who === 'user' ? 'Du' : 'Yasmin'}:</b> {l.text}
          </div>
        ))}
      </div>
      {(debriefLoading || debrief) && (
        <div style={{ width: '100%', maxWidth: 460, marginTop: 14, padding: 16, borderRadius: 12,
          background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.14em', color: '#3b82f6', fontWeight: 700, marginBottom: 10 }}>DEIN FEEDBACK</div>
          {debriefLoading && !debrief && <div style={{ fontSize: 13, color: '#94a3b8' }}>Analysiere dein Deutsch… dein echtes Feedback wird berechnet.</div>}
          {debrief && (
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              {debrief.rank && <div style={{ marginBottom: 8 }}><b>Niveau:</b> {debrief.rank}{debrief.verdict ? ` · ${debrief.verdict}` : ''}</div>}
              {debrief.metrics && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>{debrief.metrics.words} Wörter · {debrief.metrics.wpm} WpM · {debrief.metrics.connectorHits} Konnektoren · {debrief.metrics.fillers} Füllwörter</div>}
              {Array.isArray(debrief.strengths) && debrief.strengths.length > 0 && (
                <div style={{ marginBottom: 8 }}><b style={{ color: '#4ade80' }}>Stärken:</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{debrief.strengths.slice(0, 3).map((s, i) => <li key={i}>{typeof s === 'string' ? s : (s.text || s.title || '')}</li>)}</ul></div>
              )}
              {Array.isArray(debrief.grammar) && debrief.grammar.length > 0 && (
                <div style={{ marginBottom: 8 }}><b style={{ color: '#f97316' }}>Grammatik:</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{debrief.grammar.slice(0, 3).map((g, i) => <li key={i}>{g.rule || g.explanation || ''}{g.examples?.[0] ? ` — „${g.examples[0].wrong}“ → „${g.examples[0].right}“` : ''}</li>)}</ul></div>
              )}
              {Array.isArray(debrief.studyNext) && debrief.studyNext.length > 0 && (
                <div><b style={{ color: '#3b82f6' }}>Als Nächstes:</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{debrief.studyNext.slice(0, 3).map((s, i) => <li key={i}>{s.detail || s.title || (typeof s === 'string' ? s : '')}</li>)}</ul></div>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ fontSize: 11, color: '#475569', marginTop: 8, textAlign: 'center', maxWidth: 320 }}>
        Sprich wie in einem echten Telefongespräch. Achte darauf, wie schnell &amp; natürlich es sich anfühlt — und ob es dich je unterbricht.
      </div>
    </div>
  );
}

export default function ElevenTest({ apiUrl }) {
  return (
    <ConversationProvider>
      <ElevenInner apiUrl={apiUrl} />
    </ConversationProvider>
  );
}
