/**
 * SalmaTakeover.jsx — the one-time tutor introduction. Fires ONCE per account (server flag
 * salmaIntroAt, localStorage mirror), explains why measurement comes first, launches the existing
 * Assessment, reports only its persisted result, and hands the learner into a training interview.
 *
 * LAW: every word comes from salmaCopy.js owner templates — no LLM, no invented data (El-Captain
 * precedent). The Assessment itself is untouched; while it runs, App hides this overlay and bumps
 * `resumeTick` when it closes so the flow resumes on the verdict beat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { salmaLine, salmaName, salmaRole } from './salmaCopy.js';
import { SpeakerIcon, CloseIcon } from './icons/AudioIcons';
import { salmaSpeak, subscribeSalmaSpeaking, subscribeSalmaLevel } from './salmaVoice.js';
import { stopTutorWhenDocumentHidden } from './salmaAudioSafety.js';

// estimatedLevel (A1–C2 from the assessment) → the app's three interview levels. Same map as the
// legacy auto-set in App.jsx (D10): the MEASURED level drives the first booked interview.
export const ASSESS_LEVEL_MAP = { A1: 'a2-b1', A2: 'a2-b1', B1: 'a2-b1', B2: 'b2', C1: 'c1', C2: 'c1' };
export const ASSESS_BOSS_MAP = { A1: 'yasmin', A2: 'yasmin', B1: 'yasmin', B2: 'karim', C1: 'hana', C2: 'hana' };

export function SalmaTakeover({ token, apiUrl, lang, ctx, resumeTick, brainDirective, onBrainAction, onBookFight, onClose }) {
  // New learner: one explanation → measured screening. Returning learner: one introduction →
  // BrainGuide handoff. A self-reported CEFR level is never used to diagnose, exclude, or select a
  // training interview; only the persisted Assessment result may drive the mapping below.
  // While the assessment runs, App UNMOUNTS this overlay (one takeover at a time) — so on a
  // remount with resumeTick > 0 we start in 'checking' and the effect below fetches the verdict.
  const [beat, setBeat]   = useState(resumeTick > 0 ? 'checking' : 'welcome');
  const [result, setResult] = useState(ctx.result || null);
  const returning = ctx.variant === 'returning';
  const seenTick  = useRef(0);
  const speechStopRef = useRef(null);
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const finishRef = useRef(() => {});

  const stopSpeech = useCallback(() => {
    try { speechStopRef.current?.(); } catch { /* audio cleanup is best-effort */ }
    speechStopRef.current = null;
  }, []);
  useEffect(() => {
    const removeHiddenStop = stopTutorWhenDocumentHidden();
    return () => { removeHiddenStop(); stopSpeech(); };
  }, [stopSpeech]);

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
  const finish = (beaconId) => { stopSpeech(); markSeen(); onClose(beaconId); };
  finishRef.current = () => finish('salma_skipped');

  // This is a genuine modal takeover: it keeps keyboard focus inside while it is open,
  // returns focus to the control that launched it, and never leaves a keyboard user behind
  // the dimmed page. The voice/interview system is deliberately not involved here.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector('[data-salma-primary],button:not([disabled])')?.focus();
    }, 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finishRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])]
        .filter((node) => node instanceof HTMLElement && !node.hasAttribute('hidden'));
      if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  // Salma never auto-speaks here. The explicit speaker button is the only path to salmaSpeak, so
  // opening this one-time flow remains silent until the learner asks to hear it.
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
  // `say` renders a bubble and records its fixed template for the explicit listen button.
  const bubbles = [];
  const spoken = [];
  const say = (key, slots, arSlots) => { spoken.push({ key, slots, arSlots }); return line(key, slots); };
  let actions = null;

  if (beat === 'welcome') {
    if (returning) {
      bubbles.push(ctx.profile?.name
        ? say('returning_welcome_named', { name: ctx.profile.name })
        : say('returning_welcome'));
      actions = (
        <>
          <button data-salma-primary style={btnBlue} onClick={() => setBeat('handoff')}>{line('continue_label')}</button>
          {skipLink(line('skip_label'), () => finish('salma_skipped'))}
        </>
      );
    } else {
      bubbles.push(say('intro_welcome'));
      const assessmentReady = brainDirective?.prescription?.action === 'assessment';
      if (assessmentReady) {
        bubbles.push(say('screening_invite'));
        actions = (
          <>
            <button data-salma-primary style={btnOrange} onClick={() => {
              stopSpeech();
              markSeen();
              onClose('salma_done');
              onBrainAction(brainDirective);
            }}>{line('screening_cta')}</button>
            {skipLink(line('skip_label'), () => finish('salma_skipped'))}
          </>
        );
      } else if (brainDirective?.prescription?.action) {
        // A changed server directive always wins. Salma closes and exposes BrainGuide instead of
        // inventing a diagnosis or dispatching a stale legacy action.
        bubbles.push(say('returning_handoff'));
        actions = <button data-salma-primary style={btnBlue} onClick={() => finish('salma_done')}>{line('continue_label')}</button>;
      } else {
        bubbles.push(say('screening_loading'));
        actions = (
          <>
            <button data-salma-primary style={{ ...btnOrange, opacity: 0.55, cursor: 'wait' }} disabled>
              {line('screening_loading_cta')}
            </button>
            {skipLink(line('skip_label'), () => finish('salma_skipped'))}
          </>
        );
      }
    }
  } else if (beat === 'verdict') {
    const level = result?.estimatedLevel || '—';
    const focus = pickText(result?.recommendedFocus, lang);
    // The runtime remains German-only until a complete frozen Masri pack is approved. We still
    // retain the bounded alternate slot for future approved assets.
    const focusAr = pickText(result?.recommendedFocus, 'ar');
    bubbles.push(say('verdict_summary', { level, focus: focus || '—' }, { level, focus: focusAr || focus || '—' }));
    // This branch is based on measured Assessment evidence, never the learner's self-report.
    if (level === 'A1' || level === 'A2') bubbles.push(say('verdict_below_b1', { level }));
    const quote = firstBlockerQuote(result);
    if (quote) bubbles.push(say('verdict_blocker', { quote }));
    bubbles.push(say(bookingCopyKey(result?.estimatedLevel)));
    actions = (
      <>
        <button data-salma-primary style={btnOrange} onClick={() => { stopSpeech(); markSeen(); onBookFight(result); }}>{line('booking_cta')}</button>
        {skipLink(line('later_label'), () => finish('salma_later'))}
      </>
    );
  } else if (beat === 'no_verdict') {
    bubbles.push(say('no_verdict'));
    actions = (
      <>
        <button data-salma-primary style={btnOrange}
          onClick={() => { stopSpeech(); markSeen(); onBookFight(null); }}>{line('no_verdict_direct')}</button>
        {skipLink(line('later_label'), () => finish('salma_later'))}
      </>
    );
  } else if (beat === 'handoff') {
    bubbles.push(say('returning_handoff'));
    actions = <button data-salma-primary style={btnBlue} onClick={() => finish('salma_done')}>{line('returning_cta')}</button>;
  } else if (beat === 'checking') {
    bubbles.push('…');   // verdict fetch in flight (sub-second on a warm server); resolves to verdict | no_verdict
  }

  return (
    <div className="salma-takeover-focus" style={backdrop}>
      <style>{TAKEOVER_A11Y_CSS}</style>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="salma-takeover-title"
        aria-describedby="salma-takeover-message" tabIndex={-1} lang={lang === 'ar' ? 'ar-EG' : 'de'} style={card}>
        {/* header — her face on the door */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SalmaPortrait fallback={salmaName(lang).charAt(0)} size={52} />
          <div style={{ lineHeight: 1.25, textAlign: 'left' }}>
            <h2 id="salma-takeover-title" style={{ margin: 0, fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{salmaName(lang)}</h2>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>{salmaRole(lang)}</div>
          </div>
          <button aria-label="Salma anhören" onClick={() => {
            stopSpeech();
            if (spoken.length) speechStopRef.current = salmaSpeak({ apiUrl, token, items: spoken,
              onEnd: () => { speechStopRef.current = null; } });
          }} style={{ marginLeft: 'auto', minWidth: 44, minHeight: 44, padding: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, border: '1px solid rgba(59,130,246,0.45)', color: 'var(--accent)',
            background: 'rgba(59,130,246,0.10)' }}><SpeakerIcon /></button>
          <button aria-label="Schließen" onClick={() => finish('salma_skipped')}
            style={{ minWidth: 44, minHeight: 44, background: 'none', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-faint)', cursor: 'pointer' }}><CloseIcon /></button>
        </div>

        {/* her chat bubbles — dir=auto so owner-filled masri renders RTL natively */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bubbles.map((b, i) => (
            <div id={i === 0 ? 'salma-takeover-message' : undefined} key={i} dir="auto" style={bubble}>{b}</div>
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

// Salma's face — a warm, ATTRACTIVE, LIVING illustrated portrait (owner 07-12: "make her face
// bigger, extremely attractive and moving"). Self-contained inline SVG ($0, crisp at any size).
// Motion is limited to a gentle sway, natural blink, and the real-audio presence ring.
// Static gradient ids + shared keyframes are identical across instances, so any duplication on a
// page resolves to the same visuals.
// Salma's face — the app's tutor avatar. A SYNTHETIC (AI-generated, no real person → no likeness
// risk) attractive young-woman photo, cropped to the face + downscaled to an 18KB /salma.jpg (owner
// 07-13: "an attractive German young lady, find me one"). Motion: she gently sways/breathes on a loop
// and her ring reacts to real audio while she speaks. prefers-reduced-motion disables it.
// Pure CSS drives only a rare natural blink; the portrait never claims lip synchronization.
// There is intentionally no idle sway, idle glow, or synthetic talking animation. The ring below
// responds only to actual Salma playback levels supplied by salmaVoice.js.
const SALMA_FACE_CSS = `
.salma-photo .stack{position:absolute;inset:0}
.salma-photo .face{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 38%;display:block}
.salma-photo .lids{opacity:0;animation:salmaBlink 5.4s ease-in-out infinite}
/* The ring is an audio meter, not a generic "she is talking" animation. */
.salma-photo .vring{position:absolute;inset:-3px;border-radius:inherit;border:2.5px solid var(--action, #D9541A);opacity:0;pointer-events:none;transition:opacity 70ms linear,transform 70ms linear}
@keyframes salmaBlink{0%,92%{opacity:0}95%{opacity:1}98%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.salma-photo .lids{animation:none;opacity:0}.salma-photo .vring{transition:none}}`;

const TAKEOVER_A11Y_CSS = `
.salma-takeover-focus :focus-visible{outline:3px solid #bfdbfe;outline-offset:3px}
@media (prefers-reduced-motion:reduce){.salma-takeover-focus *{animation:none!important;transition:none!important}}
`;
export function SalmaPortrait({ fallback = 'S', size = 44, speaking = false }) {
  const hideOnErr = (e) => { e.currentTarget.style.display = 'none'; };
  // Real Salma playback activates the presence ring; callers may also set `speaking` explicitly.
  const [liveSpeaking, setLiveSpeaking] = useState(false);
  useEffect(() => subscribeSalmaSpeaking(setLiveSpeaking), []);
  const talk = speaking || liveSpeaking;
  // The visible ring is driven from real playback amplitude. It never substitutes a generic talking
  // animation or claims that the portrait's lips synchronize with the audio.
  const rootRef = useRef(null);
  const ringRef = useRef(null);
  const talkRef = useRef(talk); talkRef.current = talk;
  const [lvlActive, setLvlActive] = useState(false);
  const lvlActiveRef = useRef(false);
  useEffect(() => subscribeSalmaLevel((v) => {
    if (!lvlActiveRef.current) { lvlActiveRef.current = true; setLvlActive(true); }
    const on = talkRef.current;
    const ring = ringRef.current;   // the voice-ring tracks her real loudness (world-class reactive presence)
    if (ring) { ring.style.opacity = on ? Math.min(0.95, v * 1.7).toFixed(2) : '0'; ring.style.transform = `scale(${(1 + v * 0.09).toFixed(3)})`; }
  }), []);
  return (
    <div ref={rootRef} style={{ ...portrait, width: size, height: size }}
      className={`salma-photo${talk ? ' talk' : ''}${lvlActive ? ' lvl' : ''}`}
      role="img" aria-label="Salma, persönliche Interviewtrainerin">
      <style>{SALMA_FACE_CSS}</style>
      <div className="vring" ref={ringRef} aria-hidden="true" />
      <span aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--accent)', fontWeight: 800, fontSize: Math.round(size * 0.42) }}>{fallback}</span>
      <div className="stack">
        <img className="face base" src="/salma.jpg" alt="" aria-hidden="true" decoding="async" width="200" height="200" onError={hideOnErr} />
        <img className="face lids" src="/salma-blink.jpg" alt="" aria-hidden="true" decoding="async" width="200" height="200" onError={hideOnErr} />
      </div>
    </div>
  );
}

function skipLink(label, onClick) {
  return (
    <button onClick={onClick} style={{ display: 'block', margin: '10px auto 0', minHeight: 44, padding: '4px 16px',
      background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 12.5, cursor: 'pointer',
      textDecoration: 'underline', textUnderlineOffset: 3 }}>{label}</button>
  );
}

// ── styles (blue+orange system; the ONE orange per beat is the primary CTA) ──────────────────
const backdrop = { position: 'fixed', inset: 0, zIndex: 240, display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: 18, background: 'rgba(14,19,32,0.42)', backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)', animation: 'flash-in 0.3s var(--ease)' };
const card = { width: '100%', maxWidth: 400, maxHeight: '86vh', overflowY: 'auto', padding: 18,
  borderRadius: 20, background: 'var(--surface)',
  border: '1px solid var(--line)', boxShadow: '0 24px 60px -20px rgba(14,19,32,0.28)' };
const portrait = { position: 'relative', width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
  overflow: 'hidden', background: 'var(--surface-2)',
  border: '2px solid rgba(14,19,32,0.14)', boxShadow: '0 2px 10px rgba(14,19,32,0.14)' };
const portraitFallback = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };
const bubble = { padding: '10px 12px', borderRadius: '4px 12px 12px 12px', fontSize: 13.5, lineHeight: 1.6,
  color: 'var(--text)', background: 'var(--surface-2)', border: '1px solid var(--line)',
  animation: 'result-rise 0.45s var(--ease) both', textAlign: 'left' };
const btnBlue = { width: '100%', minHeight: 46, padding: '12px 14px', borderRadius: 10, border: 'none',
  cursor: 'pointer', fontWeight: 700, fontSize: 15, color: '#FFFFFF',
  background: 'var(--text)' };
const btnOrange = { width: '100%', minHeight: 46, padding: '12px 14px', borderRadius: 10, border: 'none',
  cursor: 'pointer', fontWeight: 700, fontSize: 15, color: '#FFFFFF',
  background: 'var(--action, #D9541A)',
  boxShadow: '0 1px 2px rgba(18,22,31,0.2)' };
