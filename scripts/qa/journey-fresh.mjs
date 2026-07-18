/**
 * journey-fresh.mjs — the COMPLETE first-user journey on the DEPLOYED app, as a real learner
 * would live it: first open (Salma cold-open / first-run), the mission home, the voice interview
 * (fake mic speaks real German from a WAV), debrief, every Übungen drill, Fortschritt.
 * Requires a PRE-VERIFIED session: PROBE_TOKEN env (email-verification gates fight start).
 * Run from repo root:  PROBE_TOKEN=... node scripts/qa/journey-fresh.mjs
 * Outputs: jf-*.png screenshots + a structured stdout report (beats, buttons seen, WS log,
 * per-step console errors, failed requests, Salma voice request counts).
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const WAV = process.env.PROBE_WAV || 'C:\\Users\\lenovo\\.claude\\jobs\\79d65682\\tmp\\qa-speech.wav';
const TOKEN = process.env.PROBE_TOKEN;
if (!TOKEN) { console.log('FATAL: set PROBE_TOKEN (a verified account token)'); process.exit(1); }

const b = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${WAV}`,
  '--autoplay-policy=no-user-gesture-required',
] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();

const errsByStep = {}; let curStep = 'init';
p.on('console', (m) => { if (m.type() === 'error') (errsByStep[curStep] ||= []).push(m.text().slice(0, 140)); });
p.on('pageerror', (e) => (errsByStep[curStep] ||= []).push('PAGEERR: ' + e.message.slice(0, 130)));
const failedReq = [];
p.on('response', (r) => { if (r.status() >= 400) failedReq.push(`[${curStep}] ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`); });
let mediaTickets = 0, ttsStreams = 0;
p.on('request', (r) => {
  if (r.url().includes('/api/media-ticket')) mediaTickets++;
  if (r.url().includes('/api/tts-stream')) ttsStreams++;
});

// WS instrumentation (before app code runs)
await p.addInitScript(() => {
  window.__log = [];
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) {
      super(...a);
      window.__ws = this;
      this.addEventListener('message', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          const keep = ['session_ready','boss_audio_delta','boss_speech_done','live_user_transcript_partial',
                        'live_boss_transcript','gemini_cost','gemini_ended','gemini_fallback','debrief','debrief_pending',
                        'no_session','error','fight_update','verdict'];
          if (keep.includes(d.type)) {
            const e = { t: Date.now(), type: d.type };
            if (d.type === 'session_ready') e.useGeminiAudio = !!d.useGeminiAudio;
            if (d.type === 'gemini_cost') { e.monthUsd = d.monthUsd; e.capUsd = d.capUsd; e.capped = d.capped; }
            if (d.type === 'live_user_transcript_partial') e.txt = (d.text || '').slice(0, 40);
            if (d.type === 'live_boss_transcript') e.txt = (d.text || '').slice(0, 40);
            if (d.type === 'error') e.msg = (d.message || d.error || '').slice(0, 80);
            if (d.type === 'debrief') e.debrief = { studyNext: d.studyNext, grammar: (d.grammar||[]).map(g=>g.rule||g.explanation).slice(0,4), strengths: d.strengths, metrics: d.metrics };
            window.__log.push(e);
          }
        } catch { /* binary */ }
      });
    }
  };
});

const shot = async (name) => { curStep = name; await p.waitForTimeout(250); await p.screenshot({ path: `jf-${name}.png` }).catch(()=>{}); console.log(`shot jf-${name}.png`); };
const visibleButtons = async () => {
  const els = await p.locator('button:visible, [role="button"]:visible, a:visible').all().catch(() => []);
  const out = [];
  for (const el of els.slice(0, 40)) {
    const t = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (t) out.push(t);
  }
  return [...new Set(out)];
};
const clickText = async (text, timeout = 4000) => {
  try { const el = p.getByText(text, { exact: false }).first(); await el.scrollIntoViewIfNeeded({ timeout }); await el.click({ timeout }); return true; }
  catch { return false; }
};

// ── auth: inject the verified session, true first-run (NO seen-flags) ──
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForTimeout(2500);
const account = await p.evaluate(async (tok) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/auth/me', { headers: { Authorization: `Bearer ${tok}` } });
  return (await r.json().catch(() => null))?.account || null;
}, TOKEN);
if (!account) { console.log('FATAL: token rejected'); await b.close(); process.exit(1); }
console.log('account:', account.email, 'verified:', account.emailVerified, 'freeFight:', account.entitlement?.freeFight);
await p.evaluate(({ tok, acc }) => {
  localStorage.setItem('bpo_token', tok);
  localStorage.setItem('bpo_account', JSON.stringify(acc));
}, { tok: TOKEN, acc: account });
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(5000);

