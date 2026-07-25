/**
 * ui/primitives.js — the ONE definition of shared UI atoms (design-system law).
 *
 * Every screen previously re-declared its own `primaryBtn`/`ghostBtn`/card with drifting values
 * (red gradients, 7px radii, 10px type) — the app read as ~10 different products. These are the
 * canonical style objects; consume them (`style={{ ...actionBtn }}`) and DELETE the local consts.
 * Rules they encode (from .claude/skills/design-system):
 *  - Two colors only: blue (structure) + orange (THE one action per screen). No red chrome.
 *  - Inter via var(--font-display); type floor 12px here (system floor 11).
 *  - Touch targets ≥44px; radii from the --r-* scale; tokens only, no raw hex.
 */

// The screen's SINGLE orange action (one per screen — everything else blue/neutral).
export const actionBtn = {
  width: '100%', padding: '14px', minHeight: 50, cursor: 'pointer',
  fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: '0.02em',
  // White on orange. This was #081019 — near-black on orange, the dark-theme convention — and since
  // this is THE shared action atom, that one value set the label colour on every drill's primary button.
  borderRadius: 12, border: 'none', color: '#FFFFFF',
  background: 'var(--grad-action)', boxShadow: 'var(--shadow-action)',
};

// Quiet inline secondary (small; pair with a parent that guarantees the 44px target when standalone).
export const ghostBtn = {
  cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 12, padding: '8px 12px',
  minHeight: 36, borderRadius: 8, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text-dim)',
};

// Full-width quiet secondary (the standard non-primary action row).
export const ghostBtnWide = {
  flex: 1, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 12.5, padding: '12px',
  minHeight: 44, borderRadius: 'var(--r-md)', border: '1px solid var(--line-strong)',
  // 3% white was a lift on a dark ground; on the light ground it is invisible, so the button had
  // no surface at all — just a hairline. An explicit white surface reads as a real control.
  background: 'var(--surface)', color: 'var(--text-dim)',
};

// Screen title (drill headers): calm weight-600 sentence case — never caps-900/letterSpacing:2.
export const screenTitle = {
  margin: 0, fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600,
  letterSpacing: '0.02em', color: 'var(--text)',
};

// Fixed drill-overlay backdrop: the app's ONE calm navy atmosphere (kills per-drill moods
// like the old blood-red arena).
export const drillShellBg = {
  position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
  background: 'radial-gradient(120% 90% at 50% 12%, var(--bg-2) 0%, var(--bg-0) 65%)',
  color: 'var(--text)', padding: '20px 16px 32px', boxSizing: 'border-box',
};

// Standard card/panel surface.
export const cardSurface = {
  padding: '14px 16px', borderRadius: 'var(--r-lg)',
  background: 'var(--surface)', border: '1px solid var(--line)',
};
