/**
 * previewTheme.js — the ICONIC light design system, shared by every preview screen.
 * PREVIEW ONLY. One definition so the seven screens cannot drift apart (the whole point of a
 * system). Graduates into the real app once the language is approved.
 *
 * The rules it encodes, from the design critique + .claude/skills/design-system:
 *  - Warm off-white ground (#F5F3EF), not the AI-default pure white.
 *  - Near-black ink; blue ONLY for structure/state; ONE burnt-orange action per screen.
 *  - Machined CTA: solid flat fill, 11px radius, NO glow bloom, sentence case.
 *  - Extreme type contrast: one big tight display line vs small quiet body. Max ~3 sizes visible.
 *  - Hairlines instead of a shadowed card around everything.
 */

export const BASE_CSS = `
.pv{position:fixed;inset:0;overflow-y:auto;background:#F5F3EF;color:#0E1320;
  font-family:'Inter','system-ui',sans-serif;-webkit-font-smoothing:antialiased}
.pv *{box-sizing:border-box}
.pv-in{max-width:440px;margin:0 auto;padding:24px 22px 96px;min-height:100%}
.pv-kick{font-size:12px;font-weight:640;color:#8A909C;margin:0 0 10px}
.pv-kick.blue{color:#2563EB}
.pv-h{font-size:34px;line-height:1.04;letter-spacing:-.035em;font-weight:820;margin:0 0 14px;text-wrap:balance}
.pv-h.sm{font-size:27px}
.pv-lead{font-size:15px;line-height:1.55;color:#5A6270;margin:0 0 24px}
.pv-act{display:block;width:100%;border:0;border-radius:11px;padding:16px;cursor:pointer;font-family:inherit;
  font-size:16px;font-weight:640;color:#fff;background:#D9541A;box-shadow:0 1px 2px rgba(18,22,31,.2)}
.pv-act:active{transform:translateY(1px)}
.pv-quiet{display:block;width:100%;background:none;border:0;color:#8A909C;font-family:inherit;font-size:14px;
  font-weight:600;padding:14px;cursor:pointer}
.pv-note{font-size:11.5px;color:#8A909C;line-height:1.5;margin:14px 0 0}
.pv-rule{border:0;border-top:1px solid rgba(14,19,32,.10);margin:0}
.pv-was{font-size:14.5px;color:#8A909C;margin:0 0 3px}
.pv-was s{text-decoration-color:#D9541A}
.pv-ist{font-size:16px;font-weight:650;color:#0E1320;margin:0}
@media (prefers-reduced-motion:reduce){.pv *{animation:none!important;transition:none!important}}
`;

// The tap-through switcher, so the seven screens can be walked on a real phone.
export const NAV_CSS = `
.pv-nav{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;gap:4px;overflow-x:auto;
  padding:9px 12px calc(9px + env(safe-area-inset-bottom));background:rgba(245,243,239,.94);
  backdrop-filter:blur(12px);border-top:1px solid rgba(14,19,32,.10);scrollbar-width:none}
.pv-nav::-webkit-scrollbar{display:none}
.pv-nav a{flex:0 0 auto;text-decoration:none;font-size:12.5px;font-weight:620;color:#8A909C;
  padding:8px 13px;border-radius:999px;white-space:nowrap;min-height:36px;display:flex;align-items:center}
.pv-nav a.on{background:#0E1320;color:#fff}
.pv-nav.dark{background:rgba(10,14,26,.94);border-top-color:rgba(255,255,255,.10)}
.pv-nav.dark a{color:#8FA3BE}
.pv-nav.dark a.on{background:#fff;color:#0A0E1A}
`;

export const SCREENS = [
  ['landing',     'Landing'],
  ['light',       'Home'],
  ['diagnose',    'Diagnose'],
  ['interview',   'Interview'],
  ['debrief',     'Debrief'],
  ['fortschritt', 'Fortschritt'],
  ['uebungen',    'Übungen'],
];
