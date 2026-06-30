/**
 * Alhassan.jsx — chat with the persistent Egyptian-Arabic mentor.
 *
 * Loads the user's full prior conversation on open (GET /api/guide/history) so Alhassan picks up
 * exactly where they left off, and sends each message to POST /api/guide/chat. Egyptian-Arabic,
 * RTL. Fails soft: if history can't load, the chat still works for this session.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

export function Alhassan({ token, apiUrl, lang = 'de', onClose }) {
  const [messages, setMessages] = useState(null); // null = loading; [] = empty
  const [input, setInput]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const scrollRef = useRef(null);
  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/guide/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMessages(Array.isArray(d.messages) ? d.messages : []); })
      .catch(() => { if (!cancelled) setMessages([]); });   // fail soft — chat still works
    return () => { cancelled = true; };
  }, [apiUrl, token]);

  // Auto-scroll to the newest message.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr(''); setInput('');
    setMessages((m) => [...(m || []), { role: 'user', content: text }]);
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/api/guide/chat`, { method: 'POST', headers: headers(), body: JSON.stringify({ message: text }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'guide_failed');
      setMessages((m) => [...(m || []), { role: 'assistant', content: d.reply }]);
    } catch {
      setErr(T(lang, 'Alhassan ist gerade nicht erreichbar. Gleich nochmal.', 'الحسن مش متاح دلوقتي. جرّب تاني بعد شوية.'));
    }
    setBusy(false);
  };

  return (
    <div style={ov}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, letterSpacing: '0.08em', color: 'var(--accent)' }}>🧭 الحسن</div>
          <div style={{ fontSize: 9.5, color: '#64748b', letterSpacing: '0.06em' }}>{T(lang, 'DEIN GUIDE · 24/7', 'دليلك · اسأله أي وقت')}</div>
        </div>
        <button onClick={onClose} style={ghost}>✕</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages === null && <div style={{ textAlign: 'center', color: '#64748b', padding: 30 }}>…</div>}
        {messages?.length === 0 && (
          <div dir="rtl" style={{ ...bubble('assistant'), alignSelf: 'flex-start' }}>
            أهلاً يا سطا 👊 أنا الحسن. أنا كنت قاعد مكانك بالظبط. قولّي إنت فين دلوقتي وعايز توصل لإيه — ونبدأ.
          </div>
        )}
        {messages?.map((m, i) => (
          <div key={i} dir="rtl" style={{ ...bubble(m.role), alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {m.content}
          </div>
        ))}
        {busy && <div dir="rtl" style={{ ...bubble('assistant'), alignSelf: 'flex-start', color: '#64748b' }}>…بيكتب</div>}
      </div>

      {err && <div style={errBox}>⚠ {err}</div>}

      <div style={{ display: 'flex', gap: 8, padding: '8px 12px 14px', alignItems: 'flex-end' }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          dir="rtl" rows={1} placeholder="اكتب للحسن…"
          style={{ flex: 1, resize: 'none', maxHeight: 110, padding: '11px', borderRadius: 10, background: 'rgba(255,255,255,0.05)',
            color: '#e2e8f0', fontSize: 14, border: '1px solid var(--line, #1e293b)', outline: 'none', lineHeight: 1.5 }} />
        <button onClick={send} disabled={busy || !input.trim()}
          style={{ padding: '11px 16px', minHeight: 44, cursor: (busy || !input.trim()) ? 'default' : 'pointer', borderRadius: 10,
            fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, border: '1px solid var(--accent)',
            color: '#04130c', background: 'linear-gradient(135deg,var(--accent),var(--accent))', opacity: (busy || !input.trim()) ? 0.5 : 1 }}>
          {busy ? '…' : T(lang, 'Senden', 'ابعت')}
        </button>
      </div>
    </div>
  );
}

const ov = { position: 'absolute', inset: 0, zIndex: 225, display: 'flex', flexDirection: 'column',
  background: 'radial-gradient(120% 80% at 50% 0%, #0c1a14 0%, #060c0a 55%, #020409 100%)', animation: 'flash-in 0.3s ease' };
const ghost = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, padding: '7px 11px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' };
const errBox = { margin: '0 14px 6px', padding: '8px 12px', borderRadius: 8, fontSize: 11.5, textAlign: 'center',
  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' };
function bubble(role) {
  const me = role === 'user';
  return { maxWidth: '82%', padding: '10px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    background: me ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.10)',
    border: `1px solid ${me ? 'rgba(96,165,250,0.3)' : 'rgba(59,130,246,0.3)'}`,
    color: me ? '#cffafe' : 'var(--accent-2)' };
}
