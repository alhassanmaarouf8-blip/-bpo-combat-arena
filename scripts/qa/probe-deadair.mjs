/**
 * probe-deadair.mjs — verify the CHEF DENKT NACH dead-air fix live on prod, with REAL speech.
 * Fake mic plays a spoken German sentence (8.8s) + 8s silence, looped by Chrome. We record a
 * per-100ms timeline of: user-transcript WS messages, boss-audio WS messages, and whether the
 * DOM currently shows "DENKT NACH". Success = DENKT NACH appears in the gap between the user's
 * transcript going quiet and the boss's first audio of the next turn.
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const WAV = 'C:\\Users\\lenovo\\.claude\\jobs\\79d65682\\tmp\\qa-speech.wav';
const b = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${WAV}`,
  '--autoplay-policy=no-user-gesture-required',
] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message.slice(0, 110)));

await p.addInitScript(() => {
  window.__log = [];
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (['live_user_transcript_partial', 'boss_audio_delta', 'boss_speech_done', 'live_boss_transcript', 'session_ready', 'gemini_ended', 'error'].includes(d.type)) {
            window.__log.push({ t: Date.now(), type: d.type, txt: (d.text || '').slice(0, 40) });
          }
        } catch { /* binary */ }
      });
    }
  };
  // DOM poll: is CHEF DENKT NACH visible right now?
  setInterval(() => {
    const vis = document.body && document.body.innerText.includes('DENKT NACH');
    const last = window.__log[window.__log.length - 1];
    if (!last || last.type !== 'dom' || last.vis !== vis) window.__log.push({ t: Date.now(), type: 'dom', vis });
  }, 100);
});

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForSelector('input', { timeout: 90000 });
await p.waitForTimeout(2500);
const build = await p.evaluate(() => document.querySelector('meta[name="build"]')?.content || '?');
console.log('client build =', build);
// API-side signup (probe tests the INTERVIEW, not the signup UI)
const email = `qa${Date.now()}@example.com`;
const signup = await p.evaluate(async (em) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em, password: 'qatest12345', whatsapp: '01012345678' }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}, email);
console.log('signup:', signup.ok, signup.status);
if (!signup.ok || !signup.body?.token) { console.log('FAIL signup', JSON.stringify(signup.body).slice(0, 200)); await b.close(); process.exit(1); }
await p.evaluate((auth) => {
  localStorage.setItem('bpo_token', auth.token);
  localStorage.setItem('bpo_account', JSON.stringify(auth.account));
  localStorage.setItem('bpo_howto_seen', '1');
}, signup.body);
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(5000);

const started = await p.getByText('Interview starten', { exact: false }).first().click({ timeout: 8000 }).then(() => true).catch(() => false);
if (!started) {
  await p.screenshot({ path: 'C:/Users/lenovo/.claude/jobs/79d65682/tmp/probe-fail.png' });
  const txt = await p.evaluate(() => document.body.innerText.slice(0, 700)).catch(() => '?');
  console.log('FAIL: could not click Interview starten. Page says: ' + txt);
  await b.close(); process.exit(1);
}
console.log('interview started; observing 75s of live conversation…');

// watch for the DENKT NACH state and screenshot the FIRST time it shows
let shotTaken = false;
for (let i = 0; i < 75; i++) {
  await p.waitForTimeout(1000);
  if (!shotTaken) {
    const vis = await p.evaluate(() => document.body.innerText.includes('DENKT NACH')).catch(() => false);
    if (vis) { await p.screenshot({ path: 'C:/Users/lenovo/.claude/jobs/79d65682/tmp/probe-denkt-nach.png' }); shotTaken = true; console.log(`DENKT NACH visible at t+${i}s — screenshot taken`); }
  }
}

const log = await p.evaluate(() => window.__log);
await p.screenshot({ path: 'C:/Users/lenovo/.claude/jobs/79d65682/tmp/probe-final.png' });
await b.close();

// ── timeline analysis ──
const t0 = log.length ? log[0].t : Date.now();
const rel = (t) => ((t - t0) / 1000).toFixed(1) + 's';
let gaps = [];
let lastUserTxt = null, thinkOnAt = null;
for (const e of log) {
  if (e.type === 'live_user_transcript_partial') lastUserTxt = e.t;
  if (e.type === 'dom' && e.vis && lastUserTxt) thinkOnAt = e.t;
  if (e.type === 'boss_audio_delta' && lastUserTxt) {
    gaps.push({ userQuiet: rel(lastUserTxt), thinkShown: thinkOnAt ? rel(thinkOnAt) : 'NEVER', bossAudio: rel(e.t), gapMs: e.t - lastUserTxt });
    lastUserTxt = null; thinkOnAt = null;
  }
}
console.log('\n── per-turn gaps (user transcript quiet → boss first audio) ──');
for (const g of gaps) console.log(JSON.stringify(g));
console.log('\nWS message counts:', JSON.stringify(log.reduce((a, e) => { a[e.type] = (a[e.type] || 0) + 1; return a; }, {})));
console.log('page errors:', errs.length ? errs : 'none');
console.log('user transcripts seen:', log.filter((e) => e.type === 'live_user_transcript_partial').map((e) => e.txt).slice(0, 6));
