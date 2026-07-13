/**
 * probe-interview.mjs — drive THE core screen live: start a real interview on the deployed app,
 * log every WS message type + audio-element activity, screenshot each phase, observe what a SILENT
 * student experiences (fake mic = tone, no speech), then exit. Read-only on the repo; one short
 * session of normal free-tier usage. Run from repo root: node scripts/qa/probe-interview.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://bpo-combat-arena.vercel.app';
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
p.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message.slice(0, 110)));

// instrument WS + audio BEFORE the app loads
await p.addInitScript(() => {
  window.__wsLog = [];
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          window.__wsLog.push({ t: Date.now(), type: d.type, size: String(ev.data).length });
        } catch { window.__wsLog.push({ t: Date.now(), type: '(binary)', size: ev.data?.size || 0 }); }
      });
    }
  };
  window.__audioLog = [];
  setInterval(() => {
    const els = [...document.querySelectorAll('audio')];
    if (els.length) window.__audioLog.push(els.map((a) => ({ t: Date.now(), paused: a.paused, ct: Math.round(a.currentTime * 10) / 10, src: (a.src || '').slice(0, 40) })));
  }, 1000);
});

async function shot(name) {
  await p.screenshot({ path: `probe-${name}.png`, fullPage: false });
  console.log(`probe-${name}.png ✓`);
}

// signup + reveal
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForSelector('input', { timeout: 90000 });
await p.waitForTimeout(3000);
await p.getByPlaceholder(/mail/i).fill(`qa${Date.now()}@example.com`);
await p.getByPlaceholder(/[Pp]asswort/).fill('qatest12345');
await p.locator('button', { hasText: /KONTO ERSTELLEN/i }).click();
await p.waitForTimeout(6000);
await p.evaluate(() => { try { localStorage.setItem('bpo_howto_seen', '1'); } catch {} });
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(4000);

// start the interview
const t0 = Date.now();
const started = await p.getByText('Interview starten', { exact: false }).first().click({ timeout: 8000 }).then(() => true).catch(() => false);
if (!started) { console.log('FAIL: could not click Interview starten'); await b.close(); process.exit(1); }
await p.waitForTimeout(4000); await shot('1-connecting');
await p.waitForTimeout(8000); await shot('2-active-12s');
await p.waitForTimeout(23000); await shot('3-silence-35s');
await p.waitForTimeout(30000); await shot('4-silence-65s');

// dump instrumentation
const wsLog = await p.evaluate(() => window.__wsLog || []);
const audioLog = await p.evaluate(() => (window.__audioLog || []).slice(-30));
console.log('\n=== WS messages (type × count, in order of first arrival) ===');
const seen = new Map();
for (const m of wsLog) seen.set(m.type, (seen.get(m.type) || 0) + 1);
for (const [ty, n] of seen) console.log(`  ${ty} ×${n}`);
console.log('\n=== WS timeline (first 40) ===');
for (const m of wsLog.slice(0, 40)) console.log(`  +${((m.t - t0) / 1000).toFixed(1)}s ${m.type} (${m.size}b)`);
console.log('\n=== audio elements (last samples) ===');
for (const snap of audioLog.slice(-8)) console.log('  ' + JSON.stringify(snap));

// exit the interview (global back or Beenden)
const exited = (await p.getByText(/Beenden|Verlassen|Abbrechen/i).first().click({ timeout: 4000 }).then(() => true).catch(() => false))
  || (await p.locator('[aria-label*="ck"], button:has-text("←")').first().click({ timeout: 4000 }).then(() => true).catch(() => false));
await p.waitForTimeout(4000); await shot('5-after-exit');
console.log(`exit clicked: ${exited}`);

// paywall/pricing if reachable
await p.keyboard.press('Escape').catch(() => {});
await p.waitForTimeout(1000);
const pricing = await p.getByText(/PREISE|Upgrade|Mehr Minuten|Pro holen/i).first().click({ timeout: 4000 }).then(() => true).catch(() => false);
if (pricing) { await p.waitForTimeout(2500); await shot('6-pricing'); }
else console.log('pricing surface not reachable from here (no matching text)');

console.log(`\nconsole errors: ${errs.length}${errs.length ? '\n  ' + [...new Set(errs)].slice(0, 6).join('\n  ') : ''}`);
await b.close();
console.log('DONE.');