// ── PHASE 1: first-run beats (Salma cold-open / howto), walk until the tab bar appears ──
const atHome = async () => {
  const txt = await p.evaluate(() => document.body.innerText).catch(() => '');
  return /Fortschritt/.test(txt) && /Übungen/.test(txt) && /Training/.test(txt);
};
for (let beat = 0; beat < 14; beat++) {
  if (await atHome()) { console.log(`BEAT ${beat}: home reached`); break; }
  await shot(`beat-${String(beat).padStart(2, '0')}`);
  const btns = await visibleButtons();
  console.log(`BEAT ${beat} buttons: ${JSON.stringify(btns).slice(0, 400)}`);
  // name input beat
  const input = p.locator('input:visible').first();
  if (await input.count().catch(() => 0)) {
    const val = await input.inputValue().catch(() => 'x');
    const type = await input.getAttribute('type').catch(() => '');
    if (!val && type !== 'email' && type !== 'password') { await input.fill('Omar').catch(() => {}); console.log(`BEAT ${beat}: filled name input`); }
  }
  const prio = btns.find(t => /weiter|los geht|starten|^ja\b|bereit|verstanden|okay|^ok\b|beginnen|start|antworten/i.test(t))
    || (btns.length === 1 ? btns[0] : null) || btns[btns.length - 1];
  if (!prio) { console.log(`BEAT ${beat}: no buttons — waiting`); await p.waitForTimeout(3000); continue; }
  console.log(`BEAT ${beat}: clicking "${prio}"`);
  if (!(await clickText(prio))) console.log(`BEAT ${beat}: click failed`);
  await p.waitForTimeout(3500);
}
await shot('10-home-first');
console.log('HOME text head:', (await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\n+/g, ' | ').slice(0, 900));

// ── PHASE 2: follow the mission CTA up to 4 hops; run the interview when offered ──
let interviewDone = false;
for (let hop = 0; hop < 4 && !interviewDone; hop++) {
  const btns = await visibleButtons();
  const cta = btns.find(t => /INTERVIEW.*START|STARTEN?$|BEWERBUNG|PROFIL|TRAINING.*STARTEN|·/.test(t) && t.length > 12) || null;
  console.log(`HOP ${hop} CTA candidates: ${JSON.stringify(btns.filter(t=>t.length>10)).slice(0,400)}`);
  if (!cta) { console.log(`HOP ${hop}: no big CTA found`); break; }
  console.log(`HOP ${hop}: clicking "${cta}"`);
  await clickText(cta);
  await p.waitForTimeout(4000);
  await shot(`20-hop-${hop}`);
  // did an interview session open?
  const sessionReady = await p.evaluate(() => (window.__log || []).some(e => e.type === 'session_ready'));
  if (sessionReady) {
    console.log('INTERVIEW: session_ready — letting the WAV speak ~70s');
    await p.waitForTimeout(70000);
    await shot('30-interview-mid');
    await p.evaluate(() => { try { window.__ws?.send(JSON.stringify({ type: 'stop_fight' })); } catch {} });
    console.log('INTERVIEW: stop_fight sent, waiting for debrief');
    await p.waitForTimeout(15000);
    await shot('31-debrief');
    interviewDone = true;
    break;
  }
  // a form appeared? fill it generically and submit
  const inputs = await p.locator('input:visible, textarea:visible').all().catch(() => []);
  if (inputs.length) {
    for (const inp of inputs.slice(0, 6)) {
      const val = await inp.inputValue().catch(() => 'x');
      if (!val) await inp.fill('Kundenservice').catch(() => {});
    }
    const submit = (await visibleButtons()).find(t => /speichern|bestätigen|weiter|fertig|übernehmen/i.test(t));
    if (submit) { console.log(`HOP ${hop}: submitting form via "${submit}"`); await clickText(submit); await p.waitForTimeout(3500); await shot(`21-hop-${hop}-submitted`); }
  }
  // back to the Training tab for the next hop
  await clickText('Training'); await p.waitForTimeout(2500);
}

