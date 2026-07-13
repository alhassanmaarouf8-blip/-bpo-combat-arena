/**
 * masri-check.mjs — deterministic, $0 authenticity scan for the app's user-facing Arabic.
 *
 * WHY: langGuard.js catches WRONG-SCRIPT glitches (CJK/Cyrillic inside Arabic) but explicitly
 * cannot see SAME-SCRIPT problems — formal MSA instead of Cairo masri, or fake/machine-translated
 * Arabic that is still Arabic script. That is exactly the trust-killer the owner worries about
 * (cf. the deleted El-Captain chat: "provably broken Egyptian Arabic — mixed foreign tokens,
 * garbled grammar terms"). This scanner flags SUSPECT static Arabic strings for the owner — the
 * only qualified judge of masri — to review. It never rewrites; it only surfaces.
 *
 * It flags two classes:
 *   [LATIN-MIX]  Arabic string with embedded Latin words (not a {placeholder}/number/technical
 *                German term in context) — a strong signal of machine mixing.
 *   [MSA?]       Arabic string containing formal MSA markers a Cairo native rarely writes in
 *                casual app copy (ماذا/لماذا/الآن/الذي/عندما/سوف/ليس/…). HEURISTIC — the owner
 *                decides; some may be legitimate. Tuned conservative to limit false positives.
 *
 * Usage: node scripts/masri-check.mjs            (scan client/src)
 *        node scripts/masri-check.mjs <file...>  (scan specific files)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ARABIC = /[؀-ۿݐ-ݿ]/;
const ARABIC_RUN = /[؀-ۿݐ-ݿ][؀-ۿݐ-ݿ\s،؛؟«».,!?…ـ]*/;
// Latin word of 2+ letters (1-letter like a variable is noisy) sitting next to Arabic.
const LATIN_WORD = /[A-Za-z]{2,}/;

// Formal MSA markers uncommon in authentic Cairo masri UI copy. Cairo equivalent in comment.
const MSA_MARKERS = [
  ['ماذا', 'إيه'], ['لماذا', 'ليه'], ['الآن', 'دلوقتي'], ['الذي', 'اللي'], ['التي', 'اللي'],
  ['عندما', 'لما'], ['سوف', 'هـ+فعل'], ['ليس', 'مش'], ['أيضاً', 'كمان'], ['أيضًا', 'كمان'],
  ['كذلك', 'كمان'], ['يجب أن', 'لازم'], ['هذا الأمر', 'ده'], ['نستطيع', 'نقدر'],
  ['يمكنك أن', 'تقدر'], ['ماذا تريد', 'عايز إيه'], ['كيف حالك', 'إزيك'], ['من فضلك أن', 'لو سمحت'],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// Extract quoted string LITERALS ('...', "...", `...`) from one line. Returns the inner text of
// each. We only inspect the Arabic string itself — NOT the surrounding JSX/German on the same line
// (that was the false-positive bug: `T(lang, 'Was dich...', 'أكتر حاجة...')` has German + Arabic on
// one line, and code tokens like div/style/dir are not part of the Arabic content).
function stringLiterals(line) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

function scanFile(path) {
  const findings = [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!ARABIC.test(line)) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;            // skip comment lines
    for (const raw of stringLiterals(line)) {
      if (!ARABIC.test(raw)) continue;                      // only Arabic-bearing literals
      // Strip {placeholders}, ${template exprs} and HTML/JSX tags that legitimately sit in copy.
      const lit = raw.replace(/\$\{[^}]*\}/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/<[^>]+>/g, ' ');
      const flags = [];
      // LATIN-MIX: a Latin word of 2+ letters left INSIDE the Arabic literal → likely machine mix
      // (real masri copy may still name a brand like "Vodafone" — owner judges; we surface it).
      const latin = lit.match(LATIN_WORD);
      if (latin && ARABIC.test(lit)) {
        const words = [...new Set(lit.match(/[A-Za-z]{2,}/g))].slice(0, 5).join(', ');
        flags.push(`LATIN-IN-STRING(${words})`);
      }
      for (const [msa, cairo] of MSA_MARKERS) {
        if (lit.includes(msa)) flags.push(`MSA?(${msa}→${cairo})`);
      }
      if (flags.length) {
        findings.push({ line: i + 1, flags: [...new Set(flags)], snippet: raw.trim().slice(0, 90) });
      }
    }
  });
  return findings;
}

const args = process.argv.slice(2);
const files = args.length ? args : walk('client/src');
let total = 0;
const byFile = [];
for (const f of files) {
  const findings = scanFile(f);
  if (findings.length) { byFile.push([f, findings]); total += findings.length; }
}

if (!total) {
  console.log('masri-check: no suspect Arabic strings found (LATIN-MIX / MSA markers).');
  process.exit(0);
}
console.log(`masri-check: ${total} SUSPECT Arabic string(s) to review — owner decides (never auto-rewrite).\n`);
for (const [f, findings] of byFile) {
  console.log(`## ${f}`);
  for (const x of findings) console.log(`  L${x.line}  [${x.flags.join(' ')}]  ${x.snippet}`);
  console.log('');
}
