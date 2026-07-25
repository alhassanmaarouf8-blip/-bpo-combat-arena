/**
 * PublicFeedback.jsx — the shareable feedback page (no login).
 *
 * Rendered by main.jsx when the URL carries `?feedback` — a link the owner can drop into
 * Messenger/WhatsApp so people who never reach the in-app feedback button can still leave
 * detailed feedback (what they liked · what to improve · a star rating · optional name).
 *
 * On submit it POSTs to /api/feedback/public for private product review. Public ratings are
 * drawn only from separately reviewed and approved feedback; this form never auto-publishes
 * a person's name or comments. Self-contained: defines its own palette (the app's CSS
 * vars live inside App.jsx, which is NOT mounted on this route) mirroring the app's light
 * palette — warm white ground, ink #0E1320, one orange #D9541A action — and Inter.
 */
import { useEffect, useState } from 'react';
import { API_URL as BACKEND } from './config.js';

const APP_URL = window.location.origin;

// Brand palette (mirrors App.jsx :root — kept literal so this page renders without the app).
// ICONIC light + the white/orange order: this standalone ?feedback page carried its own DARK
// literals, so it stayed navy after the rest of the product went light. Blue is de-coloured to ink
// here for the same reason it is everywhere else — orange is reserved for the one action.
const C = {
  bg0: '#F5F3EF', bg1: '#FFFFFF', bg2: '#EDEBE6',
  blue: '#0E1320', blue2: '#3A4150', orange: '#D9541A', orange2: '#E8703A',
  // LITERAL, as the note above says: App.jsx (and therefore the whole token layer) never mounts on
  // this route, so a var(--…) here resolves to nothing — which makes every declaration using it
  // invalid at computed-value time, and borders fall back to currentColor instead of a hairline.
  text: '#0E1320', dim: '#5A6270', faint: '#8A909C',
  line: 'rgba(14,19,32,0.10)', surface: '#FFFFFF', bad: '#B42318',
  font: "'Inter',system-ui,sans-serif",
};

