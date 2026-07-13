/**
 * verify-home-verdict.mjs — loads the HOME as a returning user (token from _probe-session.mjs) and proves
 * the honest hire-readiness verdict renders there (not just on the results screen) without crashing.
 * Run from repo root: node scripts/qa/verify-home-verdict.mjs <token>
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const TOKEN = process.argv[2];
if (!TOKEN) { console.error('usage: node verify-home-verdict.mjs <token>'); process.exit(1); }

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const pass = (m) => console.log('  ✅ ' + m);
const fail = (m) => { console.log('  ❌ ' + m); process.exitCode = 1; };

// loadStoredAuth() needs BOTH bpo_token AND bpo_account — fetch the account first.
const me = await fetch('https://bpo-combat-arena.onrender.com/api/auth/me', { headers: { Authorization: `Bearer ${TOKEN}` } });
const account = (await me.json()).account;
if (!account) { console.error('token did not authenticate'); process.exit(1); }

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForSelector('body', { timeout: 60000 });
// log in as the returning user + mark not-first-run + skip the how-to overlay
await p.evaluate(({ tok, acct }) => {
  try {
    localStorage.setItem('bpo_token', tok);
    localStorage.setItem('bpo_account', JSON.stringify(acct));
    localStorage.setItem('ff_interviewed', '1');
    localStorage.setItem('bpo_howto_seen', '1');
  } catch {}
}, { tok: TOKEN, acct: account });
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);   // token validates (/api/auth/me) + progress fetch (hireReadiness)

const body = await p.evaluate(() => document.body.innerText || '');
if (/App-Fehler|is not defined|ReferenceError|TypeError/.test(body)) {
  fail('APP CRASHED:\n    ' + body.split('\n').slice(0, 4).join('\n    '));
  await p.screenshot({ path: 'vf-home-verdict-CRASH.png', fullPage: true }); await b.close(); process.exit(1);
}
pass('no error boundary — home rendered cleanly');

const hasVerdict = await p.getByText('INTERVIEW-BEREITSCHAFT', { exact: false }).count();
const hasSignals = await p.getByText('Signale gemessen', { exact: false }).count();   // the honest X/9 caveat
const hasTrain   = await p.getByText('GEZIELT TRAINIEREN', { exact: false }).count();
hasVerdict > 0 ? pass('hire-readiness verdict card PRESENT on the home') : fail('verdict card MISSING on the home');
hasSignals > 0 ? pass('honest "X/9 Signale gemessen" caveat shown')     : fail('honesty caveat missing');
hasTrain   > 0 ? pass('one-tap "train this exact skill" button present') : fail('train button missing');

await p.screenshot({ path: 'vf-home-verdict.png', fullPage: true });
console.log('  📸 vf-home-verdict.png');
await b.close();
console.log('DONE.');
