/** Dump visible text + clickables of the local rig home (and optionally after clicking a label). */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const AUTH_FILE = 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\claude\\C--Users-lenovo\\2ee813aa-5e83-4c0f-a492-dff109d16505\\scratchpad\\baseline-auth.json';
const clickLabel = process.argv[2] || '';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 850 } })).newPage();
const auth = JSON.parse((await readFile(AUTH_FILE, 'utf8')).replace(/^﻿/u, ''));
await page.addInitScript((session) => {
  localStorage.setItem('bpo_token', session.token);
  localStorage.setItem('bpo_account', JSON.stringify(session.account));
  localStorage.setItem('bpo_howto_seen', '1');
  localStorage.setItem('omni_salma_seen', '1');
}, auth);
await page.goto('http://127.0.0.1:5173/?voiceLab=1', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(4500);
if (clickLabel) {
  await page.getByText(clickLabel, { exact: false }).first().click({ timeout: 6000 }).catch((e) => console.log('click failed:', e.message.slice(0, 80)));
  await page.waitForTimeout(2000);
}
console.log('=== BODY TEXT ===');
console.log((await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/gu, '\n').slice(0, 2600));
console.log('=== CLICKABLES ===');
console.log(await page.evaluate(() => [...document.querySelectorAll('button, a, [role="button"], [onclick]')]
  .map((el) => el.innerText.replace(/\s+/gu, ' ').trim().slice(0, 60)).filter(Boolean).join(' | ').slice(0, 1800)));
await browser.close();
