// PROTECTED-FEATURE GUARD: the interview (owner order 2026-07-18, CLAUDE.md hard rules).
// Fails the verify chain (and Guardian) if any change would leave the Training home with no
// visible control whose label contains "INTERVIEW". This exact failure shipped twice:
// regression d4566dc and the EINSTUFUNG relabel (memory bpo-interview-findability-0718).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const fails = [];

// 1) The policy module: when BrainGuide is off, the legacy home MUST show the generic button.
const { primaryActionPolicy } = await import(new URL('../client/src/brainActionPolicy.js', import.meta.url));
if (primaryActionPolicy({}).showGenericInterview !== true) {
  fails.push('brainActionPolicy: legacy default no longer shows the generic Interview button');
}

const app = read('client/src/App.jsx');
const guide = read('client/src/BrainGuide.jsx');

// 2) The two interview entry points must exist verbatim in the home.
if (!app.includes("'Interview starten'")) {
  fails.push("App.jsx: the generic 'Interview starten' button label is gone");
}
if (!app.includes("'Interview direkt starten'")) {
  fails.push("App.jsx: the quiet 'Interview direkt starten' fallback link is gone");
}

// 3) The fallback link's exclusion list may only contain brain actions whose own BrainGuide CTA
//    label contains INTERVIEW — anything else suppresses the link AND shows a non-interview label,
//    leaving the home with zero interview-labeled controls (the "there is no interview" bug).
const excl = app.match(/!\[([^\]]+)\]\.includes\(homePrimaryAction\.action\)/);
if (!excl) {
  fails.push('App.jsx: fallback-link exclusion list not found (pattern changed — update this guard)');
} else {
  const allowed = new Set(['interview', 'assessment']);
  for (const raw of excl[1].split(',')) {
    const action = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!allowed.has(action)) {
      fails.push(`App.jsx: exclusion list suppresses the interview link for action '${action}', whose CTA label does not say INTERVIEW`);
    }
  }
}

// 4) The BrainGuide CTA labels for those covered actions must actually say INTERVIEW.
if (!/action === 'assessment'[^\n]*INTERVIEW/.test(guide)) {
  fails.push("BrainGuide.jsx: the assessment CTA label no longer contains INTERVIEW");
}
if (!/'interview':\s*'[^']*INTERVIEW[^']*'/.test(guide)) {
  fails.push("BrainGuide.jsx: DRILL_LABEL for 'interview' no longer contains INTERVIEW");
}

if (fails.length) {
  console.error('✖ interview-guard: the interview would become unfindable on the home:');
  for (const f of fails) console.error('  - ' + f);
  console.error('The interview is a PROTECTED FEATURE (CLAUDE.md hard rules, owner order 2026-07-18).');
  process.exit(1);
}
console.log('✓ interview-guard: an INTERVIEW-labeled control is guaranteed on the Training home.');