// walk through any post-debrief follow-ups (ritual etc.) — click up to 4 continue-ish buttons
for (let i = 0; i < 4; i++) {
  const btns = await visibleButtons();
  const next = btns.find(t => /weiter|laut gesagt|verstanden|zur auswertung|fertig|schließen/i.test(t));
  if (!next) break;
  console.log(`POST ${i}: clicking "${next}"`);
  await clickText(next); await p.waitForTimeout(3000); await shot(`32-post-${i}`);
}

// ── PHASE 3: Übungen — open every tile ──
await clickText('Übungen'); await p.waitForTimeout(3000); await shot('40-uebungen');
const tileTexts = (await visibleButtons()).filter(t => t.length >= 3 && t.length <= 40 && !/Fortschritt|Übungen|Training/.test(t));
console.log('ÜBUNGEN tiles:', JSON.stringify(tileTexts));
let tiles = 0;
for (const tile of tileTexts.slice(0, 10)) {
  await clickText('Übungen'); await p.waitForTimeout(1500);
  if (!(await clickText(tile))) { console.log(`tile "${tile}": no click`); continue; }
  await p.waitForTimeout(3500);
  await shot(`41-tile-${String(++tiles).padStart(2, '0')}-${tile.replace(/[^a-zA-Z]/g, '').slice(0, 12)}`);
  console.log(`tile "${tile}" text head:`, (await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\n+/g, ' | ').slice(0, 300));
  await p.keyboard.press('Escape').catch(() => {});
  const closer = (await visibleButtons()).find(t => /schließen|zurück|✕|x$/i.test(t));
  if (closer) await clickText(closer);
  await p.waitForTimeout(1200);
}

// ── PHASE 4: Fortschritt ──
await clickText('Fortschritt'); await p.waitForTimeout(3000); await shot('50-fortschritt');
console.log('FORTSCHRITT text head:', (await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600));
if (await clickText('Dossier')) { await p.waitForTimeout(2500); await shot('51-dossier'); }

// ── REPORT ──
const log = await p.evaluate(() => window.__log || []);
await b.close();
console.log('\n════ WS / INTERVIEW REPORT ════');
console.log('PATH:', log.some(e => e.useGeminiAudio) ? 'GEMINI (native audio)' : ($0 => 'no useGeminiAudio seen — $0/fallback or never started')(0));
const cost = [...log].reverse().find(e => e.type === 'gemini_cost');
if (cost) console.log(`GEMINI spend: $${cost.monthUsd}/$${cost.capUsd} capped=${cost.capped}`);
console.log('boss_audio_delta:', log.filter(e => e.type === 'boss_audio_delta').length,
  '| user partials:', log.filter(e => e.type === 'live_user_transcript_partial').length,
  '| ws errors:', JSON.stringify(log.filter(e => e.type === 'error').map(e => e.msg)));
let lastUser = null; const gaps = [];
for (const e of log) {
  if (e.type === 'live_user_transcript_partial') lastUser = e.t;
  if (e.type === 'boss_audio_delta' && lastUser) { gaps.push(e.t - lastUser); lastUser = null; }
}
console.log('per-turn gaps ms:', JSON.stringify(gaps), '| hangs>3s:', gaps.filter(g => g > 3000).length);
console.log('user transcript samples:', JSON.stringify(log.filter(e => e.type === 'live_user_transcript_partial').map(e => e.txt).slice(0, 6)));
console.log('boss transcript samples:', JSON.stringify(log.filter(e => e.type === 'live_boss_transcript').map(e => e.txt).slice(0, 4)));
const deb = log.find(e => e.type === 'debrief');
console.log(deb ? '── DEBRIEF ──\n' + JSON.stringify(deb.debrief, null, 1) : 'NO DEBRIEF captured. types seen: ' + [...new Set(log.map(e => e.type))].join(','));
console.log('\n════ SALMA VOICE ════ media-ticket:', mediaTickets, '| tts-stream:', ttsStreams);
console.log('\n════ CONSOLE ERRORS BY STEP ════');
for (const [k, v] of Object.entries(errsByStep)) if (v.length) console.log(`  ${k}: ${[...new Set(v)].slice(0, 3).join(' || ')}`);
console.log('\n════ FAILED REQUESTS ════');
for (const r of [...new Set(failedReq)].slice(0, 25)) console.log('  ' + r);
console.log('DONE.');
