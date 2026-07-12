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
import { salmaLine, salmaName, salmaRole } from './salmaCopy.js';
import { salmaSpeak, composeSalmaSpoken, SALMA_VOICE_AR, SALMA_VOICE_DE } from './salmaVoice.js';

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
  // Beats: gate → welcome → name_goal → screening → (assessment runs outside) → verdict | no_verdict.
  // Returning variant: welcome → (name_goal if no name) → handoff (existing customers skip the gate).
  // The gate is the B1+ admission bar (owner law 07-12, Harvard framing): she ASKS the level;
  // B1+ walks in, below gets a dignified turn-away — and the screening stays the real exam.
  // While the assessment runs, App UNMOUNTS this overlay (one takeover at a time) — so on a
  // remount with resumeTick > 0 we start in 'checking' and the effect below fetches the verdict.
  const [beat, setBeat]   = useState(resumeTick > 0 ? 'checking' : (ctx.variant === 'returning' ? 'welcome' : 'gate'));
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

  // ── Salma SPEAKS her bubbles AND leads the candidate onward herself ─────────────────────────
  // (owner 07-12: "she's slow, passive, waits for me to click, doesn't guide"). Two behaviors:
  //  • SPEAK — every beat change speaks its bubbles masri-first (salmaSpeak) through the cached
  //    native pipeline; owner-filled masri wins in both UI languages, unfilled falls back to Aura.
  //  • LEAD — on a pure-narration beat she does NOT park on a "Weiter" button: once she was
  //    actually HEARD (onStart fired) and a readable dwell passed, she advances the flow herself.
  //    The onStart gate is the whole trick — if autoplay blocked her (no user gesture yet, e.g.
  //    auto-login on a returning visit), onStart never fires, so she never SILENTLY auto-rushes;
  //    she waits for the one tap that unlocks audio, then leads from there. Decision/input beats
  //    (gate, name, screening, verdict) always wait for the human, by design.
  const speakStop = useRef(null);
  const spokenRef = useRef([]);
  // Beats Salma walks through on her own voice → the next beat (value may depend on ctx).
  const autoNext = { welcome: () => (returning ? (ctx.profile?.name ? 'handoff' : 'name_goal') : 'name_goal') };
  useEffect(() => {
    try { speakStop.current?.(); } catch { /* ignore */ }
    speakStop.current = null;
    const target = autoNext[beat]?.();
    let started = false, ended = false, dwellDone = false, fired = false;
    const advance = () => { if (fired || !target) return; fired = true; setBeat(target); };
    const maybe = () => { if (started && ended && dwellDone) advance(); };
    if (spokenRef.current.length) {
      speakStop.current = salmaSpeak({
        apiUrl, token, items: spokenRef.current,
        onStart: () => { started = true; },
        onEnd: () => { ended = true; maybe(); },
      });
    }
    let dwell = null, cap = null;
    if (target) {
      const chars = spokenRef.current.reduce((n, it) => n + (line(it.key, it.slots)?.length || 0), 0);
      const minMs = Math.min(6500, 1600 + chars * 42);   // scale the dwell to how much she says
      dwell = setTimeout(() => { dwellDone = true; maybe(); }, minMs);
      cap = setTimeout(() => { if (started) advance(); }, minMs + 6000);   // safety — only if she spoke
    }
    return () => {
      try { speakStop.current?.(); } catch { /* ignore */ }
      speakStop.current = null;
      if (dwell) clearTimeout(dwell); if (cap) clearTimeout(cap);
    };
  }, [beat, lang, apiUrl, token]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the dyno + pre-synthesize her OPENING line so her first words land instantly instead of
  // after a cold synth round-trip (owner 07-12: "extremely slow"). The first-mount profile fetch
  // already woke Render; this caches the opener in the background so real playback replays from
  // cache. Fire-and-forget, slot-exact so the cache key matches what she actually speaks.
  useEffect(() => {
    const opener = returning
      ? { key: ctx.profile?.name ? 'returning_welcome_named' : 'returning_welcome', slots: { name: ctx.profile?.name } }
      : { key: 'gate_question' };
    const { text, ar } = composeSalmaSpoken([opener]);
    if (!text) return;
    fetch(`${apiUrl}/api/media-ticket`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'aura', voice: ar ? SALMA_VOICE_AR : SALMA_VOICE_DE, text, drill: true, salma: true }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // `say` = a bubble Salma also SPEAKS: it renders via line() in the UI language AND records
  // {key, slots} so the speak effect can re-resolve the same lines masri-first for her voice.
  const bubbles = [];
  const spoken = [];
  const say = (key, slots, arSlots) => { spoken.push({ key, slots, arSlots }); return line(key, slots); };
  let actions = null;

  if (beat === 'gate') {
    bubbles.push(say('gate_question'));
    const answer = (yes) => {
      fetch(`${apiUrl}/api/beacon`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e: yes ? 'gate_b1_yes' : 'gate_b1_no' }), keepalive: true }).catch(() => {});
      setBeat(yes ? 'welcome' : 'gate_denied');
    };
    actions = (
      <>
        <button style={btnBlue} onClick={() => answer(true)}>{line('gate_b1')}</button>
        <button style={{ ...btnBlue, background: 'rgba(59,130,246,0.14)', color: '#bfdbfe' }}
          onClick={() => answer(false)}>{line('gate_below')}</button>
      </>
    );
  } else if (beat === 'gate_denied') {
    bubbles.push(say('gate_denied'));
    actions = (
      <>
        <button style={btnBlue} onClick={() => finish('salma_skipped')}>{line('returning_cta')}</button>
        {skipLink(line('gate_denied_browse'), () => finish('salma_skipped'))}
      </>
    );
  } else if (beat === 'welcome') {
    if (returning) {
      bubbles.push(ctx.profile?.name
        ? say('returning_welcome_named', { name: ctx.profile.name })
        : say('returning_welcome'));
      actions = (
        <>
          <button style={btnBlue} onClick={() => setBeat(ctx.profile?.name ? 'handoff' : 'name_goal')}>{line('continue_label')}</button>
          {skipLink(line('skip_label'), () => finish('salma_skipped'))}
        </>
      );
    } else {
      bubbles.push(say('intro_welcome'));
      if (ctx.trialDays > 0) bubbles.push(say('intro_trial', { days: ctx.trialDays }));
      actions = (
        <>
          <button style={btnBlue} onClick={() => setBeat('name_goal')}>{line('continue_label')}</button>
          {skipLink(line('skip_label'), () => finish('salma_skipped'))}
        </>
      );
    }
  } else if (beat === 'name_goal') {
    bubbles.push(say('name_ask'));
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
    bubbles.push(say('screening_invite'));
    actions = (
      <>
        <button style={btnOrange} onClick={onStartScreening}>{line('screening_cta')}</button>
        {skipLink(line('skip_label'), () => finish('salma_skipped'))}
      </>
    );
  } else if (beat === 'verdict') {
    const level = result?.estimatedLevel || '—';
    const focus = pickText(result?.recommendedFocus, lang);
    // Her spoken masri fills {focus} from recommendedFocus.ar (the backend ships both languages),
    // so the voice never splices display-language text into an Arabic sentence.
    const focusAr = pickText(result?.recommendedFocus, 'ar');
    bubbles.push(say('verdict_summary', { level, focus: focus || '—' }, { level, focus: focusAr || focus || '—' }));
    // B1+ positioning (owner law 07-12): below B1 she says the honest recruiter sentence — the
    // arena serves B1 aufwärts. No hard lock (their call), but the truth comes first.
    if (level === 'A1' || level === 'A2') bubbles.push(say('verdict_below_b1', { level }));
    const quote = firstBlockerQuote(result);
    if (quote) bubbles.push(say('verdict_blocker', { quote }));
    bubbles.push(say(bookingCopyKey(result?.estimatedLevel)));
    actions = (
      <>
        <button style={btnOrange} onClick={() => { markSeen(); onBookFight(result); }}>{line('booking_cta')}</button>
        {skipLink(line('later_label'), () => finish('salma_later'))}
      </>
    );
  } else if (beat === 'no_verdict') {
    bubbles.push(say('no_verdict'));
    actions = (
      <>
        <button style={btnBlue} onClick={onStartScreening}>{line('no_verdict_resume')}</button>
        <button style={{ ...btnBlue, background: 'rgba(59,130,246,0.14)', color: '#bfdbfe' }}
          onClick={() => { markSeen(); onBookFight(null); }}>{line('no_verdict_direct')}</button>
        {skipLink(line('later_label'), () => finish('salma_later'))}
      </>
    );
  } else if (beat === 'handoff') {
    bubbles.push(say('returning_handoff'));
    actions = <button style={btnBlue} onClick={() => finish('salma_done')}>{line('returning_cta')}</button>;
  } else if (beat === 'checking') {
    bubbles.push('…');   // verdict fetch in flight (sub-second on a warm server); resolves to verdict | no_verdict
  }

  spokenRef.current = spoken;   // snapshot for the speak effect (runs post-render per beat)

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
          <button aria-label="Salma anhören" onClick={() => {
            if (spoken.length) salmaSpeak({ apiUrl, token, items: spoken });
          }} style={{ marginLeft: 'auto', minWidth: 44, minHeight: 44, padding: 8, cursor: 'pointer',
            borderRadius: 10, border: '1px solid rgba(59,130,246,0.45)', color: '#bfdbfe',
            background: 'rgba(59,130,246,0.10)', fontSize: 16 }}>🔊</button>
          <button aria-label="Schließen" onClick={() => finish('salma_skipped')}
            style={{ minWidth: 44, minHeight: 44, background: 'none', border: 'none',
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

// Salma's face — a warm, professional illustrated portrait (owner 07-12: "no beautiful face";
// the old CSS-blob had dot-eyes + a geometric mouth). Self-contained inline SVG (viewBox scales to
// any size, crisp on retina, $0, no external asset). All instances share identical gradient defs,
// so duplicate ids across portraits resolve to identical gradients — visually correct either way.
export function SalmaPortrait({ fallback = 'S', size = 44 }) {
  return (
    <div style={{ ...portrait, width: size, height: size }} role="img" aria-label="Salma, Recruiterin">
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: 'block' }} aria-hidden="true">
        <defs>
          <linearGradient id="salmaSkin" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0" stopColor="#f7d4af" /><stop offset="1" stopColor="#dd9f6d" />
          </linearGradient>
          <linearGradient id="salmaHair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a2a1c" /><stop offset="0.6" stopColor="#20140c" /><stop offset="1" stopColor="#120b06" />
          </linearGradient>
          <linearGradient id="salmaBlazer" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1d4ed8" /><stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
          <radialGradient id="salmaBg" cx="0.5" cy="0.35" r="0.8">
            <stop offset="0" stopColor="#20304f" /><stop offset="1" stopColor="#0a1220" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill="url(#salmaBg)" />
        <path d="M22 50 C19 26 34 13 50 13 C66 13 81 26 78 50 C77 62 74 70 72 78 L67 68 C70 52 68 33 50 33 C32 33 30 52 33 68 L28 78 C26 70 23 62 22 50 Z" fill="url(#salmaHair)" />
        <path d="M22 100 C22 83 34 77 50 77 C66 77 78 83 78 100 Z" fill="url(#salmaBlazer)" />
        <path d="M50 77 L43 92 L50 87 L57 92 Z" fill="#eaf0fc" />
        <path d="M44 69 L44 80 C44 85 56 85 56 80 L56 69 Z" fill="#d99a67" />
        <ellipse cx="50" cy="49" rx="18.5" ry="21.5" fill="url(#salmaSkin)" />
        <ellipse cx="40.5" cy="55" rx="3.4" ry="2.3" fill="#e88a77" opacity="0.32" />
        <ellipse cx="59.5" cy="55" rx="3.4" ry="2.3" fill="#e88a77" opacity="0.32" />
        <path d="M39.5 42.5 Q44 39.8 48.5 42.3" stroke="#241610" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        <path d="M51.5 42.3 Q56 39.8 60.5 42.5" stroke="#241610" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        <ellipse cx="43" cy="48" rx="4.1" ry="2.9" fill="#fff" />
        <ellipse cx="57" cy="48" rx="4.1" ry="2.9" fill="#fff" />
        <circle cx="43.3" cy="48.2" r="2.05" fill="#4a3320" />
        <circle cx="56.7" cy="48.2" r="2.05" fill="#4a3320" />
        <circle cx="43.3" cy="48.2" r="0.9" fill="#1a1109" />
        <circle cx="56.7" cy="48.2" r="0.9" fill="#1a1109" />
        <circle cx="44" cy="47.4" r="0.5" fill="#fff" />
        <circle cx="57.4" cy="47.4" r="0.5" fill="#fff" />
        <path d="M38.9 47.3 Q43 44.6 47.1 47.3" stroke="#241610" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M52.9 47.3 Q57 44.6 61.1 47.3" stroke="#241610" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M50 50 L48.4 56 Q50 57.2 51.6 56" stroke="#c88a5c" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M44.5 62 Q50 61 55.5 62 Q50 67 44.5 62 Z" fill="#c65a55" />
        <path d="M44.5 62 Q50 63.4 55.5 62" stroke="#8f3b3a" strokeWidth="0.7" fill="none" />
        <path d="M30.5 46 C29 27 40 15.5 50 15.5 C61 15.5 70 22 71 36 C68 30 62 27.5 56.5 28.5 C60 31 61 35 59.5 39 C55 31.5 44.5 31 39.5 37 C36.5 40.5 33 42.5 30.5 46 Z" fill="url(#salmaHair)" />
      </svg>
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
