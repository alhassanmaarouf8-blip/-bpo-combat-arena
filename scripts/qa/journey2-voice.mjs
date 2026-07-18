/**
 * journey2-voice.mjs — round 2 of the fresh-user journey: drive the VOICE core as a real learner.
 * Salma modal → Sprachdiagnose (5 recorded German answers via fake-mic WAV) → verdict →
 * Erstes Interview starten → live interview (WAV speaks) → stop → debrief → post beats.
 * Requires PROBE_TOKEN (verified account). Run from repo root.
 * Outputs j2-*.png + structured stdout.
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const WAV = process.env.PROBE_WAV || 'C:\\Users\\lenovo\\.claude\\jobs\\79d65682\\tmp\\qa-speech.wav';
const TOKEN = process.env.PROBE_TOKEN;
if (!TOKEN) { console.log('FATAL: set PROBE_TOKEN'); process.exit(1); }

const b = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required',
] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();
const errsByStep = {}; let curStep = 'init';
p.on('console', (m) => { if (m.type() === 'error') (errsByStep[curStep] ||= []).push(m.text().slice(0, 140)); });
p.on('pageerror', (e) => (errsByStep[curStep] ||= []).push('PAGEERR: ' + e.message.slice(0, 130)));
const failedReq = [];
p.on('response', (r) => { if (r.status() >= 400) failedReq.push(`[${curStep}] ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`); });
let mediaTickets = 0, ttsStreams = 0;
p.on('request', (r) => { if (r.url().includes('/api/media-ticket')) mediaTickets++; if (r.url().includes('/api/tts-stream')) ttsStreams++; });

await p.addInitScript(() => {
  window.__log = [];
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) { super(...a); window.__ws = this;
      this.addEventListener('message', (ev) => { try {
        const d = JSON.parse(ev.data);
        const keep = ['session_ready','boss_audio_delta','boss_speech_done','live_user_transcript_partial','live_boss_transcript','gemini_cost','gemini_ended','gemini_fallback','debrief','debrief_pending','no_session','error','verdict'];
        if (keep.includes(d.type)) { const e = { t: Date.now(), type: d.type };
          if (d.type === 'session_ready') e.useGeminiAudio = !!d.useGeminiAudio;
          if (d.type === 'live_user_transcript_partial') e.txt = (d.text || '').slice(0, 40);
          if (d.type === 'live_boss_transcript') e.txt = (d.text || '').slice(0, 40);
          if (d.type === 'error') e.msg = (d.message || d.error || '').slice(0, 80);
          if (d.type === 'gemini_cost') { e.monthUsd = d.monthUsd; e.capUsd = d.capUsd; }
          if (d.type === 'debrief') e.debrief = { studyNext: d.studyNext, grammar: (d.grammar||[]).map(g=>g.rule||g.explanation).slice(0,4), metrics: d.metrics };
          window.__log.push(e); }
      } catch {} });
    }
  };
});

const shot = async (name) => { curStep = name; await p.waitForTimeout(250); await p.screenshot({ path: `j2-${name}.png` }).catch(()=>{}); console.log(`shot j2-${name}.png`); };
const click = async (text, timeout = 5000) => {
  try { const el = p.getByText(text, { exact: false }).last(); await el.scrollIntoViewIfNeeded({ timeout }); await el.click({ timeout }); return true; } catch { return false; }
};
const bodyText = () => p.evaluate(() => document.body.innerText).catch(() => '');

// auth
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForTimeout(2500);
const account = await p.evaluate(async (tok) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/auth/me', { headers: { Authorization: `Bearer ${tok}` } });
  return (await r.json().catch(() => null))?.account || null;
}, TOKEN);
console.log('account:', account?.email, 'freeFight:', account?.entitlement?.freeFight);
await p.evaluate(({ tok, acc }) => { localStorage.setItem('bpo_token', tok); localStorage.setItem('bpo_account', JSON.stringify(acc)); }, { tok: TOKEN, acc: account });
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(6000);
await shot('00-landing-state');

// ── entry: Salma modal (first run) OR the mission CTA (after) ──
if (await click('Sprachdiagnose starten', 4000)) { console.log('entry: modal Sprachdiagnose'); await p.waitForTimeout(3000); }
else if (await click('EINSTUFUNG', 5000)) { console.log('entry: mission CTA EINSTUFUNG'); await p.waitForTimeout(3500); await shot('01-after-cta'); console.log('after-CTA body:', (await bodyText()).replace(/\n+/g,' | ').slice(0, 350)); }
else console.log('entry: NO entry button found');
// test Salma voice on tap: press the speaker button if present, count TTS requests
const spk = p.locator('button[aria-label*="hör" i], button[aria-label*="sprech" i], button[title*="hör" i]').first();
if (await spk.count().catch(() => 0)) { await spk.click().catch(() => {}); console.log('salma: tapped speaker button'); await p.waitForTimeout(4000); console.log('salma tts after tap: media-ticket', mediaTickets, 'tts-stream', ttsStreams); }
if (await click('Los geht')) { console.log('einstufung: Los geht'); await p.waitForTimeout(3000); }
await shot('02-q1');

// ── 5 questions: record → stop → weiter ──
for (let q = 1; q <= 5; q++) {
  curStep = `q${q}`;
  const started = await click('Aufnahme starten', 6000);
  console.log(`Q${q}: record start=${started}`);
  if (!started) { console.log(`Q${q}: body=`, (await bodyText()).replace(/\n+/g,' | ').slice(0, 300)); break; }
  await p.waitForTimeout(14000);                    // let the WAV speak German
  const stopped = await click('Aufnahme stoppen', 5000);
  console.log(`Q${q}: stop=${stopped}`);
  await p.waitForTimeout(6000);                     // transcription
  await shot(`03-q${q}-transcribed`);
  const advanced = (await click('Auswerten', 3000)) || (await click('Weiter', 4000));
  console.log(`Q${q}: advanced=${advanced}`);
  await p.waitForTimeout(q === 5 ? 20000 : 3500);   // Q5 = LLM analysis wait
}
await shot('04-verdict');
console.log('VERDICT text:', (await bodyText()).replace(/\n+/g, ' | ').slice(0, 1200));

// ── into the first interview ──
const intoInterview = (await click('Erstes Interview starten', 6000)) || (await click('Interview starten', 5000)) || (await click('Weiter', 4000));
console.log('to-interview click:', intoInterview);
await p.waitForTimeout(9000);
await shot('05-interview-open');

// wait for session_ready up to 30s
let ready = false;
for (let i = 0; i < 10; i++) {
  ready = await p.evaluate(() => (window.__log || []).some(e => e.type === 'session_ready'));
  if (ready) break;
  await p.waitForTimeout(3000);
}
console.log('session_ready:', ready);
if (ready) {
  console.log('INTERVIEW live — WAV speaking ~75s');
  await p.waitForTimeout(75000);
  await shot('06-interview-mid');
  await p.evaluate(() => { try { window.__ws?.send(JSON.stringify({ type: 'stop_fight' })); } catch {} });
  console.log('stop_fight sent');
  await p.waitForTimeout(16000);
  await shot('07-debrief');
  console.log('DEBRIEF text:', (await bodyText()).replace(/\n+/g, ' | ').slice(0, 1200));
  for (let i = 0; i < 5; i++) {
    const btns = await p.locator('button:visible').allInnerTexts().catch(() => []);
    const next = btns.map(t=>t.trim()).find(t => /weiter|laut gesagt|verstanden|auswertung|fertig|schließen|ok/i.test(t));
    if (!next) break;
    console.log(`post ${i}: clicking "${next}"`); await click(next); await p.waitForTimeout(3200); await shot(`08-post-${i}`);
  }
} else {
  console.log('NO session_ready — interview never opened. body=', (await bodyText()).replace(/\n+/g,' | ').slice(0, 500));
}

// final home state
await p.goto(URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(5000);
await shot('09-home-after');
console.log('HOME-AFTER:', (await bodyText()).replace(/\n+/g, ' | ').slice(0, 700));

// report
const log = await p.evaluate(() => window.__log || []);
await b.close();
console.log('\n════ WS REPORT ════');
console.log('PATH:', log.some(e => e.useGeminiAudio) ? 'GEMINI native audio' : 'no useGeminiAudio — $0/fallback or never started');
const cost = [...log].reverse().find(e => e.type === 'gemini_cost');
if (cost) console.log(`GEMINI spend: $${cost.monthUsd}/$${cost.capUsd}`);
console.log('boss_audio_delta:', log.filter(e => e.type === 'boss_audio_delta').length, '| user partials:', log.filter(e => e.type === 'live_user_transcript_partial').length, '| ws errors:', JSON.stringify(log.filter(e => e.type === 'error').map(e => e.msg)));
let lastUser = null; const gaps = [];
for (const e of log) { if (e.type === 'live_user_transcript_partial') lastUser = e.t; if (e.type === 'boss_audio_delta' && lastUser) { gaps.push(e.t - lastUser); lastUser = null; } }
console.log('turn gaps ms:', JSON.stringify(gaps), '| hangs>3s:', gaps.filter(g => g > 3000).length);
console.log('user heard as:', JSON.stringify(log.filter(e => e.type === 'live_user_transcript_partial').map(e => e.txt).slice(0, 8)));
const deb = log.find(e => e.type === 'debrief');
console.log(deb ? 'DEBRIEF: ' + JSON.stringify(deb.debrief) : 'no ws debrief event');
console.log('SALMA voice: media-ticket', mediaTickets, '| tts-stream', ttsStreams);
console.log('\nCONSOLE ERRORS:'); for (const [k, v] of Object.entries(errsByStep)) if (v.length) console.log(`  ${k}: ${[...new Set(v)].slice(0, 3).join(' || ')}`);
console.log('FAILED REQUESTS:'); for (const r of [...new Set(failedReq)].slice(0, 25)) console.log('  ' + r);
console.log('DONE.');
