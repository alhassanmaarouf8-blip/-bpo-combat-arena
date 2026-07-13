/**
 * tour3.mjs — the COMPLETE UX tour (post first-run-gate era). Signs up, sets the reveal flags
 * (bpo_howto_seen + ff_interviewed) so the full home is visible, then opens EVERY surface, drives
 * the driveable steps (fake mic), screenshots each state, and logs console errors per step.
 * Run from repo root: node scripts/qa/tour3.mjs   → PNGs t3-*.png in CWD.
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();
const errsByStep = {};
let curStep = 'init';
p.on('console', (m) => { if (m.type() === 'error') (errsByStep[curStep] ||= []).push(m.text().slice(0, 120)); });
p.on('pageerror', (e) => (errsByStep[curStep] ||= []).push('PAGEERR: ' + e.message.slice(0, 110)));
const failedReq = [];
p.on('response', (r) => { if (r.status() >= 400) failedReq.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`); });

async function home() {
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(3000); await p.keyboard.press('Escape').catch(() => {});
}
async function shot(name, fullPage = false) {
  curStep = name;
  await p.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await p.waitForTimeout(250);
  await p.screenshot({ path: `t3-${name}.png`, fullPage });
  const e = errsByStep[name] || [];
  console.log(`t3-${name}.png ✓${e.length ? '  ⚠ ' + e.length + ' console-errors' : ''}`);
}
async function click(text, timeout = 5000) {
  try { const el = p.getByText(text, { exact: false }).first(); await el.scrollIntoViewIfNeeded({ timeout }); await el.click({ timeout }); return true; }
  catch { return false; }
}

// ── sign up, then set the reveal flags so the FULL home renders ──
await home();
await p.waitForSelector('input', { timeout: 90000 });
await p.getByPlaceholder(/mail/i).fill(`qa${Date.now()}@example.com`).catch(() => {});
await p.getByPlaceholder(/[Pp]asswort/).fill('qatest12345').catch(() => {});
await p.locator('button', { hasText: /KONTO ERSTELLEN/i }).click().catch(() => {});
await p.waitForTimeout(6000);
await shot('00-firstrun-home', true);
await p.evaluate(() => { try { localStorage.setItem('bpo_howto_seen', '1'); localStorage.setItem('ff_interviewed', '1'); } catch {} });
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(4000);
await shot('01-full-home', true);

// hero card interactions
await click('Optionen'); await p.waitForTimeout(600); await shot('02-hero-optionen');

// { tile label, name, steps=[button labels to click in sequence] }
const SURFACES = [
  { tile: 'Shadowing',         name: '10-shadowing',   steps: ['Anhören', 'Nachsprechen'] },
  { tile: 'Flow-Drill',        name: '11-flowdrill',   steps: ['Runde 1 aufnehmen'] },
  { tile: 'Hör-Check',         name: '12-hoercheck',   steps: [] },
  { tile: 'Sag es richtig',    name: '13-sagrichtig',  steps: [] },
  { tile: 'Satzbau-Schmiede',  name: '14-satzbau',     steps: [] },
  { tile: 'Druck-Leiter',      name: '15-druckleiter', steps: ['Leiter besteigen'] },
  { tile: 'Video-Lektionen',   name: '16-video',       steps: [] },
  { tile: 'dein Guide',        name: '17-guide',       steps: [] },
  { tile: 'TRAININGSLAGER',    name: '18-lager',       steps: [] },
  { tile: 'Einstufung',        name: '19-einstufung',  steps: ["Los geht"] },
  { tile: 'Fortschritt',       name: '20-fortschritt', steps: [] },
  { tile: 'Trainingsnachweis', name: '21-nachweis',    steps: [] },
  { tile: 'Diese Woche',       name: '22-diesewoche',  steps: [] },
  { tile: 'FEEDBACK GEBEN',    name: '23-feedback',    steps: [] },
];

for (const d of SURFACES) {
  await home();
  if (!(await click(d.tile))) { console.log(`${d.name}: could not open (tile "${d.tile}")`); continue; }
  await p.waitForTimeout(3500);
  await shot(`${d.name}-0open`);
  let i = 1;
  for (const step of d.steps) {
    if (await click(step)) { await p.waitForTimeout(3500); await shot(`${d.name}-${i}-${step.replace(/[^a-z]/gi, '').slice(0, 8)}`); i++; }
    else console.log(`  ${d.name}: step "${step}" not found`);
  }
}

console.log('\n=== console-error summary ===');
for (const [k, v] of Object.entries(errsByStep)) if (v.length) console.log(`  ${k}: ${[...new Set(v)].slice(0, 3).join(' | ')}`);
console.log('\n=== failed network requests (4xx/5xx) ===');
for (const r of [...new Set(failedReq)].slice(0, 20)) console.log('  ' + r);
await b.close();
console.log('DONE.');
