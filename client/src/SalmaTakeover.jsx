/**
 * SalmaTakeover.jsx — the recruiter cold-open. Fires ONCE per account (server flag salmaIntroAt,
 * localStorage mirror): Salma introduces herself, takes the candidate's name + goal, runs their
 * "screening call" (the existing free Assessment), delivers HER verdict from the REAL assessment
 * result, and books the first interview (Yasmin, the ladder's Junior-Recruiterin).
 *
 * LAW: every word comes from salmaCopy.js owner templates — no LLM, no invented data (El-Captain
 * precedent). The Assessment itself is untouched; while it runs, App hides this overlay and bumps
 * `resumeTick` when it closes so the flow resumes on the verdict beat.
 */
import { useEffect, useRef, useState } from 'react';
import { SALMA_COPY, salmaLine, salmaName, salmaRole } from './salmaCopy.js';
import { playNative } from './nativeVoice.js';

// Salma's OWN native voice — a warm female Aura-2 German voice no interviewer uses (kara is
// server-whitelisted in transcribeRouter ALLOWED_VOICES and unclaimed by any boss). Her lines are
// fixed templates → server-cached → $0. House law holds: native voice or SILENCE, never the
// robotic browser voice (playNative defaults noBrowserFallback=true).
const SALMA_VOICE = 'aura-2-kara-de';

const GOALS = [
  { value: 'bpo-job',       key: 'goal_bpo' },
  { value: 'better-german', key: 'goal_german' },
  { value: 'other',         key: 'goal_other' },
];

// estimatedLevel (A1–C2 from the assessment) → the app's three interview levels. Same map as the
// legacy auto-set in App.jsx (D10): the MEASURED level drives the first booked interview.
export const ASSESS_LEVEL_MAP = { A1: 'a2-b1', A2: 'a2-b1', B1: 'a2-b1', B2: 'b2', C1: 'c1', C2: 'c1' };
export const ASSESS_BOSS_MAP = { A1: 'yasmin', A2: 'yasmin', B1: 'yasmin', B2: 'karim', C1: 'hana', C2: 'hana' };

