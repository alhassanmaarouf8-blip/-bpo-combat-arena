/**
 * design-lint.mjs — enforces the 2-color design system so it stays 100% and never drifts back to a
 * rainbow. Deny-list approach (low false-positives): the OLD off-brand color families (neon cyan,
 * emerald green, violet, gold/amber) must NEVER appear in client/src again — colors must be the brand
 * tokens (blue --accent / orange --action), the neutral ramp, the deep-navy bg, or semantic red.
 *
 * Exit 0 = clean. Exit 1 = a forbidden color reappeared (prints file:line). Run: node scripts/design-lint.mjs
 * Deterministic, zero-cost. Wired into the Guardian so a regression can't be merged.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('client/src');

// Forbidden color signatures (hex + the matching rgb triplet) — the old rainbow that was folded out.
// Each entry: a human label + the patterns that must not appear.
const FORBIDDEN = [
  // 0,200,255 was missing from this list, and that is exactly the cyan that shipped inside a
  // linear-gradient on the live interview screen: hex-only bans do not catch an rgb() triple.
  ['neon cyan',  [/#00e5ff/i, /#22d3ee/i, /#00bcd4/i, /#38bdf8/i, /#67e8f9/i, /#7dd3fc/i, /\b0\s*,\s*229\s*,\s*255\b/, /\b0\s*,\s*200\s*,\s*255\b/, /\b34\s*,\s*211\s*,\s*238\b/, /\b56\s*,\s*189\s*,\s*248\b/, /\b103\s*,\s*232\s*,\s*249\b/, /\b125\s*,\s*211\s*,\s*252\b/]],
  ['emerald green', [/#34d399/i, /#10b981/i, /#22c55e/i, /#4ade80/i, /#6ee7b7/i, /#a7f3d0/i, /#d1fae5/i, /\b16\s*,\s*185\s*,\s*129\b/, /\b52\s*,\s*211\s*,\s*153\b/, /\b74\s*,\s*222\s*,\s*128\b/, /\b110\s*,\s*231\s*,\s*183\b/]],
  ['violet',     [/#a78bfa/i, /#7c3aed/i, /#c4b5fd/i, /#ede9fe/i, /\b167\s*,\s*139\s*,\s*250\b/]],
  ['gold/amber', [/#fbbf24/i, /#f59e0b/i, /#fcd34d/i, /#fde68a/i, /\b251\s*,\s*191\s*,\s*36\b/, /\b245\s*,\s*158\s*,\s*11\b/]],
  ['gaming font (Orbitron)', [/orbitron/i]],
];

// ── Phase-3 congruence lock (2026-07-18) ──────────────────────────────────────────────────────────
// The app drifted into ~7 per-file button systems + arcade styling; client/src/ui/primitives.js is
// now the ONE source. These rules make the drift impossible to reintroduce:
//  - No screen may re-declare its own primary/ghost button const (consume ui/primitives instead).
//  - No caps-900 gamer titles (fontWeight:900 + raw letterSpacing:2 was the arcade signature).
//  - No red CHROME (#ef4444 etc. as buttons/borders/titles). Semantic red for true error text is
//    allowed ONLY via the tokens var(--bad)/rgba(239,68,68,…) inside err/error/wrong contexts —
//    reviewers: if you legitimately need semantic red, use the --bad token, never raw #ef4444.
//  - No blood-red arena gradients; no chrome emoji (status dots, title glyphs).
const CONGRUENCE = [
  ['re-declared button const (use ui/primitives)', [/const\s+(primaryBtn|ghostBtn|ghostBtnWide|btnPrimary2|actionButton)\s*=/]],
  ['gamer title (weight 900)', [/fontWeight:\s*900/]],
  ['red chrome hex (use var(--bad) only for true error text)', [/#ef4444/i, /#dc2626/i, /#b91c1c/i]],
  ['blood-red arena gradient', [/#1a0a0a/i, /#0a0506/i, /#020101/i]],
  ['chrome emoji (never in UI chrome)', [/\u{1F534}|\u{1F5E3}|\u{1F3D7}|\u{1F3A7}|\u{1F3C6}|\u{1F3AF}|\u{1F525}|\u{1F389}/u]],
];
const CONGRUENCE_EXEMPT = new Set(['ui\\primitives.js', 'ui/primitives.js']);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

// The congruence class ships with 22 known pre-existing residues (fight verdicts — see memory
// bpo-phase3-congruence-state-0718: "lock LOCAL until residues = 0"). It always REPORTS, but it
// only FAILS the run under DESIGN_LINT_STRICT=1, so CI stays green until the cleanup lands —
// then flip the flag in guardian.yml and the lock becomes permanent. The original FORBIDDEN
// rainbow/font class fails unconditionally, exactly as before.
const STRICT_CONGRUENCE = process.env.DESIGN_LINT_STRICT === '1';
let violations = 0;
let congruenceViolations = 0;
for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const relToSrc = path.relative(ROOT, file);
  lines.forEach((line, i) => {
    for (const [label, pats] of FORBIDDEN) {
      if (pats.some((re) => re.test(line))) {
        console.error(`${path.relative('.', file)}:${i + 1}  [${label}]  ${line.trim().slice(0, 100)}`);
        violations++;
        break;
      }
    }
    if (!CONGRUENCE_EXEMPT.has(relToSrc)) {
      for (const [label, pats] of CONGRUENCE) {
        if (pats.some((re) => re.test(line))) {
          console.error(`${path.relative('.', file)}:${i + 1}  [congruence: ${label}]  ${line.trim().slice(0, 100)}`);
          congruenceViolations++;
          break;
        }
      }
    }
  });
}

if (violations) {
  console.error(`\n✖ design-lint: ${violations} off-brand color/font occurrence(s). Use the brand tokens (blue --accent / orange --action), neutrals, navy bg, or semantic red — never the old rainbow.`);
  process.exit(1);
}
if (congruenceViolations) {
  console.error(`\n${STRICT_CONGRUENCE ? '✖' : '⚠'} design-lint congruence: ${congruenceViolations} residue(s) vs ui/primitives (known backlog; fails only under DESIGN_LINT_STRICT=1).`);
  if (STRICT_CONGRUENCE) process.exit(1);
}
console.log('✓ design-lint: clean — the 2-color system holds (no neon cyan / green / violet / gold / Orbitron).');
