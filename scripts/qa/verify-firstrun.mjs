/**
 * verify-firstrun.mjs — proves the two 4cc5277 changes on the DEPLOYED build:
 *   1. A novel user's home is BARE (no drill grid / footer / mission).
 *   2. The interviewer picker LOCKS too-high personas at A2–B1, UNLOCKS them at C1.
 *   3. Revealing after first interview works (set ff_interviewed → full home returns).
 * Run from repo root: node scripts/qa/verify-firstrun.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();
const pass = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); process.exitCode = 1; };

// ── sign up a brand-new account (→ first-run) ──
// goto's waitUntil hangs on this box even though the page DOES load — swallow it (like tour2) and wait
// for the real DOM instead. The form appearing is the true "loaded" signal.
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForSelector('input', { timeout: 90000 });
await p.waitForTimeout(3500);
await p.getByPlaceholder(/mail/i).fill(`qa${Date.now()}@example.com`).catch(() => {});
await p.getByPlaceholder(/[Pp]asswort/).fill('qatest12345').catch(() => {});
await p.locator('button', { hasText: /KONTO ERSTELLEN/i }).click().catch(() => {});
await p.waitForTimeout(6000);
// dismiss the one-time how-to overlay WITHOUT setting ff_interviewed (keep first-run true)
await p.evaluate(() => { try { localStorage.setItem('bpo_howto_seen', '1'); } catch {} });
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

// CRASH GUARD — a rendered error boundary must NEVER be mistaken for "clean". (This is the check that
// was missing when 4cc5277 crashed and the absence-only assertions passed falsely.)
const bodyText = await p.evaluate(() => document.body.innerText || '');
if (/App-Fehler|is not defined|ReferenceError|TypeError/.test(bodyText)) {
  fail('APP CRASHED to the error boundary:\n    ' + bodyText.split('\n').slice(0, 4).join('\n    '));
  await p.screenshot({ path: 'vf-CRASH.png', fullPage: true });
  await b.close();
  process.exit(1);
}
pass('no error boundary — app rendered cleanly');

console.log('\n=== 1. NOVEL-USER HOME IS BARE ===');
const hasButton   = await p.getByText('Interview starten', { exact: false }).count();
const hasUebungen = await p.getByText('Übungen', { exact: true }).count();
const hasShadow   = await p.getByText('Shadowing', { exact: false }).count();
const hasFooter   = await p.getByText('Fortschritt & Wiederholung', { exact: false }).count();
const hasReassure = await p.getByText('dein Niveau wird automatisch erkannt', { exact: false }).count();
const hasBrain    = await p.getByText('Baustelle', { exact: false }).count();   // BrainGuide "größte Baustelle" card
hasButton   > 0 ? pass('"Interview starten" button present') : fail('primary button MISSING');
hasReassure > 0 ? pass('first-run reassurance line present') : fail('reassurance line MISSING');
hasUebungen === 0 ? pass('Übungen drill grid HIDDEN')      : fail('drill grid VISIBLE on first-run');
hasShadow   === 0 ? pass('drill tiles (Shadowing) HIDDEN')  : fail('Shadowing tile VISIBLE on first-run');
hasFooter   === 0 ? pass('footer list HIDDEN')             : fail('footer VISIBLE on first-run');
hasBrain    === 0 ? pass('BrainGuide EINSTUFUNG card HIDDEN'): fail('BrainGuide card VISIBLE (2nd competing CTA)');
await p.screenshot({ path: 'vf-1-firstrun-home.png', fullPage: true });
console.log('  📸 vf-1-firstrun-home.png');

console.log('\n=== 2. INTERVIEWER PICKER LEVEL-GATE ===');
const sel = p.locator('select').filter({ has: p.locator('option', { hasText: 'Auto' }) }).first();
async function readOpts() {
  return await sel.locator('option').evaluateAll((os) => os.map((o) => ({ t: o.textContent.trim(), disabled: o.disabled })));
}
// default level = A2–B1
let opts = await readOpts();
if (opts.length === 0) fail('interviewer <select> not found / empty (0 options read)');
console.log('  A2–B1:', opts.map((o) => (o.disabled ? '🔒' : '·') + o.t.replace(/·.*/, '').trim()).join('  '));
const mona = (o) => o.t.includes('Mona');
const yas  = (o) => o.t.includes('Yasmin');
opts.find(mona)?.disabled ? pass('Frau Mona Adel LOCKED at A2–B1') : fail('Mona pickable at A2–B1 (the bug)');
opts.find((o) => o.t.includes('Lukas'))?.disabled ? pass('Lukas LOCKED at A2–B1') : fail('Lukas pickable at A2–B1');
!opts.find(yas)?.disabled ? pass('Yasmin UNLOCKED at A2–B1') : fail('Yasmin wrongly locked at A2–B1');
// bump to C1
await p.getByText('C1', { exact: true }).first().click().catch(() => {});
await p.waitForTimeout(500);
opts = await readOpts();
console.log('  C1:   ', opts.map((o) => (o.disabled ? '🔒' : '·') + o.t.replace(/·.*/, '').trim()).join('  '));
!opts.find(mona)?.disabled ? pass('Frau Mona Adel UNLOCKED at C1') : fail('Mona still locked at C1');
// back to A2–B1 → locked again
await p.getByText('A2', { exact: false }).first().click().catch(() => {});
await p.waitForTimeout(500);
opts = await readOpts();
opts.find(mona)?.disabled ? pass('Mona LOCKED again after dropping to A2–B1') : fail('Mona not re-locked');

console.log('\n=== 3. REVEAL AFTER FIRST INTERVIEW ===');
await p.evaluate(() => { try { localStorage.setItem('ff_interviewed', '1'); } catch {} });
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
const revealUeb = await p.getByText('Übungen', { exact: true }).count();
revealUeb > 0 ? pass('drill grid REVEALS once ff_interviewed set') : fail('grid still hidden after reveal');
await p.screenshot({ path: 'vf-3-revealed-home.png', fullPage: true });
console.log('  📸 vf-3-revealed-home.png');

await b.close();
console.log('\nDONE.');
