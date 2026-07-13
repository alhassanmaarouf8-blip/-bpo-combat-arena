/**
 * probe-cost.mjs — measure the REAL USD cost of ONE full live interview on prod (Gemini Live path).
 * Fresh trial account, fake mic playing real German speech (8.8s speech + 8s silence, looped by
 * Chrome), fight runs to its natural server end (7.5-min wall cap). We capture every gemini_cost
 * frame ({monthUsd}) the server pushes — last(monthUsd) − first(monthUsd) + firstFrame≈sessionStart
 * gives the interview's spend; sequential runs give exact deltas between runs.
 * Run from repo root: node scripts/qa/probe-cost.mjs [runLabel]
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const WAV = 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\claude\\C--Users-lenovo\\5cc095ca-40ad-4ce3-8828-e605c4669131\\scratchpad\\qa-interview-long.wav';
const MAX_OBSERVE_MS = 9.5 * 60_000; // fight self-ends at 7.5 min; margin for debrief
const label = process.argv[2] || 'run';

const b = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${WAV}`,
  '--autoplay-policy=no-user-gesture-required',
] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message.slice(0, 110)));

await p.addInitScript(() => {
  window.__log = [];
  window.__t0 = Date.now();
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        let d; try { d = JSON.parse(ev.data); } catch { return; }
        const rec = { t: Date.now() - window.__t0, type: d.type };
        if (d.type === 'session_ready') rec.useGeminiAudio = !!d.useGeminiAudio;
        if (d.type === 'gemini_cost') { rec.monthUsd = d.monthUsd; rec.capped = d.capped; }
        if (d.type === 'live_user_transcript_done') rec.txt = String(d.text || '').slice(0, 50);
        if (['boss_audio_delta'].includes(d.type)) { window.__audioN = (window.__audioN || 0) + 1; return; }
        window.__log.push(rec);
      });
    }
  };
});

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForSelector('input', { timeout: 90000 });
await p.waitForTimeout(2500);

const email = `qacost-${label}-${Date.now()}@example.com`;
const signup = await p.evaluate(async (em) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em, password: 'qatest12345', whatsapp: '01012345678' }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}, email);
if (!signup.ok || !signup.body?.token) { console.log('FAIL signup', signup.status); await b.close(); process.exit(1); }
await p.evaluate((auth) => {
  localStorage.setItem('bpo_token', auth.token);
  localStorage.setItem('bpo_account', JSON.stringify(auth.account));
  localStorage.setItem('bpo_howto_seen', '1');
}, signup.body);
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(5000);
await p.evaluate(() => { window.__t0 = Date.now(); });

const started = await p.locator('button', { hasText: /Interview starten/i }).first()
  .click({ timeout: 10000 }).then(() => true).catch(() => false);
if (!started) {
  const txt = await p.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '?');
  console.log('FAIL: no start button. Page: ' + txt); await b.close(); process.exit(1);
}
const startedAt = Date.now();
console.log(`[${label}] interview started ${new Date().toISOString()} — observing to natural end…`);

// Observe until the fight ends (debrief / gemini_ended / paywall) or the hard timeout.
let endReason = 'timeout';
while (Date.now() - startedAt < MAX_OBSERVE_MS) {
  await p.waitForTimeout(5000);
  const last = await p.evaluate(() => (window.__log || []).slice(-8).map((e) => e.type)).catch(() => []);
  if (last.includes('debrief')) { endReason = 'debrief'; break; }
  if (last.includes('gemini_ended')) { endReason = 'gemini_ended'; break; }
  if (last.includes('paywall')) { endReason = 'paywall'; break; }
}
// give the server a beat to push the final cost frame
await p.waitForTimeout(8000);

const log = await p.evaluate(() => window.__log || []);
const audioN = await p.evaluate(() => window.__audioN || 0);
await b.close();

const durS = ((Date.now() - startedAt) / 1000).toFixed(0);
const costs = log.filter((m) => m.type === 'gemini_cost');
const ready = log.find((m) => m.type === 'session_ready' && m.useGeminiAudio);
const turns = log.filter((m) => m.type === 'live_user_transcript_done').length;
const fellBack = log.some((m) => m.type === 'gemini_ended');
const counts = {};
for (const m of log) counts[m.type] = (counts[m.type] || 0) + 1;

console.log(`[${label}] RESULT end=${endReason} dur=${durS}s geminiAudio=${!!ready} bossAudioChunks=${audioN} userTurns=${turns} fellBack=${fellBack}`);
console.log(`[${label}] cost frames: n=${costs.length} first=${costs[0]?.monthUsd} last=${costs[costs.length - 1]?.monthUsd}`);
console.log(`[${label}] all monthUsd:`, costs.map((c) => c.monthUsd).join(', '));
console.log(`[${label}] msg counts:`, JSON.stringify(counts));
if (errs.length) console.log(`[${label}] page errors:`, [...new Set(errs)].slice(0, 3));