export default function PublicFeedback() {
  const [rating, setRating]     = useState(0);
  const [hover, setHover]       = useState(0);
  const [liked, setLiked]       = useState('');
  const [disliked, setDisliked] = useState('');
  const [name, setName]         = useState('');
  const [hp, setHp]             = useState('');   // honeypot — hidden from humans
  const [busy, setBusy]         = useState(false);
  const [sent, setSent]         = useState(false);
  const [err, setErr]           = useState('');
  const [proof, setProof]       = useState(null); // { available, avgRating, ratingCount }

  // Show independently approved public proof without implying this submission is published.
  useEffect(() => {
    fetch(`${BACKEND}/api/feedback/public`).then((r) => r.json()).then(setProof).catch(() => {});
  }, []);

  const canSend = rating > 0 || liked.trim() || disliked.trim();

  const submit = async () => {
    if (busy || !canSend) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${BACKEND}/api/feedback/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, liked, disliked, name, hp }),
      });
      if (r.ok) { setSent(true); return; }
      const d = await r.json().catch(() => ({}));
      setErr(d.error === 'rate_limited'
        ? 'Zu viele Einsendungen von diesem Gerät. Bitte später erneut.'
        : 'Konnte nicht senden. Bitte erneut versuchen.');
    } catch {
      setErr('Netzwerkfehler. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.brand}>German Interview Trainer</div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '18px 0' }}>
            <div style={{ fontSize: 44, lineHeight: 1 }}>🙏</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.blue2, margin: '14px 0 6px' }}>Danke!</div>
            <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6 }}>
              Dein Feedback wurde privat gespeichert und hilft, das Training besser zu machen.
            </div>
            <a href={APP_URL} style={{ ...S.btn, display: 'inline-block', textDecoration: 'none', marginTop: 20 }}>
              App öffnen →
            </a>
          </div>
        ) : (
          <>
            <h1 style={S.h1}>Wie war deine Erfahrung?</h1>
            <p style={S.sub}>
              Deine ehrliche Meinung zählt — sag uns, was gut war und was besser sein könnte.
              <br /><span style={{ color: C.faint, fontSize: 12 }}>Your honest feedback shapes the app.</span>
            </p>

            {proof?.available && (
              <div style={S.proof}>
                <span style={{ color: C.orange2, fontWeight: 800 }}>★ {proof.avgRating}</span>
                <span style={{ color: C.dim }}> · {proof.ratingCount} {proof.ratingCount === 1 ? 'Bewertung' : 'Bewertungen'}</span>
              </div>
            )}

            {/* stars */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '18px 0 6px' }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={`${n} Sterne`}
                  onClick={() => setRating(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 34, lineHeight: 1, padding: 2,
                    minWidth: 44, minHeight: 44, color: C.orange,
                    filter: (hover || rating) >= n ? 'none' : 'grayscale(1) opacity(0.35)', transition: 'filter .15s', transform: (hover || rating) >= n ? 'scale(1.05)' : 'none' }}>
                  {/* The glyph was missing, so all five rating buttons rendered blank while the code
                      around them styled a star that was never there (grayscale when unpicked, a
                      slight scale when picked). A text ★ keeps it in the two-colour palette. */}
                  ★
                </button>
              ))}
            </div>

            <label style={S.label}>Was hat dir gefallen? 👍</label>
            <textarea value={liked} onChange={(e) => setLiked(e.target.value)} maxLength={1000}
              placeholder="Was hat dir am Training geholfen oder Spaß gemacht?" style={S.textarea} />

            <label style={S.label}>Was können wir besser machen?</label>
            <textarea value={disliked} onChange={(e) => setDisliked(e.target.value)} maxLength={1000}
              placeholder="Was hat gefehlt oder gestört?" style={S.textarea} />

            <label style={S.label}>Dein Name <span style={{ color: C.faint }}>(optional)</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
              placeholder="z. B. Mohamed" style={S.input} />

            {/* honeypot — off-screen, not for humans */}
            <input value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off"
              aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

            {err && <div style={{ color: C.bad, fontSize: 12.5, marginTop: 12 }}>{err}</div>}

            <button type="button" onClick={submit} disabled={busy || !canSend}
              style={{ ...S.btn, marginTop: 18, opacity: (busy || !canSend) ? 0.45 : 1, cursor: (busy || !canSend) ? 'default' : 'pointer' }}>
              {busy ? 'Senden…' : 'Feedback senden'}
            </button>
            <div style={{ color: C.faint, fontSize: 11.5, lineHeight: 1.5, marginTop: 10, textAlign: 'center' }}>
              Dein Name und deine Kommentare werden nicht automatisch veröffentlicht.
            </div>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <a href={APP_URL} style={S.appLink}>Zur App →</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const S = {
  page: {
    minHeight: '100vh', width: '100%', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    background: `radial-gradient(120% 90% at 50% 0%, ${C.bg2} 0%, ${C.bg0} 60%)`,
    fontFamily: C.font, color: C.text,
  },
  card: {
    position: 'relative', width: '100%', maxWidth: 440, boxSizing: 'border-box',
    padding: '26px 22px 22px', borderRadius: 18,
    background: `linear-gradient(180deg, ${C.bg1}, ${C.bg0})`,
    border: `1px solid ${C.line}`, boxShadow: '0 24px 64px -16px rgba(2,6,17,0.7)',
  },
  brand: { textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '0.18em', color: C.dim, marginBottom: 14 },
  h1: { textAlign: 'center', fontSize: 22, fontWeight: 800, color: C.text, margin: '0 0 8px' },
  sub: { textAlign: 'center', fontSize: 14, color: C.dim, lineHeight: 1.6, margin: '0 0 4px' },
  proof: { textAlign: 'center', fontSize: 15, marginTop: 10, padding: '7px 0', borderRadius: 10, background: C.surface, border: `1px solid ${C.line}` },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: C.text, margin: '16px 0 6px' },
  textarea: {
    width: '100%', boxSizing: 'border-box', minHeight: 74, padding: 12, borderRadius: 10, resize: 'vertical',
    background: C.surface, color: C.text, fontFamily: C.font, fontSize: 14.5, lineHeight: 1.5,
    border: `1px solid ${C.line}`, outline: 'none',
  },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10,
    background: C.surface, color: C.text, fontFamily: C.font, fontSize: 14.5,
    border: `1px solid ${C.line}`, outline: 'none',
  },
  btn: {
    width: '100%', boxSizing: 'border-box', padding: '14px', borderRadius: 12, border: 'none',
    fontFamily: C.font, fontSize: 15, fontWeight: 800, color: '#FFFFFF',
    // Machined, not inflated: solid fill, white label, a tight shadow instead of an orange bloom.
    background: C.orange,
    boxShadow: '0 1px 2px rgba(18,22,31,0.2)',
  },
  appLink: { fontSize: 13, color: C.blue2, textDecoration: 'none', fontWeight: 600 },
};
