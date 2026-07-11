/**
 * ElevenTest.jsx — ISOLATED ElevenLabs voice test (open with ?elevenlabs).
 *
 * Does NOT touch the interview/fight code. Lets the owner test the raw ElevenLabs full-duplex German
 * voice on his real device before we wire it into the app. Gets a signed URL from the owner-allowlisted
 * /api/eleven/session, then runs a live conversation via the @elevenlabs/react SDK (mic + turn-taking
 * + playback all handled by the SDK).
 */
import { useState, useCallback } from 'react';
import { useConversation } from '@elevenlabs/react';

export default function ElevenTest({ apiUrl }) {
  const [status, setStatus] = useState('idle');   // idle | connecting | connected | ended
  const [lines, setLines]   = useState([]);
  const [err, setErr]       = useState('');

  const conv = useConversation({
    onConnect:    () => setStatus('connected'),
    onDisconnect: () => setStatus('ended'),
    onError:      (e) => setErr(String(e?.message || e)),
    onMessage:    (m) => { if (m?.message) setLines((ls) => [...ls, { who: m.source, text: m.message }].slice(-14)); },
  });

  const start = useCallback(async () => {
    setErr(''); setLines([]); setStatus('connecting');
    try {
      const token = localStorage.getItem('bpo_token') || '';
      const r = await fetch(`${apiUrl}/api/eleven/session`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.signedUrl) { setErr(`session ${r.status}: ${JSON.stringify(j).slice(0, 200)}`); setStatus('idle'); return; }
      await conv.startSession({ signedUrl: j.signedUrl, connectionType: 'websocket' });
    } catch (e) { setErr(String(e?.message || e)); setStatus('idle'); }
  }, [apiUrl, conv]);

  const stop = useCallback(() => { try { conv.endSession(); } catch { /* already ended */ } setStatus('ended'); }, [conv]);

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
      <div style={{ fontSize: 11, color: '#475569', marginTop: 8, textAlign: 'center', maxWidth: 320 }}>
        Sprich wie in einem echten Telefongespräch. Achte darauf, wie schnell &amp; natürlich es sich anfühlt — und ob es dich je unterbricht.
      </div>
    </div>
  );
}
