/**
 * probe-voice.mjs — ground-truth observability for the VOICE INTERACTION.
 * Drives a full prod interview with real German speech, then ends it to capture the debrief.
 * Prints: which path (Gemini vs $0), Gemini spend/cap, per-turn latency (transcript-quiet → boss
 * first audio), any HANG (>3s gap), and the debrief's actual advice — so we stop guessing.
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const WAV = process.env.PROBE_WAV || 'C:\\Users\\lenovo\\.claude\\jobs\\79d65682\\tmp\\qa-speech.wav';
const b = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${WAV}`,
  '--autoplay-policy=no-user-gesture-required',
] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message.slice(0, 140)));

await p.addInitScript(() => {
  window.__log = [];
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) {
      super(...a);
      window.__ws = this;   // capture for stop_fight injection
      this.addEventListener('message', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          const keep = ['session_ready','boss_audio_delta','boss_speech_done','live_user_transcript_partial',
                        'live_boss_transcript','gemini_cost','gemini_ended','debrief','debrief_pending',
                        'no_session','error'];
          if (keep.includes(d.type)) {
            const e = { t: Date.now(), type: d.type };
            if (d.type === 'session_ready') e.useGeminiAudio = !!d.useGeminiAudio;
            if (d.type === 'gemini_cost') { e.monthUsd = d.monthUsd; e.capUsd = d.capUsd; e.capped = d.capped; }
            if (d.type === 'live_user_transcript_partial') e.txt = (d.text || '').slice(0, 30);
            if (d.type === 'debrief') e.debrief = { studyNext: d.studyNext, grammar: (d.grammar||[]).map(g=>g.rule||g.explanation).slice(0,4), strengths: d.strengths, metrics: d.metrics };
            window.__log.push(e);
          }
        } catch { /* binary */ }
      });
    }
  };
});

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForSelector('input', { timeout: 90000 });
const build = await p.evaluate(() => document.querySelector('meta[name="build"]')?.content || '?');
console.log('client build =', build);
const email = `qa${Date.now()}@example.com`;
const signup = await p.evaluate(async (em) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em, password: 'qatest12345', whatsapp: '01012345678' }),
  });
  return { ok: r.ok, body: await r.json().catch(() => null) };
}, email);
if (!signup.ok || !signup.body?.token) { console.log('FAIL signup', JSON.stringify(signup.body).slice(0,200)); await b.close(); process.exit(1); }
await p.evaluate((auth) => {
  localStorage.setItem('bpo_token', auth.token);
  localStorage.setItem('bpo_account', JSON.stringify(auth.account));
  localStorage.setItem('bpo_howto_seen', '1');
}, signup.body);
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(4000);

const started = await p.getByText('Interview starten', { exact: false }).first().click({ timeout: 8000 }).then(() => true).catch(() => false);
if (!started) { console.log('FAIL: could not start'); await b.close(); process.exit(1); }
console.log('interview started; observing ~55s then ending for debrief…');
await p.waitForTimeout(55000);

// End the fight to trigger the debrief
await p.evaluate(() => { try { window.__ws?.send(JSON.stringify({ type: 'stop_fight' })); } catch {} });
await p.waitForTimeout(12000);   // wait for debrief

const log = await p.evaluate(() => window.__log);
await b.close();

// ── analysis ──
const sr = log.find(e => e.type === 'session_ready' && e.useGeminiAudio !== undefined);
console.log('\nPATH:', log.some(e => e.useGeminiAudio) ? 'GEMINI (native audio)' : 'unknown/$0 (no useGeminiAudio seen)');
const cost = [...log].reverse().find(e => e.type === 'gemini_cost');
if (cost) console.log(`GEMINI spend: $${cost.monthUsd}/$${cost.capUsd}  capped=${cost.capped}`);
console.log('boss_audio_delta count:', log.filter(e=>e.type==='boss_audio_delta').length);

const t0 = log.length ? log[0].t : Date.now();
const rel = (t) => ((t - t0)/1000).toFixed(1)+'s';
let lastUserTxt = null; const gaps = [];
for (const e of log) {
  if (e.type === 'live_user_transcript_partial') lastUserTxt = e.t;
  if (e.type === 'boss_audio_delta' && lastUserTxt) { gaps.push(e.t - lastUserTxt); lastUserTxt = null; }
}
console.log('\nper-turn gaps (ms):', JSON.stringify(gaps));
console.log('HANGS (>3000ms):', gaps.filter(g=>g>3000).length, ' max gap:', gaps.length?Math.max(...gaps):0);

const deb = log.find(e => e.type === 'debrief');
if (deb) { console.log('\n── DEBRIEF ──'); console.log(JSON.stringify(deb.debrief, null, 1)); }
else console.log('\nNO DEBRIEF captured (types seen:', [...new Set(log.map(e=>e.type))].join(','), ')');
console.log('\nuser transcripts:', log.filter(e=>e.type==='live_user_transcript_partial').map(e=>e.txt).slice(0,8));
console.log('page errors:', errs.length ? errs : 'none');
