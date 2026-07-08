/**
 * Feedback.jsx — two feedback surfaces.
 *   HomeFeedback   : a small permanent "Feedback" button on the home screen (stars + text).
 *   FirstFightCard : a skippable Arabic card shown once, on the results screen after the
 *                    user's FIRST EVER fight. Never blocks starting a new fight.
 * Both POST to /api/feedback and show a short "شكرًا!" confirmation.
 */
import { useState } from 'react';

async function postFeedback(apiUrl, token, body) {
  try {
    const r = await fetch(`${apiUrl}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch { return false; }
}

// ── Home: small permanent feedback button + modal (1–5 stars + free text) ───────
export function HomeFeedback({ token, apiUrl }) {
  const [open, setOpen]     = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover]   = useState(0);
  const [text, setText]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [sent, setSent]     = useState(false);

  const close = () => { if (busy) return; setOpen(false); setRating(0); setText(''); setSent(false); };
  const submit = async () => {
    if (busy || (rating === 0 && !text.trim())) return;
    setBusy(true);
    await postFeedback(apiUrl, token, { rating, text, screen: 'home' });
    setBusy(false); setSent(true);
    setTimeout(close, 1500);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} style={{ width: '100%', marginTop: 8, padding: '10px',
        cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.14em',
        borderRadius: 8, border: '1px solid rgba(148,163,184,0.35)', color: '#94a3b8', background: 'rgba(255,255,255,0.02)' }}>
        💬  FEEDBACK GEBEN
      </button>

      {open && (
        <div onClick={close} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={modal}>
            {sent ? (
              <div style={{ ...thanks, direction: 'rtl' }}>شكرًا!</div>
            ) : (
              <>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--accent)', marginBottom: 4 }}>Dein Feedback</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>Wie war deine Erfahrung?</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setRating(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 28, lineHeight: 1, padding: 0,
                        filter: (hover || rating) >= n ? 'none' : 'grayscale(1) opacity(0.4)', transition: 'filter 0.15s' }}>⭐</button>
                  ))}
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
                  placeholder="Was können wir besser machen? (optional)" style={textarea} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={close} style={btnGhost}>Schließen</button>
                  <button onClick={submit} disabled={busy || (rating === 0 && !text.trim())}
                    style={{ ...btnPrimary, opacity: (busy || (rating === 0 && !text.trim())) ? 0.5 : 1 }}>
                    {busy ? '…' : 'Senden'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Results screen: one-time Arabic card after the FIRST fight ──────────────────
const PRICE_OPTS = ['أقل من 500', '500–1000', 'أكتر من 1000 جنيه', 'مش هدفع'];

export function FirstFightCard({ token, apiUrl }) {
  const [feltReal, setFeltReal] = useState(null);   // true | false
  const [price, setPrice]       = useState(null);
  const [text, setText]         = useState('');
  const [stage, setStage]       = useState('open');  // open | sent | hidden
  const [busy, setBusy]         = useState(false);

  if (stage === 'hidden') return null;
  if (stage === 'sent') {
    return <div style={{ ...card, direction: 'rtl', textAlign: 'center', color: 'var(--player-2)',
      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>شكرًا!</div>;
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await postFeedback(apiUrl, token, { screen: 'post-first-fight', answers: { feltReal, price }, text });
    setBusy(false); setStage('sent');
    setTimeout(() => setStage('hidden'), 1600);
  };

  const pill = (active) => ({ cursor: 'pointer', padding: '7px 12px', borderRadius: 'var(--r-pill)',
    fontFamily: 'var(--font-body)', fontSize: 12, border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
    background: active ? 'rgba(59,130,246,0.14)' : 'rgba(255,255,255,0.03)', color: active ? 'var(--accent)' : '#cbd5e1' });

  return (
    <div style={{ ...card, direction: 'rtl', textAlign: 'right' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--accent)' }}>رأيك يهمنا</span>
        <button onClick={() => setStage('hidden')} style={{ ...btnGhost, padding: '4px 10px', fontSize: 10 }}>تخطّي ✕</button>
      </div>

      {/* Q1: felt real? */}
      <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 7 }}>حسّيت إنه زي إنترفيو حقيقي؟</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => setFeltReal(true)}  style={pill(feltReal === true)}>✓ نعم</button>
        <button onClick={() => setFeltReal(false)} style={pill(feltReal === false)}>✗ لا</button>
      </div>

      {/* Q2: price */}
      <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 7 }}>لو في اشتراك شهري — تدفع كام؟</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
        {PRICE_OPTS.map((o) => <button key={o} onClick={() => setPrice(o)} style={pill(price === o)}>{o}</button>)}
      </div>

      {/* free text */}
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
        placeholder="أي ملاحظات؟" style={{ ...textarea, direction: 'rtl', textAlign: 'right' }} />

      <button onClick={submit} disabled={busy} style={{ ...btnPrimary, width: '100%', marginTop: 10, opacity: busy ? 0.5 : 1 }}>
        {busy ? '…' : 'إرسال'}
      </button>
    </div>
  );
}

// ── Owner-only: fulfill a payment by granting Pro to a user's email ─────────────
function GrantPro({ token, apiUrl }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg]     = useState(null);
  const [busy, setBusy]   = useState(false);

  const grant = async (plan) => {
    if (busy || !email.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${apiUrl}/api/billing/admin/grant`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: email.trim(), plan }),
      });
      const d = await r.json();
      if (r.ok) { setMsg({ ok: true, t: `✓ ${d.email} → Plan: ${d.plan}` }); }
      else setMsg({ ok: false, t: d.error === 'user_not_found' ? 'Kein Konto mit dieser E-Mail.' : `Fehler: ${d.error}` });
    } catch { setMsg({ ok: false, t: 'Netzwerkfehler.' }); }
    setBusy(false);
  };

  const btn = (plan, label, color) => (
    <button onClick={() => grant(plan)} disabled={busy || !email.trim()}
      style={{ flex: 1, padding: '9px 6px', minHeight: 40, borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 9.5,
        border: `1px solid ${color}`, color: '#04070d', background: color, opacity: (busy || !email.trim()) ? 0.5 : 1 }}>
      {label}
    </button>
  );

  return (
    <div style={{ marginBottom: 14, padding: '10px 11px', borderRadius: 9, background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.3)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--accent)', marginBottom: 7 }}>PLAN SETZEN · ZAHLUNG ERFÜLLEN / TEST</div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kunde@email.com" type="email"
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px', borderRadius: 7, fontSize: 12, background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', border: '1px solid var(--line)', outline: 'none', marginBottom: 7 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        {btn('basic', 'BASIC', 'var(--accent-2)')}
        {btn('elite', 'ELITE', 'var(--action)')}
        {btn('free', 'FREE', '#94a3b8')}
      </div>
      {busy && <div style={{ fontSize: 10, marginTop: 6, color: '#94a3b8' }}>…</div>}
      {msg && <div style={{ fontSize: 10.5, marginTop: 6, color: msg.ok ? 'var(--accent)' : '#f87171' }}>{msg.t}</div>}
    </div>
  );
}

