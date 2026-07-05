/**
 * Alhassan.jsx — chat with the persistent Egyptian-Arabic mentor.
 *
 * Loads the user's full prior conversation on open (GET /api/guide/history) so Alhassan picks up
 * exactly where they left off, and sends each message to POST /api/guide/chat. Egyptian-Arabic,
 * RTL. Fails soft: if history can't load, the chat still works for this session.
 * Optional `onAction(id)`: when a reply clearly points at exactly ONE known drill/action, a single
 * tappable chip renders under that bubble (no prop or ambiguous mention → nothing renders).
 */
import { useState, useEffect, useRef, useCallback, Fragment } from 'react';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

// Known action mentions in Alhassan's replies → app action ids. Deterministic regexes, high
// precision: a chip renders ONLY when exactly one distinct action matches (0 or ≥2 → nothing).
const ACTIONS = [
  { id: 'interview',    label: 'INTERVIEW STARTEN', re: /interview|إنترفيو|فايت/i },
  { id: 'review',       label: 'WIEDERHOLUNG',      re: /wiederholung|مراجعة/i },
  { id: 'shadowing',    label: 'SHADOWING',         re: /shadowing/i },
  { id: 'fluency',      label: 'FLOW-DRILL',        re: /flow[\s-]?drill/i },
  { id: 'listening',    label: 'HÖR-CHECK',         re: /h(ö|oe)r[\s-]?check/i },
  { id: 'spokenreview', label: 'SAG ES RICHTIG',    re: /sag\s+es\s+richtig/i },
  { id: 'pressure',     label: 'DRUCK-LEITER',      re: /druck[\s-]?leiter/i },
  { id: 'assessment',   label: 'EINSTUFUNG',        re: /einstufung|تقييم/i },
];
const detectAction = (text) => {
  const hits = ACTIONS.filter((a) => a.re.test(text));
  return hits.length === 1 ? hits[0] : null;
};

export function Alhassan({ token, apiUrl, lang = 'de', onClose, onAction }) {
  const [messages, setMessages] = useState(null); // null = loading; [] = empty
  const [input, setInput]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const [shown, setShown]   = useState(Infinity); // word-tokens of the newest reply revealed so far; Infinity = all
  const scrollRef = useRef(null);
  const revealTimer = useRef(null);
  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/guide/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMessages(Array.isArray(d.messages) ? d.messages : []); })
      .catch(() => { if (!cancelled) setMessages([]); });   // fail soft — chat still works
    return () => { cancelled = true; };
  }, [apiUrl, token]);

  // Auto-scroll to the newest message (also follows the word-by-word reveal via `shown`).
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy, shown]);

  // Kill any in-flight reveal timer on unmount.
  useEffect(() => () => clearInterval(revealTimer.current), []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    clearInterval(revealTimer.current); setShown(Infinity);   // finish any running reveal instantly
    setErr(''); setInput('');
    setMessages((m) => [...(m || []), { role: 'user', content: text }]);
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/api/guide/chat`, { method: 'POST', headers: headers(), body: JSON.stringify({ message: text }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'guide_failed');
      setMessages((m) => [...(m || []), { role: 'assistant', content: d.reply }]);
      // Progressive reveal: the reply arrives whole (non-streaming) — surface it ~1-2 words per
      // 35ms tick instead of slamming a full wall of text into the bubble.
      const total = String(d.reply || '').split(/(\s+)/).length;
      setShown(0);
      revealTimer.current = setInterval(() => {
        setShown((s) => {
          const next = s + 3;   // 3 tokens (word·space·word) ≈ 1-2 words per tick
          if (next >= total) { clearInterval(revealTimer.current); return Infinity; }
          return next;
        });
      }, 35);
    } catch {
      setErr(T(lang, 'El-Captain ist gerade nicht erreichbar. Gleich nochmal.', 'الكابتن مش متاح دلوقتي. جرّب تاني بعد شوية.'));
    }
    setBusy(false);
  };

  return (
    <div style={ov}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, letterSpacing: '0.08em', color: 'var(--accent)' }}>🧭 الكابتن</div>
          <div style={{ fontSize: 9.5, color: '#64748b', letterSpacing: '0.06em' }}>{T(lang, 'DEIN GUIDE · 24/7', 'دليلك · اسأله أي وقت')}</div>
        </div>
        <button onClick={onClose} style={ghost}>✕</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages === null && <div style={{ textAlign: 'center', color: '#64748b', padding: 30 }}>…</div>}
        {messages?.length === 0 && (
          <div dir="rtl" style={{ ...bubble('assistant'), alignSelf: 'flex-start' }}>
            أهلاً يا سطا 👊 أنا الكابتن. أنا كنت قاعد مكانك بالظبط. قولّي إنت فين دلوقتي وعايز توصل لإيه — ونبدأ.
          </div>
        )}
        {messages?.map((m, i) => {
          const revealing = m.role === 'assistant' && i === messages.length - 1 && shown !== Infinity;
          const body = revealing ? String(m.content).split(/(\s+)/).slice(0, shown).join('') : m.content;
          const act = !revealing && m.role === 'assistant' && onAction ? detectAction(String(m.content || '')) : null;
          return (
            <Fragment key={i}>
              <div dir="rtl" style={{ ...bubble(m.role), alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {body}
              </div>
              {act && (
                <button onClick={() => onAction(act.id)} style={chip}>
                  {/* OWNER-AR slot — chip label is the action's German name for now */}
                  ▶ {act.label}
                </button>
              )}
            </Fragment>
          );
        })}
        {busy && (
          <div style={{ ...bubble('assistant'), alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5 }}>
            {[0, 1, 2].map((n) => (
              <span key={n} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent, #3b82f6)',
                animation: `pulse 0.9s ease-in-out ${n * 0.15}s infinite` }} />
            ))}
          </div>
        )}
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
            fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, border: '1px solid var(--action, #f97316)',
            color: '#0b1220', background: 'var(--action, #f97316)', opacity: (busy || !input.trim()) ? 0.5 : 1 }}>
          {busy ? '…' : T(lang, 'Senden', 'ابعت')}
        </button>
      </div>
    </div>
  );
}

const ov = { position: 'absolute', inset: 0, zIndex: 225, display: 'flex', flexDirection: 'column',
  background: 'radial-gradient(120% 80% at 50% 0%, #0b1220 0%, #020617 100%)', animation: 'flash-in 0.3s ease' };
const ghost = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, padding: '7px 11px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' };
const errBox = { margin: '0 14px 6px', padding: '8px 12px', borderRadius: 8, fontSize: 11.5, textAlign: 'center',
  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' };
// Full-width orange-outline action chip — orange is THE action accent, 44px min touch target.
const chip = { alignSelf: 'stretch', minHeight: 44, marginTop: -4, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
  fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textAlign: 'center',
  border: '1px solid var(--action, #f97316)', background: 'rgba(249,115,22,0.08)', color: 'var(--action-2, #fb923c)',
  animation: 'flash-in 0.15s ease' };
function bubble(role) {
  const me = role === 'user';
  return { maxWidth: '82%', padding: '10px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    background: me ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.10)',
    border: `1px solid ${me ? 'rgba(96,165,250,0.3)' : 'rgba(59,130,246,0.3)'}`,
    color: me ? '#e2e8f0' : 'var(--accent-2)',
    animation: 'flash-in 0.15s ease' };
}
