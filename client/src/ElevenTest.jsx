/**
 * ElevenTest.jsx — the ElevenLabs interview, styled like the app's fight (open with ?elevenlabs).
 *
 * ISOLATED + lazy-loaded: never touches the live fight code, and the ElevenLabs SDK stays code-split
 * (not in the main bundle). Voice + turn-taking = ElevenLabs (MUST #1); end-of-interview feedback runs
 * through the app's REAL pipeline on the accurate transcript (MUST #2). Uses the app's design tokens
 * (--accent etc.) so it reads as the same product.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';

// In-app browsers (Messenger/FB/Instagram/WeChat/Line WebView) BLOCK getUserMedia — the mic is dead by
// design (foot-gun #34). Detect and gate BEFORE the interview so the user isn't stuck with a silent mic.
const IN_APP_BROWSER = /(FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|;wv|Line\/|MicroMessenger|GSA\/)/i.test(
  typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '');

const BOSSES = [
  { id: 'yasmin', name: 'Yasmin', color: '#f59e0b' }, { id: 'karim', name: 'Karim', color: '#3b82f6' },
  { id: 'hana', name: 'Hana', color: '#a855f7' }, { id: 'tarek', name: 'Tarek', color: '#ef4444' },
  { id: 'frau-mona-adel', name: 'Frau Mona Adel', color: '#ec4899' }, { id: 'lukas', name: 'Lukas', color: '#22c55e' },
];

function HpBar({ label, value, color }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-display,system-ui)', fontSize: 9, letterSpacing: '0.12em', color: '#94a3b8', marginBottom: 3 }}>
        <span>{label}</span><span>{value}</span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, background: color, transition: 'width 0.6s var(--ease,ease)' }} />
      </div>
    </div>
  );
}

function ElevenInner({ apiUrl }) {
  const [boss, setBoss]     = useState('yasmin');
  const [status, setStatus] = useState('idle');   // idle | connecting | connected | ended
  const [lines, setLines]   = useState([]);
  const [err, setErr]       = useState('');
  const [debrief, setDebrief]               = useState(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [playerHp, setPlayerHp] = useState(100);
  const [bossHp, setBossHp]     = useState(100);
  const fullRef    = useRef([]);
  const startMsRef = useRef(0);

  const conv = useConversation({
    onConnect:    () => { startMsRef.current = Date.now(); setStatus('connected'); },
    onDisconnect: () => setStatus('ended'),
    onError:      (e) => setErr(String(e?.message || e)),
    onMessage:    (m) => {
      if (!m?.message) return;
      fullRef.current.push({ who: m.source, text: m.message });
      setLines((ls) => [...ls, { who: m.source, text: m.message }].slice(-10));
      // Per-turn HP — score each of MY answers live with the SAME scorer the fight uses.
      if (m.source === 'user') {
        const words = m.message.trim().split(/\s+/).filter(Boolean).length;
        if (words >= 3) {
          const token = localStorage.getItem('bpo_token') || '';
          fetch(`${apiUrl}/api/eleven/score`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ transcript: m.message, durationMs: Math.round((words / 2.3) * 1000), level: 'a2-b1' }),
          }).then((r) => r.json()).then((j) => {
            if (j?.scored) { setPlayerHp((hp) => Math.max(0, hp - (j.playerDmg || 0))); setBossHp((hp) => Math.max(0, hp - (j.bossDmg || 0))); }
          }).catch(() => {});
        }
      }
    },
  });

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
      if (r.ok && j) setDebrief(j);   // live per-turn HP already reflects the fight; don't overwrite it
      else setErr(`debrief ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
    } catch (e) { setErr('debrief: ' + String(e?.message || e)); }
    finally { setDebriefLoading(false); }
  }, [apiUrl]);

  const start = useCallback(async () => {
    setErr(''); setLines([]); setDebrief(null); setPlayerHp(100); setBossHp(100); setStatus('connecting');
    try {
      const token = localStorage.getItem('bpo_token') || '';
      const r = await fetch(`${apiUrl}/api/eleven/session?boss=${encodeURIComponent(boss)}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.signedUrl) { setErr(`session ${r.status}: ${JSON.stringify(j).slice(0, 200)}`); setStatus('idle'); return; }
      fullRef.current = [];
      await conv.startSession({ signedUrl: j.signedUrl, connectionType: 'websocket', overrides: j.overrides });
    } catch (e) { setErr(String(e?.message || e)); setStatus('idle'); }
  }, [apiUrl, conv, boss]);

  const stop = useCallback(() => { try { conv.endSession(); } catch { /* already ended */ } setStatus('ended'); fetchDebrief(); }, [conv, fetchDebrief]);

  // Fallback (foot-gun #8/#47): if ElevenLabs won't connect (down / capped / half-open socket), never
  // leave the user stuck — surface the error + a route to the normal interview ($0/Gemini path in the app).
  useEffect(() => {
    if (status !== 'connecting') return;
    const t = setTimeout(() => { setErr('Verbindung dauert zu lange. Du kannst das normale Interview nutzen.'); setStatus('idle'); }, 18000);
    return () => clearTimeout(t);
  }, [status]);
  const goNormal = () => { window.location.href = '/'; };

  // In-app browser → the mic can't work here; show the escape instead of a dead interview.
  if (IN_APP_BROWSER) {
    return (
      <div style={{ minHeight: '100vh', background: '#04070d', color: '#e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 16, fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ fontSize: 40 }}>🎙</div>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Öffne die Seite in Chrome</div>
        <div style={{ fontSize: 14, color: '#94a3b8', maxWidth: 340, lineHeight: 1.6 }}>
          Der In-App-Browser (Messenger/Facebook) blockiert dein Mikrofon. Kopiere den Link und öffne ihn in Chrome.
        </div>
        <button onClick={() => { try { navigator.clipboard?.writeText(window.location.href); } catch { /* clipboard blocked */ } }}
          style={{ padding: '13px 26px', fontSize: 15, fontWeight: 700, borderRadius: 12, border: 'none', cursor: 'pointer', background: 'var(--grad-action,linear-gradient(135deg,#f59e0b,#f97316))', color: '#081019' }}>
          🔗 Link kopieren
        </button>
        {/Android/i.test(navigator.userAgent || '') && (
          <a href={`intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;package=com.android.chrome;end`}
            style={{ color: 'var(--accent-2,#60a5fa)', fontWeight: 700, textDecoration: 'underline', fontSize: 14 }}>
            In Chrome öffnen →
          </a>
        )}
      </div>
    );
  }

  const speaking = conv.isSpeaking;
  const active = status === 'connected';
  const b = BOSSES.find((x) => x.id === boss) || BOSSES[0];

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(1000px 500px at 50% -10%, rgba(59,130,246,0.10), transparent 60%), #04070d',
      color: '#e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '22px 16px 40px', fontFamily: 'system-ui,sans-serif', gap: 14 }}>
      {/* stage */}
      <div style={{ width: '100%', maxWidth: 440, borderRadius: 18, padding: '18px 16px',
        background: 'linear-gradient(180deg, rgba(0,22,44,0.5), rgba(0,8,18,0.85))', border: '1px solid rgba(255,255,255,0.08)', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 12, left: 14, fontFamily: 'var(--font-display,system-ui)', fontWeight: 600, fontSize: 8.5, letterSpacing: '0.16em',
          color: 'var(--accent-2,#60a5fa)', padding: '3px 9px', borderRadius: 999, background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.35)' }}>LIVE-INTERVIEW</div>
        <div style={{ position: 'absolute', top: 12, right: 14, fontFamily: 'var(--font-display,system-ui)', fontWeight: 600, fontSize: 8.5, letterSpacing: '0.12em',
          color: b.color, padding: '3px 9px', borderRadius: 999, background: `${b.color}1a`, border: `1px solid ${b.color}55` }}>
          {speaking ? 'SPRICHT' : active ? 'HÖRT ZU' : 'BEREIT'}
        </div>
        {/* avatar */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 26, marginBottom: 14 }}>
          <div style={{ position: 'relative', width: 96, height: 96, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `radial-gradient(circle at 50% 35%, ${b.color}33, rgba(0,0,0,0.3))`,
            border: `2px solid ${b.color}`, boxShadow: speaking ? `0 0 30px ${b.color}88` : active ? `0 0 16px ${b.color}44` : 'none',
            animation: active && !speaking ? 'pulse 2.4s ease-in-out infinite' : 'none', transition: 'box-shadow 0.3s' }}>
            <span style={{ fontFamily: 'var(--font-display,system-ui)', fontSize: 34, fontWeight: 800, color: '#fff' }}>{b.name[0]}</span>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontFamily: 'var(--font-display,system-ui)', fontSize: 20, fontWeight: 700, letterSpacing: '0.03em', color: '#fff' }}>{b.name}</div>
        <div style={{ textAlign: 'center', fontFamily: 'var(--font-display,system-ui)', fontWeight: 600, letterSpacing: '0.2em', fontSize: 12, marginTop: 8,
          color: speaking ? b.color : active ? 'var(--accent,#3b82f6)' : 'var(--warn,#f59e0b)' }}>
          {status === 'connecting' ? 'VERBINDE…' : speaking ? `${b.name.toUpperCase()} SPRICHT` : active ? 'DU BIST DRAN' : status === 'ended' ? 'BEENDET' : 'BEREIT'}
        </div>
        {/* HP — both bars move live, scored by the SAME engine as your fight */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HpBar label={`${b.name.toUpperCase()} HP`} value={bossHp} color={b.color} />
          <HpBar label="DEINE HP" value={playerHp} color="var(--accent,#3b82f6)" />
        </div>
      </div>

      {/* persona picker (idle only) */}
      {status !== 'connected' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 380 }}>
          {BOSSES.map((x) => (
            <button key={x.id} onClick={() => setBoss(x.id)}
              style={{ padding: '6px 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${boss === x.id ? x.color : '#334155'}`,
                background: boss === x.id ? `${x.color}22` : 'transparent', color: boss === x.id ? '#fff' : '#94a3b8', fontWeight: boss === x.id ? 700 : 400 }}>
              {x.name}
            </button>
          ))}
        </div>
      )}

      {status !== 'connected' ? (
        <button onClick={start} disabled={status === 'connecting'} style={{ width: '100%', maxWidth: 440, padding: '15px 20px', fontSize: 16, fontWeight: 700,
          borderRadius: 16, border: 'none', cursor: 'pointer', color: '#081019', background: 'var(--grad-action, linear-gradient(135deg,#f59e0b,#f97316))',
          opacity: status === 'connecting' ? 0.6 : 1, fontFamily: 'var(--font-display,system-ui)', letterSpacing: '0.02em' }}>
          {status === 'connecting' ? 'Verbinde…' : status === 'ended' ? '↻ Nochmal' : '🎙 Interview starten'}
        </button>
      ) : (
        <button onClick={stop} style={{ width: '100%', maxWidth: 440, padding: '13px 20px', fontSize: 14, fontWeight: 700, borderRadius: 14,
          border: '1px solid #ef4444', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontFamily: 'var(--font-display,system-ui)' }}>
          ■ Interview beenden
        </button>
      )}

      {err && (
        <div style={{ maxWidth: 440, width: '100%', fontSize: 12, color: '#fca5a5', background: '#1a0a0a', padding: 12, borderRadius: 8, wordBreak: 'break-word', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>⚠ {err}</div>
          <button onClick={goNormal} style={{ alignSelf: 'flex-start', padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--accent,#3b82f6)', background: 'rgba(59,130,246,0.1)', color: '#93c5fd' }}>
            → Zum normalen Interview
          </button>
        </div>
      )}

      {/* subtitle / transcript */}
      {lines.length > 0 && (
        <div style={{ width: '100%', maxWidth: 440, padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line,rgba(255,255,255,0.06))' }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontSize: 13, lineHeight: 1.5, color: l.who === 'user' ? 'var(--accent-2,#60a5fa)' : '#e2e8f0', padding: '2px 0' }}>
              <b style={{ opacity: 0.6 }}>{l.who === 'user' ? 'Du' : b.name}:</b> {l.text}
            </div>
          ))}
        </div>
      )}

      {/* debrief — the app's REAL feedback */}
      {(debriefLoading || debrief) && (
        <div style={{ width: '100%', maxWidth: 440, padding: 16, borderRadius: 14, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <div style={{ fontFamily: 'var(--font-display,system-ui)', fontSize: 12, letterSpacing: '0.14em', color: 'var(--accent,#3b82f6)', fontWeight: 700, marginBottom: 10 }}>DEIN FEEDBACK</div>
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
                <div><b style={{ color: 'var(--accent,#3b82f6)' }}>Als Nächstes:</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{debrief.studyNext.slice(0, 3).map((s, i) => <li key={i}>{s.detail || s.title || (typeof s === 'string' ? s : '')}</li>)}</ul></div>
              )}
            </div>
          )}
        </div>
      )}
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
