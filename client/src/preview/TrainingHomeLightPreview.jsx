/**
 * TrainingHomeLightPreview.jsx — PHASE-1 PROTOTYPE ONLY. Not shipped to users.
 *
 * Reached exclusively via `?preview=light` (wired in main.jsx as a lazy branch, so it never enters
 * the production bundle). Its single job is to let the owner APPROVE OR KILL the light "Speak"
 * direction from one 390px screenshot before any of the real migration (Phase 2+) is attempted.
 *
 * DESIGN INTENT (from Speak / Headspace, owner references 2026-07-24):
 *   near-white ground · one streak/level chip · ONE dark headline (the next step) · ONE white
 *   action card carrying Salma's photo used LARGE + the task + a single filled INTERVIEW button ·
 *   then real emptiness (~half the viewport) · orientation kept quiet BELOW the fold, always
 *   rendered (never hidden). One orange object on the screen: the button.
 *
 * SCOPING: the light token VALUES live on the `.preview-light` wrapper only — same NAMES as the
 * global :root so the approved language ports verbatim in Phase 2, but the global theme is left
 * completely untouched. The real Training home (App.jsx / BrainGuide.jsx) is NOT edited by this PR.
 *
 * HONESTY: the card + orientation reuse the REAL server-brief shape and real German from
 * BrainGuide.jsx's `interview` prescription (title/dose/done/after). No fabricated hireability,
 * CEFR, counts, or "du verbesserst dich" claims. The synthetic "Interne Simulation" footer stays.
 */
import { SalmaPortrait } from '../SalmaTakeover.jsx';
import { salmaName, salmaRole } from '../salmaCopy.js';
import { actionBtn } from '../ui/primitives.js';

// The light theme, scoped to this prototype. Same token names as the global :root (App.jsx ~L896)
// so Phase 2 is a value re-map, not a rename. NOTE: template literal — no backticks inside.
const PREVIEW_LIGHT_CSS = `
.preview-light {
  --bg:#FAFAF8; --surface:#FFFFFF; --surface-2:#F4F4F1;
  --line:rgba(15,23,42,0.08); --line-strong:rgba(15,23,42,0.14);
  --text:#0F172A; --text-dim:#475569; --text-faint:#64748B;
  --accent:#3b82f6; --action:#f97316;
  --grad-action:linear-gradient(180deg,#fb923c,#f97316);
  --shadow-action:0 10px 24px -8px rgba(249,115,22,0.42);
  --card-shadow:0 22px 60px -28px rgba(15,23,42,0.35), 0 2px 8px -4px rgba(15,23,42,0.10);
  --font-display:'Inter','system-ui',sans-serif;
  position:fixed; inset:0; overflow-y:auto; background:var(--bg); color:var(--text);
  font-family:var(--font-display); -webkit-font-smoothing:antialiased;
}
.preview-light * { box-sizing:border-box; }
.pl-shell { max-width:440px; margin:0 auto; min-height:100%; padding:20px 22px 40px;
  display:flex; flex-direction:column; }
.pl-header { display:flex; align-items:center; justify-content:space-between; padding:6px 0 40px; }
.pl-chip { display:inline-flex; align-items:center; gap:8px; padding:8px 14px; border-radius:999px;
  background:var(--surface); border:1px solid var(--line); box-shadow:0 1px 2px rgba(15,23,42,0.04);
  font-size:13px; font-weight:600; color:var(--text-dim); }
.pl-chip b { color:var(--text); font-weight:700; }
.pl-dot { width:8px; height:8px; border-radius:999px; background:var(--accent); }
.pl-hello { font-size:14px; font-weight:600; color:var(--text-faint); }
.pl-headline { margin:0 0 24px; font-size:clamp(30px,8.5vw,38px); line-height:1.08;
  letter-spacing:-0.02em; font-weight:700; color:var(--text); }
.pl-card { background:var(--surface); border-radius:24px; padding:26px 22px 22px;
  box-shadow:var(--card-shadow); display:flex; flex-direction:column; align-items:center;
  text-align:center; }
.pl-card-face { margin-bottom:16px; }
.pl-card-coach { font-size:13px; font-weight:600; color:var(--text-faint); margin-bottom:14px; }
.pl-card-coach b { color:var(--text); font-weight:700; }
.pl-card-task { margin:0 0 6px; font-size:20px; font-weight:700; letter-spacing:-0.01em;
  color:var(--text); }
.pl-card-dose { margin:0 0 22px; font-size:14.5px; line-height:1.5; color:var(--text-dim); }
.pl-card-btn { width:100%; }
.pl-empty { flex:1 1 auto; min-height:22vh; }
.pl-orient { padding-top:8px; border-top:1px solid var(--line); }
.pl-orient-row { padding:14px 0; border-bottom:1px solid var(--line); }
.pl-orient-row:last-child { border-bottom:none; }
.pl-orient-k { font-size:12.5px; font-weight:600; color:var(--text-faint); margin:0 0 3px; }
.pl-orient-v { font-size:14px; line-height:1.5; color:var(--text-dim); margin:0; }
.pl-foot { margin-top:20px; text-align:center; font-size:11.5px; color:var(--text-faint); }
@media (prefers-reduced-motion:reduce) { .preview-light * { animation:none!important; } }
`;

