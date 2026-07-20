/**
 * pronunciation-baseline-prod.mjs — production cells of the Phase-3 baseline matrix.
 * Uses ONLY product-designed free paths on the existing verified probe account:
 * the free Einstufung (spoken assessment). No entitlement changes, no interviews.
 *
 * Audio enters through Chromium's fake capture device (--use-file-for-fake-audio-capture),
 * i.e. the app's unmodified getUserMedia path receives the exact WAV. The same WAV is
 * ALSO played audibly through the speakers (SoundPlayer) so every tested recording is heard.
 *
 * Usage: PROBE_EMAIL=… PROBE_PASS=… node scripts/qa/pronunciation-baseline-prod.mjs <wavAbsolutePath> <cellId>
 * (credentials via env — this repo is public, never hardcode the probe account)
 */
import { chromium } from 'playwright';
import { appendFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const URL_PROD = 'https://omni-perform.vercel.app/';
const API_PROD = 'https://bpo-combat-arena.onrender.com';
const RESULTS_DIR = 'C:\\Users\\lenovo\\Documents\\OMNI-PERFORM Audio Validation\\validation-program\\baseline-results';
const [wavPath, cellId = 'PROD-ASSESS'] = process.argv.slice(2);
if (!wavPath) throw new Error('usage: node pronunciation-baseline-prod.mjs <wav> <cellId>');

const apiLog = [];
const PROBE_EMAIL = process.env.PROBE_EMAIL;
const PROBE_PASS  = process.env.PROBE_PASS;
if (!PROBE_EMAIL || !PROBE_PASS) throw new Error('set PROBE_EMAIL + PROBE_PASS (verified probe account)');
const login = await fetch(`${API_PROD}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASS }) });
const auth = await login.json();
if (!login.ok || !auth?.token) throw new Error(`probe login failed ${login.status}`);

const browser = await chromium.launch({ headless: false, args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${path.resolve(wavPath)}`,
  '--autoplay-policy=no-user-gesture-required',
] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 850 }, permissions: ['microphone'] })).newPage();
page.on('response', async (response) => {
  const url = response.url();
  if (!url.includes('/api/')) return;
  let body = null; try { body = await response.json(); } catch { /* non-json */ }
  apiLog.push({ t: Date.now(), url: url.replace(/^https?:\/\/[^/]+/u, ''), status: response.status(), body });
});

async function clickFirst(labels, timeout = 6000) {
  for (const label of labels) {
    const target = page.getByText(label, { exact: false }).first();
    if (await target.click({ timeout }).then(() => true).catch(() => false)) return label;
  }
  return null;
}
const visible = async (max = 700) => (await page.evaluate(() => document.body.innerText)).replace(/\s+/gu, ' ').slice(0, max);

await page.addInitScript((session) => {
  localStorage.setItem('bpo_token', session.token);
  localStorage.setItem('bpo_account', JSON.stringify(session.account));
  localStorage.setItem('bpo_howto_seen', '1');
  localStorage.setItem('omni_salma_seen', '1');
}, auth);
await page.goto(URL_PROD, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForTimeout(5000);

// play the SAME wav audibly so the tested recording is heard on the machine
exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Add-Type -AssemblyName System; (New-Object System.Media.SoundPlayer '${path.resolve(wavPath).replaceAll("'", "''")}').PlaySync()`],
{ windowsHide: true, timeout: 180_000 }).catch(() => {});

const rows = [];
const opened = await clickFirst(['Einstufung machen', 'EINSTUFUNG', 'Einstufung']);
rows.push({ step: 'open', opened, ui: await visible(300) });
await page.waitForTimeout(2000);
await clickFirst(['Los geht’s', "Los geht's", 'Los geht']);
await page.waitForTimeout(2500);
for (let step = 1; step <= 6; step++) {
  const mark = apiLog.length;
  await clickFirst(['aufnehmen', 'Aufnahme', 'Antworten', 'sprechen', '●'], 5000);
  await page.waitForTimeout(24_000);
  await clickFirst(['Stopp', 'Fertig', 'senden'], 4000);
  await page.waitForTimeout(7000);
  await clickFirst(['Weiter', 'Nächste Frage', 'Abschicken', 'Auswerten'], 5000);
  await page.waitForTimeout(4000);
  const responses = apiLog.slice(mark).filter((row) => row.status);
  rows.push({ step, responses: responses.map((r) => ({ u: r.url, s: r.status, b: r.body })), ui: await visible(400) });
  const now = await visible(700);
  if (!/FRAGE\s*\d\s*\/\s*5/iu.test(now) && /Niveau|ERGEBNIS|Blocker|DIAGNOSE/iu.test(now)) break;
}
rows.push({ step: 'final', ui: await visible(1200) });
await browser.close();

await mkdir(RESULTS_DIR, { recursive: true });
const out = path.join(RESULTS_DIR, `production.${cellId}.json`);
await appendFile(out, `${JSON.stringify({ cellId, wav: path.resolve(wavPath), at: new Date().toISOString(), rows }, null, 2)}\n`, 'utf8');
console.log(`saved → ${out}`);
for (const row of rows) console.log(JSON.stringify(row).slice(0, 300));
