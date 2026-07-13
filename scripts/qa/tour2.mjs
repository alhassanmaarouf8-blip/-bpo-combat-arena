/**
 * tour2.mjs — DEEP interactive UX tour. Signs up, opens every drill, DRIVES it (fake mic so record
 * buttons work), screenshots each state, and logs console errors per drill (does it even work?).
 * Run from repo root: node scripts/qa/tour2.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();
const errsByStep = {};
let curStep = 'init';
p.on('console', (m) => { if (m.type() === 'error') (errsByStep[curStep] ||= []).push(m.text().slice(0, 100)); });
p.on('pageerror', (e) => (errsByStep[curStep] ||= []).push('PAGEERR: ' + e.message.slice(0, 90)));

async function home() {
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(3000); await p.keyboard.press('Escape').catch(() => {});
}
async function shot(name) {
  curStep = name;
  await p.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await p.waitForTimeout(250);
  await p.screenshot({ path: `t2-${name}.png`, fullPage: false });
  const e = errsByStep[name] || [];
  console.log(`t2-${name}.png ✓${e.length ? '  ⚠ ' + e.length + ' console-errors' : ''}`);
}
async function click(text, timeout = 5000) {
  try { const el = p.getByText(text, { exact: false }).first(); await el.scrollIntoViewIfNeeded({ timeout }); await el.click({ timeout }); return true; }
  catch { return false; }
}

// sign up
await home();
await p.getByPlaceholder(/mail/i).fill(`qa${Date.now()}@example.com`).catch(() => {});
await p.getByPlaceholder(/[Pp]asswort/).fill('qatest12345').catch(() => {});
await p.locator('button', { hasText: /KONTO ERSTELLEN/i }).click().catch(() => {});
await p.waitForTimeout(6000); await p.keyboard.press('Escape').catch(() => {});

// { tile label, name, steps=[button labels to click in sequence] }
const DRILLS = [
  { tile: 'Shadowing',        name: 'shadowing',   steps: ['Anhören', 'Nachsprechen', 'Anhören'] },
  { tile: 'Flow-Drill',       name: 'flow',        steps: ['Runde 1 aufnehmen'] },
  { tile: 'Hör-Check',        name: 'hoercheck',   steps: [] },
  { tile: 'Sag es richtig',   name: 'sagrichtig',  steps: [] },
  { tile: 'Satzbau-Schmiede', name: 'satzbau',     steps: [] },
  { tile: 'Druck-Leiter',     name: 'druck',       steps: ['Leiter besteigen'] },
  { tile: 'Video-Lektionen',  name: 'video',       steps: [] },
  { tile: 'dein Guide',       name: 'guide',       steps: [] },
  { tile: 'EINSTUFUNG',       name: 'einstuf',     steps: ["Los geht"] },
  { tile: 'TRAININGSLAGER',   name: 'lager',       steps: [] },
];

for (const d of DRILLS) {
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

console.log('\n=== console-error summary (question the assumption "it works") ===');
for (const [k, v] of Object.entries(errsByStep)) if (v.length) console.log(`  ${k}: ${[...new Set(v)].slice(0, 3).join(' | ')}`);
await b.close();
console.log('DONE.');
