/**
 * loop-interview.mjs — sweep harness: run N FULL live interviews as a real user (fake-mic WAV),
 * no early stop (the fight ends itself after its scored answers), then open the Fortschritt tab
 * and capture DEINE GRÖSSTEN BAUSTELLEN. Goal: 2 COUNTED sessions → weakLog → ranked panel.
 * Env: PROBE_TOKEN, PROBE_WAV, ROUNDS (default 2). Outputs li-*.png in cwd.
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const WAV = process.env.PROBE_WAV;
const TOKEN = process.env.PROBE_TOKEN;
const ROUNDS = Number(process.env.ROUNDS || 2);
if (!TOKEN || !WAV) { console.log('FATAL: set PROBE_TOKEN + PROBE_WAV'); process.exit(1); }

const b = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required',
] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();
await p.addInitScript(() => {
  window.__log = [];
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) { super(...a); window.__ws = this;
      this.addEventListener('message', (ev) => { try {
        const d = JSON.parse(ev.data);
        if (['session_ready', 'debrief', 'debrief_pending', 'no_session', 'error'].includes(d.type)) {
          window.__log.push({ t: Date.now(), type: d.type, msg: (d.message || d.error || '').slice(0, 80) });
        }
      } catch {} });
    }
  };
});

const shot = async (name) => { await p.waitForTimeout(250); await p.screenshot({ path: `li-${name}.png` }).catch(()=>{}); console.log(`shot li-${name}.png`); };
const click = async (text, timeout = 5000) => {
  try { const el = p.getByText(text, { exact: false }).last(); await el.scrollIntoViewIfNeeded({ timeout }); await el.click({ timeout }); return true; } catch { return false; }
};
const bodyText = () => p.evaluate(() => document.body.innerText).catch(() => '');

// auth via token
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForTimeout(2500);
const account = await p.evaluate(async (tok) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/auth/me', { headers: { Authorization: `Bearer ${tok}` } });
  return (await r.json().catch(() => null))?.account || null;
}, TOKEN);
console.log('account:', account?.email, 'plan:', account?.entitlement?.plan, 'dailySessions:', account?.entitlement?.dailySessions);
await p.evaluate(({ tok, acc }) => { localStorage.setItem('bpo_token', tok); localStorage.setItem('bpo_account', JSON.stringify(acc)); localStorage.setItem('omni_salma_seen', '1'); }, { tok: TOKEN, acc: account });

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n── ROUND ${round} ──`);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(6000);
  await p.evaluate(() => { window.__log = []; });
  await shot(`r${round}-home`);
  // entry: expand the interview simulations group, else any interview CTA
  let entered = false;
  if (await click('Deine Interview-Simulationen', 4000)) {
    await p.waitForTimeout(2000);
    await shot(`r${round}-sims-open`);
    entered = (await click('Interview starten', 4000)) || (await click('Simulation starten', 3000))
      || (await click('YASMIN', 3000)) || (await click('Starten', 3000));
  }
  if (!entered) entered = (await click('Interview direkt starten', 3000)) || (await click('Erstes Interview starten', 3000)) || (await click('Interview starten', 3000));
  console.log(`entry clicked=${entered}`);
  await p.waitForTimeout(9000);
  await shot(`r${round}-open`);
  let ready = false;
  for (let i = 0; i < 10; i++) {
    ready = await p.evaluate(() => (window.__log || []).some(e => e.type === 'session_ready'));
    if (ready) break;
    await p.waitForTimeout(3000);
  }
  console.log('session_ready:', ready);
  if (!ready) { console.log('body:', (await bodyText()).replace(/\n+/g, ' | ').slice(0, 400)); continue; }
  // speak until the fight ends itself (debrief text appears) or 6 min cap
  let ended = false;
  for (let i = 0; i < 36; i++) {
    await p.waitForTimeout(10000);
    const txt = await bodyText();
    if (/TRAININGSZIEL|AUSWERTUNG|Debrief|DAS SITZT SCHON|DEIN L1-MUSTER|GESAMTERGEBNIS/i.test(txt)) { ended = true; break; }
  }
  if (!ended) {
    console.log('6min cap — sending stop_fight');
    await p.evaluate(() => { try { window.__ws?.send(JSON.stringify({ type: 'stop_fight' })); } catch {} });
    await p.waitForTimeout(16000);
  }
  await shot(`r${round}-debrief`);
  console.log(`R${round} DEBRIEF:`, (await bodyText()).replace(/\n+/g, ' | ').slice(0, 500));
}

// Fortschritt tab + ranked panel
await p.goto(URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(7000);
const fortTab = await click('Fortschritt', 5000);
console.log('fortschritt tab click:', fortTab);
await p.waitForTimeout(4000);
await shot('fortschritt');
const fortText = (await bodyText()).replace(/\n+/g, ' | ');
console.log('FORTSCHRITT text:', fortText.slice(0, 1200));
console.log('HAS BAUSTELLEN PANEL:', /GRÖSSTEN BAUSTELLEN/i.test(fortText));

const brain = await p.evaluate(async (tok) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/brain', { headers: { Authorization: `Bearer ${tok}` } });
  return await r.json().catch(() => null);
}, TOKEN);
console.log('BRAIN state:', brain?.directive?.state, 'ranked:', JSON.stringify(brain?.directive?.ranked || []));
const prog = await p.evaluate(async (tok) => {
  const r = await fetch('https://bpo-combat-arena.onrender.com/api/progress', { headers: { Authorization: `Bearer ${tok}` } });
  return await r.json().catch(() => null);
}, TOKEN);
console.log('sessions counted:', prog?.sessionCount ?? prog?.sessions?.length ?? 'n/a', 'dueReviews:', prog?.dueReviews);
await b.close();
console.log('DONE.');
