/**
 * probe-gemini-gate.mjs — the no-human proof that the LIVE interview is actually running on
 * Gemini Live native audio, not silently falling back to the Groq+ElevenLabs text pipeline.
 *
 * Why this exists: /health only reports `USE_GEMINI_LIVE && !!GEMINI_API_KEY`. That says the
 * server WANTS to use Gemini — it does not say Gemini accepted the key. An AI-Studio-vs-Cloud
 * key mismatch closes the bidi socket with 1008 AFTER auth, and the server falls back silently.
 *
 * The decisive signal: the server emits a SECOND session_ready with `useGeminiAudio:true` from
 * the proxy's onReady handler, which fires only on Gemini's setupComplete. So:
 *   useGeminiAudio:true  => flag+key+allowed+uncapped AND the key was accepted at the socket.
 *   boss_audio_delta > 0 => the boss is really speaking native PCM.
 *   gemini_ended / boss_speech => it fell back.
 *
 * Read-only on the repo. One short throwaway session. Run from repo root:
 *   node scripts/qa/probe-gemini-gate.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.PROBE_URL || 'https://bpo-combat-arena.vercel.app';
const LISTEN_MS = Number(process.env.PROBE_LISTEN_MS || 35000);

const b = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message.slice(0, 110)));

// Instrument the WS before the app boots. Keep full payloads only for the small control frames;
// boss_audio_delta carries base64 PCM and would blow up memory if retained.
await p.addInitScript(() => {
  window.__log = [];
  window.__t0 = Date.now();
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        let d;
        try { d = JSON.parse(ev.data); } catch { return; }
        const rec = { t: Date.now() - window.__t0, type: d.type };
        if (d.type === 'session_ready') rec.useGeminiAudio = !!d.useGeminiAudio;
        if (d.type === 'boss_speech') rec.text = String(d.text || '').slice(0, 60);
        if (d.type === 'gemini_cost') rec.monthUsd = d.monthUsd;
        window.__log.push(rec);
      });
    }
  };
});

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await p.waitForSelector('input', { timeout: 90000 });
await p.waitForTimeout(3000);
await p.getByPlaceholder(/mail/i).fill(`qa${Date.now()}@example.com`);
await p.getByPlaceholder(/[Pp]asswort/).first().fill('qatest12345');
// Signup validates client-side and fires no request until every field is filled — the WhatsApp
// number is required, so omitting it makes "Konto erstellen" a silent no-op.
await p.getByPlaceholder(/WhatsApp/i).fill('01012345678');
await p.locator('button', { hasText: /Konto erstellen/i }).first().click();
await p.waitForTimeout(6000);
await p.evaluate(() => { try { localStorage.setItem('bpo_howto_seen', '1'); } catch {} });
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(4000);
await p.evaluate(() => { window.__t0 = Date.now(); });

const started = await p.getByText('Interview starten', { exact: false }).first()
  .click({ timeout: 8000 }).then(() => true).catch(() => false);
if (!started) { console.log('FAIL: could not click "Interview starten"'); await b.close(); process.exit(1); }

await p.waitForTimeout(LISTEN_MS);

const log = await p.evaluate(() => window.__log || []);
await b.close();

const counts = new Map();
for (const m of log) counts.set(m.type, (counts.get(m.type) || 0) + 1);

const readies      = log.filter((m) => m.type === 'session_ready');
const geminiReady  = readies.find((m) => m.useGeminiAudio);
const audioDeltas  = counts.get('boss_audio_delta') || 0;
const bossSpeech   = log.filter((m) => m.type === 'boss_speech');
const geminiEnded  = counts.get('gemini_ended') || 0;
const firstAudioMs = log.find((m) => m.type === 'boss_audio_delta')?.t;
const cost         = [...log].reverse().find((m) => m.type === 'gemini_cost');

console.log('\n=== WS message types ===');
for (const [ty, n] of counts) console.log(`  ${ty} ×${n}`);

console.log('\n=== VERDICT ===');
console.log(`  session_ready frames        : ${readies.length}`);
console.log(`  useGeminiAudio:true         : ${geminiReady ? `YES (+${(geminiReady.t / 1000).toFixed(2)}s)` : 'NO'}`);
console.log(`  boss_audio_delta chunks     : ${audioDeltas}${firstAudioMs != null ? `  (first +${(firstAudioMs / 1000).toFixed(2)}s)` : ''}`);
console.log(`  gemini_ended (fell back)    : ${geminiEnded}`);
console.log(`  boss_speech (text fallback) : ${bossSpeech.length}${bossSpeech.length ? `  e.g. "${bossSpeech[0].text}"` : ''}`);
if (cost) console.log(`  gemini spend this month    : $${cost.monthUsd}`);
if (errs.length) console.log(`  page errors                : ${[...new Set(errs)].slice(0, 3).join(' | ')}`);

const pass = !!geminiReady && audioDeltas > 0 && geminiEnded === 0;
console.log(`\n${pass ? 'PASS — Gemini Live IS engaging (native audio, no fallback).'
                      : 'FAIL — Gemini Live is NOT carrying this interview.'}`);
if (!pass) {
  if (!geminiReady) console.log('  → no useGeminiAudio: a gate is false, OR the key was rejected at the bidi socket (check Render log for "GeminiLive start failed" / 1008). Only AI-Studio keys can call BidiGenerateContent.');
  else if (!audioDeltas) console.log('  → setup completed but no audio: the opening text-kick may have failed.');
  else if (geminiEnded) console.log('  → started then died mid-fight: budget cap or socket close. Check [geminiLive] closed code=.');
}
process.exit(pass ? 0 : 1);
