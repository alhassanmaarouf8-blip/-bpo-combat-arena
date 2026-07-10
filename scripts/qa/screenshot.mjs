/**
 * EYES — screenshot the live app so it can be SEEN (read the PNGs as images afterwards).
 * Usage: node scripts/qa/screenshot.mjs [url] [--signup]
 *   default url = https://bpo-combat-arena.vercel.app
 *   --signup → also creates a throwaway account and captures the logged-in home (home-mobile.png)
 * First run: (cd scripts/qa && npm i && npx playwright install chromium)   — free, one-time.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://bpo-combat-arena.vercel.app';
const SIGNUP = process.argv.includes('--signup');
const b = await chromium.launch();

async function shoot(name, w, h, fn) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await c.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(4000);
  if (fn) await fn(p);
  await p.screenshot({ path: `${name}.png`, fullPage: true });
  console.log(`${name}.png  · pageerrors: ${errs.length}${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
  await c.close();
}

await shoot('landing-mobile', 390, 844);
await shoot('landing-desktop', 1280, 800);
if (SIGNUP) {
  await shoot('home-mobile', 390, 844, async (p) => {
    // Form has visible labels (not placeholders) + REQUIRED WhatsApp since 2026-07-08/10 —
    // select by input type, and match the real button text ("Konto erstellen").
    await p.locator('input[type="email"]').fill(`qa${Date.now()}@example.com`);
    await p.locator('input[type="password"]').fill('qatest12345');
    await p.locator('input[type="tel"]').fill('01012345678');
    await p.locator('button', { hasText: 'Konto erstellen' }).click().catch(() => {});
    await p.waitForTimeout(7000);
    await p.keyboard.press('Escape').catch(() => {});
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(5000);
    await p.keyboard.press('Escape').catch(() => {});
  });
}
await b.close();
console.log('DONE — Read the .png files to SEE the app.');