// A REPRESENTATIVE server brief — the real shape and real German from BrainGuide.jsx's `interview`
// prescription (missionBrief, L154). Not fabricated: these are the exact honest facts the live
// brain already emits for this step.
const BRIEF = {
  task:   'Ein Interview sprechen',
  dose:   'Ein vollständiges gesprochenes Interview — nimm dir 8–10 Minuten und sprich frei.',
  reason: 'Ich muss dich noch einmal live hören, um deinen nächsten Engpass sicher zu bestimmen.',
  done:   'Der serverseitige Debrief ist vollständig gespeichert.',
  after:  'Danach wähle ich genau eine Sache, an der wir als Nächstes arbeiten.',
  goal:   'Dein Ziel: ein deutsches BPO-Interview souverän auf Deutsch bestehen.',
};

export default function TrainingHomeLightPreview() {
  return (
    <div className="preview-light">
      <style>{PREVIEW_LIGHT_CSS}</style>
      <div className="pl-shell">

        <header className="pl-header">
          <span className="pl-chip"><span className="pl-dot" aria-hidden="true" />Level <b>2</b></span>
          <span className="pl-hello">Willkommen zurück</span>
        </header>

        {/* The one message: the single next step, stated plainly in Salma's voice. */}
        {/* OWNER-AR slot */}
        <h1 className="pl-headline">Lass uns ein Interview sprechen.</h1>

        {/* The ONE action card — Salma's photo LARGE, the task, one filled button. */}
        <section className="pl-card">
          <div className="pl-card-face">
            <SalmaPortrait fallback={salmaName().charAt(0)} size={104} />
          </div>
          <div className="pl-card-coach"><b>{salmaName()}</b> · {salmaRole()}</div>
          <h2 className="pl-card-task">{BRIEF.task}</h2>
          <p className="pl-card-dose">{BRIEF.dose}</p>
          {/* The protected INTERVIEW control, inside the first viewport. One orange object. */}
          {/* OWNER-AR slot */}
          <button type="button" className="pl-card-btn" style={{ ...actionBtn }}>
            INTERVIEW STARTEN
          </button>
        </section>

        {/* Real emptiness — the premium signal. ~half the viewport carries nothing. */}
        <div className="pl-empty" aria-hidden="true" />

        {/* Orientation: quiet, below the fold, ALWAYS rendered (never collapsed). */}
        <section className="pl-orient" aria-label="Orientierung">
          <div className="pl-orient-row">
            <p className="pl-orient-k">Warum jetzt</p>
            <p className="pl-orient-v">{BRIEF.reason}</p>
          </div>
          <div className="pl-orient-row">
            <p className="pl-orient-k">Fertig, wenn</p>
            <p className="pl-orient-v">{BRIEF.done}</p>
          </div>
          <div className="pl-orient-row">
            <p className="pl-orient-k">Danach</p>
            <p className="pl-orient-v">{BRIEF.after}</p>
          </div>
          <div className="pl-orient-row">
            <p className="pl-orient-k">Das Ziel</p>
            <p className="pl-orient-v">{BRIEF.goal}</p>
          </div>
        </section>

        <p className="pl-foot">Interne Simulation · keine Arbeitgeberentscheidung</p>

      </div>
    </div>
  );
}
