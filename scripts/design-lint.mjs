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
  ['neon cyan',  [/#00e5ff/i, /#22d3ee/i, /#00bcd4/i, /#38bdf8/i, /\b0\s*,\s*229\s*,\s*255\b/, /\b34\s*,\s*211\s*,\s*238\b/]],
  ['emerald green', [/#34d399/i, /#10b981/i, /#22c55e/i, /#6ee7b7/i, /#a7f3d0/i, /#d1fae5/i, /\b16\s*,\s*185\s*,\s*129\b/, /\b52\s*,\s*211\s*,\s*153\b/, /\b110\s*,\s*231\s*,\s*183\b/]],
  ['violet',     [/#a78bfa/i, /#7c3aed/i, /#c4b5fd/i, /#ede9fe/i, /\b167\s*,\s*139\s*,\s*250\b/]],
  ['gold/amber', [/#fbbf24/i, /#f59e0b/i, /#fcd34d/i, /#fde68a/i, /\b251\s*,\s*191\s*,\s*36\b/, /\b245\s*,\s*158\s*,\s*11\b/]],
  ['gaming font (Orbitron)', [/orbitron/i]],
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

let violations = 0;
for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [label, pats] of FORBIDDEN) {
      if (pats.some((re) => re.test(line))) {
        console.error(`${path.relative('.', file)}:${i + 1}  [${label}]  ${line.trim().slice(0, 100)}`);
        violations++;
        break;
      }
    }
  });
}

if (violations) {
  console.error(`\n✖ design-lint: ${violations} off-brand color/font occurrence(s). Use the brand tokens (blue --accent / orange --action), neutrals, navy bg, or semantic red — never the old rainbow.`);
  process.exit(1);
}
console.log('✓ design-lint: clean — the 2-color system holds (no neon cyan / green / violet / gold / Orbitron).');
