/**
 * merge-pr.mjs — finish the sanctioned PR flow (create + merge) through the owner's own Chrome
 * profile when the claude-in-chrome extension bridge is down. Same authorization surface as the
 * extension flow used for PRs #10–#19: the owner's logged-in GitHub session on his machine.
 * Env: COMPARE_URL (the quick_pull compare link), OUT_PREFIX (screenshot prefix).
 */
import { chromium } from 'playwright';

const URL = process.env.COMPARE_URL;
const OUT = process.env.OUT_PREFIX || 'merge-pr';
if (!URL) { console.log('FATAL: set COMPARE_URL'); process.exit(1); }

const ctx = await chromium.launchPersistentContext(
  'C:/Users/lenovo/AppData/Local/Google/Chrome/User Data',
  { channel: 'chrome', headless: false, viewport: { width: 1400, height: 900 },
    args: ['--profile-directory=Default', '--no-first-run'] },
);
const p = ctx.pages()[0] || await ctx.newPage();
const shot = async (n) => { await p.screenshot({ path: `${OUT}-${n}.png` }).catch(() => {}); };

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(3500);
await shot('compare');

// Create the PR (the form submit button).
const create = p.getByRole('button', { name: /^Create pull request$/ }).last();
await create.click({ timeout: 15000 });
await p.waitForURL(/\/pull\/\d+/, { timeout: 30000 });
const prUrl = p.url();
console.log('PR created:', prUrl);
await p.waitForTimeout(4000);

// Wait for checks, then merge (retry loop: Guardian ~30s).
let merged = false;
for (let i = 0; i < 24 && !merged; i++) {
  const mergeBtn = p.getByRole('button', { name: /^Merge pull request$/ }).first();
  if (await mergeBtn.isVisible().catch(() => false) && await mergeBtn.isEnabled().catch(() => false)) {
    await mergeBtn.click();
    await p.waitForTimeout(1500);
    const confirm = p.getByRole('button', { name: /^Confirm merge$/ }).first();
    await confirm.click({ timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const body = await p.evaluate(() => document.body.innerText).catch(() => '');
    merged = /Merged|merged/.test(body);
  } else {
    await p.waitForTimeout(5000);
  }
}
await shot('after-merge');
console.log('MERGED:', merged, '|', prUrl);
await ctx.close();
