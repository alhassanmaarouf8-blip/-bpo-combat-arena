/**
 * german-check.mjs — quality gate on the German the APP teaches. Extracts German string literals from
 * boss content and checks them with the FREE LanguageTool API. Catches real grammar/spelling errors so
 * the product never teaches wrong German. Zero cost. Usage: node scripts/german-check.mjs [file ...]
 */
import fs from 'node:fs';

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['server/scenarios.js'];
const MARKERS = /\b(der|die|das|und|nicht|ist|sind|ein|eine|Sie|Ihre|Ihren|Ihnen|ich|mir|mich|wir|haben|werden|möchten|bitte|wie|was|warum|für|mit|auf|von|kurz|Kunde|Kunden|erzählen|stellen|Deutsch|Niveau|Gespräch|Frage|Antwort|sich|dass|weil|aber)\b/gi;
const isGerman = (s) => /[äöüßÄÖÜ]/.test(s) || new Set((s.match(MARKERS) || []).map((w) => w.toLowerCase())).size >= 2;

// Only discrete quoted lines (the boss's SPOKEN content). Backtick template literals are the big
// English LLM-instruction prompt (with embedded German examples) — not worth auto-checking, and
// truncating them produced false "unpaired quote" noise.
const STR = /'([^'\\\n]{15,260})'|"([^"\\\n]{15,260})"/g;
const seen = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = STR.exec(src)) !== null) {
    const s = (m[1] || m[2] || m[3] || '').replace(/\$\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    const codey = /https?:|var\(|rgba?\(|=>|function|import |export |STAGE_META|const |;\s|\[\s*\{|\$\{/.test(s);
    if (s.length >= 15 && isGerman(s) && !codey) seen.add(s);
  }
}

const list = [...seen];
console.log(`Checking ${list.length} German strings from ${files.join(', ')} via LanguageTool (free)…\n`);
let totalErrors = 0;
for (const s of list) {
  const body = new URLSearchParams({ text: s, language: 'de-DE' });
  let d;
  try { d = await (await fetch('https://api.languagetool.org/v2/check', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })).json(); }
  catch (e) { console.error('LT error:', e.message); continue; }
  const real = (d.matches || []).filter((x) =>
    !/TYPOGRAPHY|WHITESPACE|CASING|REDUNDANCY|STYLE/.test((x.rule?.category?.id || '') + (x.rule?.id || '')) &&
    // "unpaired quote/bracket" is an EXTRACTION artifact (we slice German „…" at the JS-string boundary), not a real error.
    !/Gegenstück|unpaired|schließende|öffnende/i.test(x.message || '') &&
    // style/register notes (the angry-customer lines are colloquial + emphatic ON PURPOSE) ≠ grammar errors.
    !/umgangssprachlich|emphatisch|gehoben|Wendung|Füllwort/i.test(x.message || ''));
  for (const x of real) {
    totalErrors++;
    const sug = (x.replacements || []).slice(0, 3).map((r) => r.value).join(' / ');
    console.log(`x "${s.slice(0, 90)}${s.length > 90 ? '…' : ''}"\n   -> ${x.message}${sug ? `  [${sug}]` : ''}\n`);
  }
  await new Promise((r) => setTimeout(r, 350));
}
console.log(totalErrors ? `\n${totalErrors} potential German issue(s) - review above.` : '\nOK - no grammar/spelling issues found in the boss German.');