export function SalmaTakeover({ token, apiUrl, lang, ctx, resumeTick, onStartScreening, onBookFight, onClose }) {
  // Beats: welcome → name_goal → screening → (assessment runs outside) → verdict | no_verdict.
  // Returning variant: welcome → (name_goal if no name) → handoff.
  // While the assessment runs, App UNMOUNTS this overlay (one takeover at a time) — so on a
  // remount with resumeTick > 0 we start in 'checking' and the effect below fetches the verdict.
  const [beat, setBeat]   = useState(resumeTick > 0 ? 'checking' : 'welcome');
  const [name, setName]   = useState(ctx.profile?.name || '');
  const [goal, setGoal]   = useState(ctx.profile?.goal || null);
  const [result, setResult] = useState(ctx.result || null);
  const returning = ctx.variant === 'returning';
  const seenTick  = useRef(0);

  const line = (key, slots) => salmaLine(key, lang, slots);

  // Mark the intro consumed on the server (idempotent) + mirror locally so a slow/failed POST
  // can never re-loop this device. Fire-and-forget by design.
  const markSeen = () => {
    try { localStorage.setItem('omni_salma_seen', '1'); } catch { /* private mode */ }
    fetch(`${apiUrl}/api/guide/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ salmaIntroSeen: true }),
    }).catch(() => {});
  };
  const finish = (beaconId) => { markSeen(); onClose(beaconId); };

  // Best-effort profile save — the flow never blocks on it (fights auto-capture names anyway).
  const saveProfile = () => {
    const body = {};
    if (name.trim()) body.name = name.trim();
    if (goal) body.goal = goal;
    if (!Object.keys(body).length) return;
    fetch(`${apiUrl}/api/guide/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(() => {});
    // PII-free funnel count (same fire-and-forget contract as App's beacon helper).
    fetch(`${apiUrl}/api/beacon`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ e: 'salma_name_saved' }), keepalive: true }).catch(() => {});
  };

  // ── Salma SPEAKS her bubbles (owner order 07-12: "why does Salma not have any voice"). ──
  // Spoken on every beat change through the same cached native pipeline the drills use. The very
  // first beat may lack a fresh user gesture (autoplay policy) → playNative fails SILENTLY and the
  // text still carries the beat; every subsequent beat follows a tap, so her voice lands there.
  // German only for now — when the owner ships her ElevenLabs masri clips they take these slots.
  const speakStop = useRef(null);
  const bubblesRef = useRef([]);
  useEffect(() => {
    if (lang === 'ar') return;                       // no German voice over (future) Arabic text
    try { speakStop.current?.(); } catch { /* ignore */ }
    speakStop.current = null;
    const text = bubblesRef.current.join(' … ');
    if (text && text !== '…') {
      speakStop.current = playNative({ apiUrl, token, text, voice: SALMA_VOICE });
    }
    return () => { try { speakStop.current?.(); } catch { /* ignore */ } speakStop.current = null; };
  }, [beat, lang, apiUrl, token]);

  // The Assessment closed (App bumped resumeTick) → fetch the fresh server-persisted verdict and
  // resume on the right beat. Only reacts while we're waiting on the screening.
  useEffect(() => {
    if (resumeTick === seenTick.current) return;
    seenTick.current = resumeTick;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/assessment/status`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const d = await r.json();
        if (!alive) return;
        if (d?.result) { setResult(d.result); setBeat('verdict'); }
        else setBeat('no_verdict');
      } catch { if (alive) setBeat('no_verdict'); }
    })();
    return () => { alive = false; };
  }, [resumeTick, apiUrl, token]);

  // ── Beat content ────────────────────────────────────────────────────────────
  const bubbles = [];
  let actions = null;

  if (beat === 'welcome') {
    if (returning) {
      bubbles.push(ctx.profile?.name
        ? line('returning_welcome_named', { name: ctx.profile.name })
        : line('returning_welcome'));
      actions = (
        <>
          <button style={btnBlue} onClick={() => setBeat(ctx.profile?.name ? 'handoff' : 'name_goal')}>{line('continue_label')}</button>
          {skipLink(line('skip_label'), () => finish('salma_skipped'))}
        </>
      );
    } else {
      bubbles.push(line('intro_welcome'));
      if (ctx.trialDays > 0) bubbles.push(line('intro_trial', { days: ctx.trialDays }));
      actions = (
        <>
          <button style={btnBlue} onClick={() => setBeat('name_goal')}>{line('continue_label')}</button>
          {skipLink(line('skip_label'), () => finish('salma_skipped'))}
        </>
      );
    }
  } else if (beat === 'name_goal') {
    bubbles.push(line('name_ask'));
    actions = (
      <>
        <label style={{ display: 'block', textAlign: 'left' }}>
          <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.05em' }}>{line('name_label')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name"
            style={{ width: '100%', marginTop: 4, padding: '11px 12px', borderRadius: 10, fontSize: 15,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.35)', color: '#e2e8f0' }} />
        </label>
        <div style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.05em', marginTop: 12, textAlign: 'left' }}>{line('goal_ask')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {GOALS.map((g) => (
            <button key={g.value} onClick={() => setGoal(g.value)}
              style={{ ...chip, ...(goal === g.value ? chipOn : null) }}>{line(g.key)}</button>
          ))}
        </div>
        <button style={{ ...btnBlue, marginTop: 14 }}
          onClick={() => { saveProfile(); setBeat(returning ? 'handoff' : 'screening'); }}>
          {line('continue_label')}
        </button>
        {skipLink(line('skip_label'), () => finish('salma_skipped'))}
      </>
    );
  } else if (beat === 'screening') {
    bubbles.push(line('screening_invite'));
    actions = (
      <>
        <button style={btnOrange} onClick={onStartScreening}>{line('screening_cta')}</button>
        {skipLink(line('skip_label'), () => finish('salma_skipped'))}
      </>
    );
  } else if (beat === 'verdict') {
    const level = result?.estimatedLevel || '—';
    const focus = pickText(result?.recommendedFocus, lang);
    bubbles.push(line('verdict_summary', { level, focus: focus || '—' }));
    const quote = firstBlockerQuote(result);
    if (quote) bubbles.push(line('verdict_blocker', { quote }));
    bubbles.push(line(bookingCopyKey(result?.estimatedLevel)));
    actions = (
      <>
        <button style={btnOrange} onClick={() => { markSeen(); onBookFight(result); }}>{line('booking_cta')}</button>
        {skipLink(line('later_label'), () => finish('salma_later'))}
      </>
    );
  } else if (beat === 'no_verdict') {
    bubbles.push(line('no_verdict'));
    actions = (
      <>
        <button style={btnBlue} onClick={onStartScreening}>{line('no_verdict_resume')}</button>
        <button style={{ ...btnBlue, background: 'rgba(59,130,246,0.14)', color: '#bfdbfe' }}
          onClick={() => { markSeen(); onBookFight(null); }}>{line('no_verdict_direct')}</button>
        {skipLink(line('later_label'), () => finish('salma_later'))}
      </>
    );
  } else if (beat === 'handoff') {
    bubbles.push(line('returning_handoff'));
    actions = <button style={btnBlue} onClick={() => finish('salma_done')}>{line('returning_cta')}</button>;
  } else if (beat === 'checking') {
    bubbles.push('…');   // verdict fetch in flight (sub-second on a warm server); resolves to verdict | no_verdict
  }

  bubblesRef.current = bubbles;   // snapshot for the speak effect (runs post-render per beat)

  return (
    <div style={backdrop}>
      <div style={card}>
        {/* header — her face on the door */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SalmaPortrait fallback={salmaName(lang).charAt(0)} />
          <div style={{ lineHeight: 1.25, textAlign: 'left' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0' }}>{salmaName(lang)}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.04em' }}>{salmaRole(lang)}</div>
          </div>
          <button aria-label="Schließen" onClick={() => finish('salma_skipped')}
            style={{ marginLeft: 'auto', minWidth: 44, minHeight: 44, background: 'none', border: 'none',
              color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* her chat bubbles — dir=auto so owner-filled masri renders RTL natively */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bubbles.map((b, i) => (
            <div key={i} dir="auto" style={{ ...bubble, animationDelay: `${i * 0.12}s` }}>{b}</div>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>{actions}</div>
      </div>
    </div>
  );
}

// One verified own-words quote from the assessment's blocker list (upstream guarantees the quote
// literally appeared in the transcript — anti-fabrication in server/assessment.js). Field name
// differs across result versions, so probe the known spellings; never synthesize.
function firstBlockerQuote(result) {
  const b = Array.isArray(result?.blockers) ? result.blockers[0] : null;
  if (!b) return null;
  const q = b.example_from_their_own_answer || b.exampleFromTheirOwnAnswer || b.example || b.quote || null;
  return (typeof q === 'string' && q.trim().length >= 3) ? q.trim().slice(0, 90) : null;
}
// recommendedFocus may be a plain string or a {de, ar} pair depending on result version.
function pickText(v, lang) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return (lang === 'ar' && v.ar) ? v.ar : (v.de || v.ar || null);
}

function bookingCopyKey(level) {
  if (level === 'B2') return 'booking_karim';
  if (level === 'C1' || level === 'C2') return 'booking_hana';
  return 'booking_yasmin';
}

function SalmaPortrait({ fallback }) {
  return (
    <div style={portrait} role="img" aria-label="Salma, illustrierte Recruiterin">
      <div style={portraitHair} />
      <div style={portraitFace}>
        <span style={{ ...portraitEye, left: 10 }} />
        <span style={{ ...portraitEye, right: 10 }} />
        <span style={portraitSmile} />
      </div>
      <div style={portraitShoulders} />
      <span aria-hidden="true" style={portraitFallback}>{fallback}</span>
    </div>
  );
}

function skipLink(label, onClick) {
  return (
    <button onClick={onClick} style={{ display: 'block', margin: '10px auto 0', minHeight: 44, padding: '4px 16px',
      background: 'none', border: 'none', color: '#64748b', fontSize: 12.5, cursor: 'pointer',
      textDecoration: 'underline', textUnderlineOffset: 3 }}>{label}</button>
  );
}

// ── styles (blue+orange system; the ONE orange per beat is the primary CTA) ──────────────────
const backdrop = { position: 'fixed', inset: 0, zIndex: 240, display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: 18, background: 'rgba(2,4,9,0.92)', backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)', animation: 'flash-in 0.3s var(--ease)' };
const card = { width: '100%', maxWidth: 400, maxHeight: '86vh', overflowY: 'auto', padding: 18,
  borderRadius: 16, background: 'linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,14,26,0.97))',
  border: '1px solid rgba(59,130,246,0.30)', boxShadow: '0 18px 60px rgba(0,0,0,0.6)' };
const portrait = { position: 'relative', width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
  overflow: 'hidden', background: 'linear-gradient(145deg, #172554, #0f172a)',
  border: '2px solid rgba(96,165,250,0.72)', boxShadow: '0 0 14px rgba(59,130,246,0.35)' };
const portraitHair = { position: 'absolute', width: 29, height: 29, left: 6, top: 5, borderRadius: '52% 52% 42% 42%',
  background: '#172033', transform: 'rotate(-4deg)', zIndex: 1 };
const portraitFace = { position: 'absolute', width: 24, height: 27, left: 9, top: 8, borderRadius: '48% 48% 44% 44%',
  background: 'linear-gradient(145deg, #e8b38f, #c98662)', zIndex: 2 };
const portraitEye = { position: 'absolute', top: 11, width: 3, height: 3, borderRadius: '50%', background: '#1e293b' };
const portraitSmile = { position: 'absolute', left: 8, top: 18, width: 8, height: 4, borderBottom: '1.5px solid #7c2d12',
  borderRadius: '0 0 8px 8px' };
const portraitShoulders = { position: 'absolute', width: 36, height: 18, left: 3, top: 31, borderRadius: '50% 50% 0 0',
  background: 'linear-gradient(90deg, #1d4ed8, #3b82f6)', zIndex: 3 };
const portraitFallback = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };
const bubble = { padding: '10px 12px', borderRadius: '4px 12px 12px 12px', fontSize: 13.5, lineHeight: 1.6,
  color: '#e2e8f0', background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.22)',
  animation: 'result-rise 0.45s var(--ease) both', textAlign: 'left' };
const btnBlue = { width: '100%', minHeight: 46, padding: '12px 14px', borderRadius: 10, border: 'none',
  cursor: 'pointer', fontWeight: 800, fontSize: 14.5, color: '#04110b',
  background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' };
const btnOrange = { width: '100%', minHeight: 46, padding: '12px 14px', borderRadius: 10, border: 'none',
  cursor: 'pointer', fontWeight: 800, fontSize: 14.5, color: '#1a0d02',
  background: 'linear-gradient(90deg, var(--action, #f97316), #fb923c)',
  boxShadow: '0 6px 22px rgba(249,115,22,0.35)' };
const chip = { padding: '9px 12px', minHeight: 40, borderRadius: 'var(--r-pill, 999px)', fontSize: 12.5,
  cursor: 'pointer', color: '#cbd5e1', background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.14)' };
const chipOn = { color: '#dbeafe', background: 'rgba(59,130,246,0.18)', border: '1px solid rgba(59,130,246,0.6)' };
