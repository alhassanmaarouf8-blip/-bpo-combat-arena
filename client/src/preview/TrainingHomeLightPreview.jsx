/**
 * TrainingHomeLightPreview.jsx — PREVIEW ONLY (?preview=light). Not shipped to users.
 *
 * v3 (2026-07-24) — rebuilt to answer the design critique on the v1/v2 mockups:
 *  - REAL React component rendered by the real Vite build (not a hand-drawn CSS mockup).
 *  - Salma is a FULL-BLEED HERO (kills the "navy rectangle clip-art" floating in a white card).
 *  - Left-aligned EDITORIAL layout — not the centered-card AI reflex.
 *  - ONE huge tight display line; everything else two steps down (design-system elite law).
 *  - Machined CTA: solid flat fill, ~12px radius, NO glow bloom, sentence case.
 *  - A real brand device (the two-voice-bars monogram from the design law), used as the anchor.
 *  - ONE decided light source (top-left) + a faint grain — "decided atmosphere", never noticed.
 *  - Rounding discipline: one big sheet radius, hairlines elsewhere.
 *
 * Data is a representative interview-prescription brief (the real shape BrainGuide emits); when this
 * graduates into the real home it reads the live directive. No fabricated claims. New German lines
 * carry OWNER-AR slots.
 */

// Representative next-step (the real 'interview' prescription shape from BrainGuide.missionBrief).
import PreviewNav from './PreviewNav.jsx';

const STEP = {
  greet:  'Salma',
  role:   'deine Recruiterin',
  kicker: 'Dein nächster Schritt',
  head:   'Ein Interview sprechen.',
  // Salma's voice — short, human, a little edge (a recruiter who has heard a thousand candidates).
  /* OWNER-AR slot */
  lead:   'Zehn Minuten. Sprich einfach los — den Rest mache ich.',
  /* OWNER-AR slot */
  cta:    'Interview starten',
  level:  'Level 2 · Tag 3',
  why:    'Ich muss dich einmal live hören.',
  after:  'Danach nehmen wir uns genau eine Sache vor.',
};

const CSS = `
.thl{position:fixed;inset:0;overflow-y:auto;background:#F5F3EF;color:#141821;
  font-family:'Inter','system-ui',sans-serif;-webkit-font-smoothing:antialiased}
.thl *{box-sizing:border-box}
/* one decided light source, top-left */
.thl::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(120% 90% at 8% -6%, rgba(255,255,255,.9), rgba(255,255,255,0) 46%)}
/* faint grain — felt, never noticed */
.thl::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.05;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.thl-in{position:relative;z-index:1;max-width:440px;margin:0 auto;min-height:100%}
/* hero — full-bleed Salma */
.thl-hero{position:relative;height:314px;overflow:hidden;background:#0e1b33}
.thl-hero img{width:100%;height:100%;object-fit:cover;object-position:50% 26%;display:block}
.thl-hero-grad{position:absolute;inset:0;
  background:linear-gradient(to bottom, rgba(10,16,28,.28) 0%, rgba(10,16,28,0) 26%, rgba(10,16,28,0) 52%, rgba(245,243,239,.2) 82%, #F5F3EF 100%)}
.thl-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;
  padding:18px 20px;z-index:2}
.thl-mark{display:flex;align-items:center;gap:9px}
.thl-mono{width:30px;height:30px;border-radius:9px;background:#0f1626;display:grid;place-items:center;
  box-shadow:0 2px 8px rgba(2,6,17,.4)}
.thl-mono i{display:block;width:3.5px;height:13px;border-radius:2px}
.thl-mono i:first-child{background:#3b82f6;margin-right:3px}
.thl-mono i:last-child{background:#f97316;height:9px}
.thl-wm{color:#fff;font-size:12.5px;font-weight:650;letter-spacing:.01em;text-shadow:0 1px 6px rgba(2,6,17,.5)}
.thl-chip{color:#fff;font-size:12px;font-weight:600;background:rgba(255,255,255,.16);
  border:1px solid rgba(255,255,255,.28);backdrop-filter:blur(8px);border-radius:999px;padding:6px 12px}
.thl-name{position:absolute;left:20px;bottom:44px;z-index:2}
.thl-name b{display:block;color:#fff;font-size:17px;font-weight:750;letter-spacing:-.01em;text-shadow:0 1px 8px rgba(2,6,17,.5)}
.thl-name span{color:rgba(255,255,255,.82);font-size:12.5px;font-weight:500}
/* sheet */
.thl-sheet{position:relative;margin-top:-26px;background:#F5F3EF;border-radius:26px 26px 0 0;padding:26px 22px 118px}
.thl-kick{font-size:12.5px;font-weight:650;color:#2563EB;letter-spacing:.02em;margin:0 0 8px}
.thl-h1{font-size:35px;line-height:1.04;letter-spacing:-.035em;font-weight:800;margin:0 0 12px;color:#0E1320;text-wrap:balance}
.thl-lead{font-size:15.5px;line-height:1.5;color:#4B5563;margin:0 0 22px;max-width:30ch}
.thl-btn{display:block;width:100%;border:0;border-radius:12px;padding:16px;cursor:pointer;
  font-family:inherit;font-size:16px;font-weight:640;color:#26120a;background:#F26A1B;
  box-shadow:0 1px 2px rgba(20,24,33,.18);transition:transform .12s}
.thl-btn:active{transform:translateY(1px)}
.thl-orient{margin-top:26px;padding-top:6px}
.thl-orow{display:flex;gap:10px;padding:12px 0;border-top:1px solid rgba(20,24,33,.08)}
.thl-orow b{flex:0 0 78px;font-size:13px;font-weight:650;color:#0E1320}
.thl-orow span{font-size:13.5px;line-height:1.45;color:#5C6472}
.thl-foot{margin-top:22px;font-size:11.5px;color:#8A93A1;text-align:left}
@media (prefers-reduced-motion:reduce){.thl-btn{transition:none}}
`;

export default function TrainingHomeLightPreview() {
  return (
    <div className="thl">
      <style>{CSS}</style>
      <div className="thl-in">

        <div className="thl-hero">
          <img src="/salma.jpg" alt="Salma" decoding="async" />
          <div className="thl-hero-grad" aria-hidden="true" />
          <div className="thl-top">
            <div className="thl-mark">
              <span className="thl-mono" aria-hidden="true"><i /><i /></span>
              <span className="thl-wm">German Interview Trainer</span>
            </div>
            <span className="thl-chip">{STEP.level}</span>
          </div>
          <div className="thl-name">
            <b>{STEP.greet}</b>
            <span>{STEP.role}</span>
          </div>
        </div>

        <div className="thl-sheet">
          <p className="thl-kick">{STEP.kicker}</p>
          <h1 className="thl-h1">{STEP.head}</h1>
          <p className="thl-lead">{STEP.lead}</p>
          {/* OWNER-AR slot */}
          <button type="button" className="thl-btn">{STEP.cta}</button>

          <div className="thl-orient">
            <div className="thl-orow"><b>Warum jetzt</b><span>{STEP.why}</span></div>
            <div className="thl-orow"><b>Danach</b><span>{STEP.after}</span></div>
          </div>

          <p className="thl-foot">Interne Simulation · keine Arbeitgeberentscheidung</p>
        </div>

      </div>
      <PreviewNav current="light" />
    </div>
  );
}
