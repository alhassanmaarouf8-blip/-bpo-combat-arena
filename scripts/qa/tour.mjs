/**
 * tour.mjs — full UX tour: sign up once, then open every drill/screen and screenshot it.
 * PNGs land in the CWD. Read them afterwards to SEE the whole app as a new user does.
 * Run from repo root: node scripts/qa/tour.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 80)));

async function home() {
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(3500);
  await p.keyboard.press('Escape').catch(() => {});
}

// 1) sign up
await home();
await p.getByPlaceholder(/mail/i).fill(`qa${Date.now()}@example.com`).catch(() => {});
await p.getByPlaceholder(/[Pp]asswort/).fill('qatest12345').catch(() => {});
await p.locator('button', { hasText: /KONTO ERSTELLEN/i }).click().catch(() => {});
await p.waitForTimeout(7000);
await p.keyboard.press('Escape').catch(() => {});

// A drill = reload to a clean home, click the tile by its label, wait, screenshot.
async function shootDrill(label, name) {
  try {
    await home();
    const el = p.getByText(label, { exact: false }).first();
    await el.scrollIntoViewIfNeeded({ timeout: 6000 });
    await el.click({ timeout: 6000 });
    await p.waitForTimeout(4000);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `tour-${name}.png`, fullPage: false });   // viewport = what the user actually sees
    console.log(`tour-${name}.png ✓  (label "${label}")`);
  } catch (e) {
    console.log(`tour-${name}: FAILED — ${e.message.slice(0, 70)}`);
  }
}

// full home first
await home();
await p.screenshot({ path: 'tour-00-home.png', fullPage: true });
console.log('tour-00-home.png ✓');

const DRILLS = [
  ['Shadowing',         '01-shadowing'],
  ['Flow-Drill',        '02-flowdrill'],
  ['Hör-Check',         '03-hoercheck'],
  ['Sag es richtig',    '04-sagesrichtig'],
  ['Satzbau-Schmiede',  '05-satzbau'],
  ['Druck-Leiter',      '06-druckleiter'],
  ['Video-Lektionen',   '07-videolektionen'],
  ['dein Guide',        '08-guide'],
  ['TRAININGSLAGER',    '09-trainingslager'],
  ['EINSTUFUNG',        '10-einstufung'],
  ['Fortschritt',       '11-fortschritt'],
  ['Trainingsnachweis', '12-nachweis'],
  ['Diese Woche',       '13-diesewoche'],
  ['FEEDBACK GEBEN',    '14-feedback'],
];
for (const [label, name] of DRILLS) await shootDrill(label, name);

console.log(`\npageerrors: ${errs.length}${errs.length ? ' — ' + [...new Set(errs)].slice(0, 4).join(' | ') : ''}`);
await b.close();
console.log('DONE.');