// ── Owner-only: feedback dashboard (rendered only for ADMIN_EMAIL accounts) ─────
export function AdminFeedback({ token, apiUrl }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  const load = async () => {
    setOpen(true); setBusy(true); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/feedback/admin`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch { setErr('Konnte Feedback nicht laden.'); }
    setBusy(false);
  };

  const priceRows = data ? Object.entries(data.summary.priceCounts || {}).sort((a, b) => b[1] - a[1]) : [];

  return (
    <>
      <button onClick={load} style={{ width: '100%', marginTop: 8, padding: '12px 10px', minHeight: 44,
        cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.14em',
        borderRadius: 8, border: '1px solid rgba(59,130,246,0.4)', color: 'var(--accent)', background: 'rgba(59,130,246,0.06)' }}>
        🛠  FEEDBACK-DATEN (ADMIN)
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modal, maxWidth: 420, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>Feedback-Daten</span>
              <button onClick={() => setOpen(false)} style={{ ...btnGhost, flex: 'none', padding: '4px 10px', fontSize: 11 }}>✕</button>
            </div>

            <GrantPro token={token} apiUrl={apiUrl} />

            {busy && <div style={{ color: '#94a3b8', fontSize: 12 }}>Lädt…</div>}
            {err && <div style={{ color: '#f87171', fontSize: 12 }}>{err}</div>}

            {data && (
              <>
                <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.7, marginBottom: 12 }}>
                  <div><b>{data.summary.total}</b> Rückmeldungen · ⭐ Ø {data.summary.avgRating ?? '—'} ({data.summary.ratingCount})</div>
                  <div>Wirkte echt: <span style={{ color: 'var(--accent)' }}>{data.summary.feltRealYes} ✓</span> · <span style={{ color: '#f87171' }}>{data.summary.feltRealNo} ✗</span></div>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>Zahlungsbereitschaft:</div>
                  {priceRows.length === 0
                    ? <div style={{ fontSize: 11, color: '#64748b' }}>noch keine</div>
                    : priceRows.map(([k, v]) => (
                        <div key={k} dir="rtl" style={{ fontSize: 12, color: '#cbd5e1' }}>{k} — <b style={{ color: 'var(--accent)' }}>{v}</b></div>
                      ))}
                </div>

                <div style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.1em', marginBottom: 6 }}>NEUESTE ({data.entries.length})</div>
                {data.entries.map((e, i) => (
                  <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '7px 0', fontSize: 11, color: '#cbd5e1' }}>
                    <div style={{ color: '#64748b', fontSize: 9.5 }}>
                      {(e.timestamp || '').slice(0, 16).replace('T', ' ')} · {e.screen === 'public-link' ? '🔗 Link' : e.screen} · {e.name || e.email || 'anon'}
                    </div>
                    {e.rating ? <span style={{ color: 'var(--action)' }}>⭐ {e.rating} </span> : null}
                    {e.answers?.feltReal != null && <span>· echt: {e.answers.feltReal ? '✓' : '✗'} </span>}
                    {e.answers?.price && <span dir="rtl">· {e.answers.price} </span>}
                    {(e.answers?.liked || e.text) ? <div style={{ color: '#94a3b8', marginTop: 2, overflowWrap: 'anywhere' }}>👍 „{e.answers?.liked || e.text}"</div> : null}
                    {e.answers?.disliked ? <div style={{ color: 'var(--action-2)', marginTop: 2, overflowWrap: 'anywhere' }}>🔧 „{e.answers.disliked}"</div> : null}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── shared styles ──
const overlay = { position: 'absolute', inset: 0, zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(2,4,9,0.8)', backdropFilter: 'blur(4px)' };
const modal   = { width: '100%', maxWidth: 360, padding: '18px 16px', borderRadius: 'var(--r-lg)', background: 'linear-gradient(180deg, rgba(10,18,30,0.98), rgba(4,8,14,0.99))', border: '1px solid var(--line)', boxShadow: 'var(--shadow-card)' };
const card    = { padding: '13px 14px', borderRadius: 'var(--r-md)', background: 'linear-gradient(180deg, rgba(8,16,28,0.92), rgba(4,8,14,0.95))', border: '1px solid rgba(59,130,246,0.3)', boxShadow: '0 0 18px rgba(59,130,246,0.1)' };
const thanks  = { textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--player-2)', padding: '14px 0' };
const textarea = { width: '100%', minHeight: 64, padding: 10, borderRadius: 'var(--r-sm)', resize: 'vertical', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontFamily: 'var(--font-body)', fontSize: 13, border: '1px solid var(--line)', outline: 'none' };
const btnGhost = { flex: 1, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 11, padding: '9px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)' };
const btnPrimary = { flex: 1, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, padding: '9px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--accent)', color: '#04070d', background: 'linear-gradient(135deg, var(--accent-2), var(--accent))' };
