/**
 * push.js — Web Push daily reminders ($0, no dependency, boot-safe).
 *
 * Owner (2026-07-08): nudge trial + paid users to actually practice every day — without spending
 * money. Web Push (the app is already an installable PWA) is the free channel: no SMS, no phone
 * needed. Chosen over paid SMS (zero-spend rule) and over the `web-push` npm package (a bad install
 * could break the live backend's boot). Everything here is built on Node's built-in crypto + fetch,
 * and stays DISABLED until the VAPID env vars are set — so shipping this can never break the app.
 *
 * Payload-LESS VAPID push: we send an authenticated, bodyless push; the service worker shows a fixed
 * German reminder. That skips the (fiddly, bug-prone) aes128gcm payload-encryption entirely while
 * still delivering the notification — exactly what a "go practice" nudge needs.
 *
 *   GET  /api/push/key         → { enabled, key }  (VAPID public key for the client)
 *   POST /api/push/subscribe   (auth) → store the PushSubscription on the profile
 *   POST /api/push/unsubscribe (auth) → clear it
 *   POST /api/push/test        (auth) → send THIS user a test push (verify the whole chain)
 *   POST /admin/push/daily     (ADMIN_KEY) → send the daily reminder to everyone with a sub who
 *                                            hasn't trained today; prunes expired subs. (cron target)
 */
import express from 'express';
import crypto from 'crypto';
import { adminRequestOk } from './adminAuth.js';
import { dayKey } from './time.js';
import { loadUser, saveUser } from './store.js';
import { requireAuth, listAllAccounts, trialActive, trialDaysLeft, claimTrialNotice } from './auth.js';
import { dbEnabled, kvGet, kvSet } from './db.js';
import { mailerConfigured, sendTrialEndingMail } from './mailer.js';
import { loadBottlenecks, latestActiveRecord } from './bottleneckStore.js';
import { CATEGORIES } from './scoring/errorTaxonomy.js';

export const pushRouter = express.Router();

const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:info@omni-perform.app';
const b64u    = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s)  => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Self-provisioning VAPID keys — NO manual env step, NO secret in anyone's transcript. Priority:
//   1) explicit VAPID_* env (if the owner ever wants to pin them)
//   2) a keypair persisted in the DB (stable across restarts — prod has DATABASE_URL)
//   3) generate once + persist. Only step 3's "no DB" branch is ephemeral (dev only).
let _keys = null, _keysPromise = null;
async function ensureKeys() {
  if (_keys) return _keys;
  if (_keysPromise) return _keysPromise;
  _keysPromise = (async () => {
    const mk = (pub, privPkcs8) => ({ pub, priv: crypto.createPrivateKey({ key: Buffer.from(privPkcs8, 'base64'), format: 'der', type: 'pkcs8' }) });
    // 1) env override
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      try { _keys = mk(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY); return _keys; }
      catch (e) { console.error('[push] env VAPID invalid, ignoring:', e.message); }
    }
    // 2) persisted keypair
    if (dbEnabled()) {
      try { const s = await kvGet('config', 'vapid'); if (s?.pub && s?.privPkcs8) { _keys = mk(s.pub, s.privPkcs8); return _keys; } }
      catch (e) { console.error('[push] load persisted VAPID failed:', e.message); }
    }
    // 3) generate + persist
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = publicKey.export({ format: 'jwk' });
      const pub = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
      const privPkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
      if (dbEnabled()) { try { await kvSet('config', 'vapid', { pub, privPkcs8 }); } catch (e) { console.error('[push] persist VAPID failed:', e.message); } }
      _keys = mk(pub, privPkcs8);
      return _keys;
    } catch (e) { console.error('[push] VAPID generation failed — push disabled:', e.message); _keys = null; return null; }
  })();
  return _keysPromise;
}

// Server-wide "is push usable?" — resolves the keys (provisioning them if needed).
export async function pushReady() { return !!(await ensureKeys()); }

// A VAPID Authorization header for one push endpoint (aud = its origin). ES256 JWT, 12h expiry.
function vapidAuth(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const header  = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const input = `${header}.${payload}`;
  const sig = crypto.sign('SHA256', Buffer.from(input), { key: keys.priv, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${input}.${b64u(sig)}, k=${keys.pub}`;
}

const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'web.push.apple.com',
];
function validPushEndpoint(raw) {
  try {
    const u = new URL(String(raw || ''));
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password
      && PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch { return false; }
}

// Send one bodyless push. Returns { ok, status, expired }. Never throws.
async function sendPush(sub) {
  const keys = await ensureKeys();
  if (!keys || !validPushEndpoint(sub?.endpoint)) return { ok: false, status: 0, expired: true };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: vapidAuth(sub.endpoint, keys), TTL: '86400', 'Content-Length': '0' },
      redirect: 'error', signal: ctrl.signal,
    });
    clearTimeout(timer);
    // 404/410 → the subscription is dead (app uninstalled / permission revoked) → prune it.
    return { ok: r.status >= 200 && r.status < 300, status: r.status, expired: r.status === 404 || r.status === 410 };
  } catch (e) {
    console.error('[push] send failed:', e.message);
    return { ok: false, status: 0, expired: false };
  }
}

// Cairo day-key of the user's most recent activity (interviews / daily drills / lessons / minutes).
function lastActiveDay(p) {
  let last = '';
  for (const s of (p.sessions || [])) if (s?.date) { const k = dayKey(s.date); if (k > last) last = k; }
  for (const d of [...(p.dailyDays || []), ...(p.lessonDays || []), ...Object.keys(p.usageDays || {})]) {
    const k = String(d); if (k > last) last = k;
  }
  return last;
}

// ── Public: VAPID key for the client (provisions the keypair on first hit) ──
pushRouter.get('/api/push/key', async (_req, res) => {
  const keys = await ensureKeys();
  res.json({ enabled: !!keys, key: keys?.pub || null });
});

// ── Save / clear a subscription on the user's profile ──
pushRouter.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const sub = req.body?.subscription || req.body;
    if (!validPushEndpoint(sub?.endpoint)) return res.status(400).json({ error: 'invalid_subscription' });
    const p = await loadUser(req.account.id);
    p.pushSub = { endpoint: sub.endpoint, keys: sub.keys || null, at: Date.now() };
    await saveUser(p);
    res.json({ ok: true });
  } catch (e) { console.error('[push] subscribe error:', e.message); res.status(500).json({ error: 'subscribe_failed' }); }
});

pushRouter.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  try { const p = await loadUser(req.account.id); p.pushSub = null; await saveUser(p); res.json({ ok: true }); }
  catch (e) { console.error('[push] unsubscribe error:', e.message); res.status(500).json({ error: 'unsubscribe_failed' }); }
});

// ── Test push to the caller — proves the whole chain (permission → sub → server → device) ──
pushRouter.post('/api/push/test', requireAuth, async (req, res) => {
  if (!(await pushReady())) return res.status(503).json({ error: 'push_unconfigured' });
  try {
    const p = await loadUser(req.account.id);
    if (!p.pushSub) return res.status(400).json({ error: 'not_subscribed' });
    const r = await sendPush(p.pushSub);
    if (r.expired) { p.pushSub = null; await saveUser(p); }
    res.json({ ok: r.ok, status: r.status });
  } catch (e) { console.error('[push] test error:', e.message); res.status(500).json({ error: 'test_failed' }); }
});

// ── Daily reminder — ADMIN_KEY-gated (cron target). Sends to everyone with a sub who hasn't
//    trained today; prunes dead subs. Idempotent-ish: safe to call once/day. ──
const adminKeyOk = adminRequestOk;

// Core daily send + a ONE-PER-DAY guard (kv 'config'/'lastDailyPush' = Cairo day-key). Both the
// admin endpoint and the self-trigger call this; the guard means it can never double-send in a day.
export async function runDailyReminders({ force = false } = {}) {
  if (!(await pushReady())) return { ok: false, reason: 'push_unconfigured' };
  const today = dayKey();
  if (!force) {
    try { if (dbEnabled() && (await kvGet('config', 'lastDailyPush')) === today) return { ok: true, alreadySent: true }; } catch {}
  }
  const accounts = (await listAllAccounts() || []).filter((a) => a && a.email && !/@example\.com$/i.test(a.email));
  let sent = 0, skipped = 0, pruned = 0;
  for (const a of accounts) {
    let p; try { p = await loadUser(a.id); } catch { continue; }
    if (!p.pushSub) continue;
    if (!force && lastActiveDay(p) === today) { skipped++; continue; }   // already practiced today — don't nag
    const r = await sendPush(p.pushSub);
    if (r.expired) { p.pushSub = null; await saveUser(p); pruned++; }
    else if (r.ok) sent++;
  }
  try { if (dbEnabled()) await kvSet('config', 'lastDailyPush', today); } catch {}
  console.log(`[push] daily reminder → sent=${sent} skipped(active today)=${skipped} pruned=${pruned}`);
  return { ok: true, sent, skipped, pruned };
}

// ── Trial-ending notice ──────────────────────────────────────────────────────────────────────
// The 3-day trial used to die in complete silence: day 3 looked identical to day 1, and there was
// no mail and no push at any point. Every learner who got busy for two days simply lapsed without
// ever being told the trial was ending — the largest pool of already-convinced people in the funnel.
//
// DARK BY DEFAULT (TRIAL_NOTICE_ENABLED=1 arms it). This is the house pattern for anything that
// reaches real users unprompted, and it matters more here than usual: a deploy must never start
// mailing people as a side effect. Force the admin endpoint against ONE account first, read the
// mail yourself, then arm it.
//
// Zero new infrastructure and zero spend: it rides the existing self-triggered daily window and
// the existing mailer.
export function trialNoticeEnabled() { return process.env.TRIAL_NOTICE_ENABLED === '1'; }

export async function runTrialNotices({ force = false, onlyEmail = null } = {}) {
  if (!force && !trialNoticeEnabled()) return { ok: false, reason: 'trial_notice_disabled' };
  if (!mailerConfigured()) return { ok: false, reason: 'mailer_unconfigured' };
  const today = dayKey();
  // Per-day guard, separate key from the push reminder so one cannot suppress the other.
  if (!force) {
    try { if (dbEnabled() && (await kvGet('config', 'lastTrialNotice')) === today) return { ok: true, alreadySent: true }; } catch {}
  }
  const accounts = (await listAllAccounts() || [])
    .filter((a) => a && a.email && !/@example\.com$/i.test(a.email))
    .filter((a) => !onlyEmail || String(a.email).toLowerCase() === String(onlyEmail).toLowerCase());

  let sent = 0, skipped = 0, failed = 0;
  for (const a of accounts) {
    // Exactly the last day of a still-active trial. Not 0 (already over — a mail then is just noise),
    // not 2+ (nothing has been decided yet).
    if (!trialActive(a) || trialDaysLeft(a) !== 1) { skipped++; continue; }
    // Claim BEFORE sending — see auth.claimTrialNotice. Returns false if this account was ever
    // notified, which is what makes "at most one, ever" hold across retries and restarts.
    if (!(await claimTrialNotice(a))) { skipped++; continue; }
    try {
      // Their own evidence, or nothing. A learner with no analysed interview gets the short mail
      // rather than an invented bottleneck.
      let label = '', quote = '', corrected = '';
      try {
        const rec = latestActiveRecord(await loadBottlenecks(a.id));
        if (rec) {
          label = CATEGORIES[rec.category]?.de || rec.category || '';
          const ev = (rec.evidenceQuotes || [])[0];
          if (ev?.quote && ev?.corrected) { quote = ev.quote; corrected = ev.corrected; }
        }
      } catch { /* evidence is a bonus, never a blocker */ }
      await sendTrialEndingMail(a.email, { label, quote, corrected, plansUrl: process.env.APP_URL || '' });
      sent++;
    } catch (e) { failed++; console.error('[trial-notice] send failed:', e.message); }
  }
  try { if (dbEnabled() && !onlyEmail) await kvSet('config', 'lastTrialNotice', today); } catch {}
  console.log(`[trial-notice] → sent=${sent} skipped=${skipped} failed=${failed}`);
  return { ok: true, sent, skipped, failed };
}

// Self-trigger: fired (fire-and-forget) on incoming requests. The keep-warm cron pings /health every
// ~10 min, so during the reminder window the server is awake and this runs — NO GitHub secret, no
// external cron needed. Throttled to one check/minute; the per-day guard above does the real work.
const REMINDER_HOUR_UTC = 17;   // 19:00 Africa/Cairo
let _lastCheck = 0, _dailyRunning = false;
export function maybeRunDaily() {
  const now = Date.now();
  if (now - _lastCheck < 60_000) return;
  _lastCheck = now;
  if (new Date(now).getUTCHours() !== REMINDER_HOUR_UTC) return;
  if (_dailyRunning) return;
  _dailyRunning = true;
  runDailyReminders({ force: false }).catch((e) => console.error('[push] self-trigger failed:', e.message))
    .finally(() => { _dailyRunning = false; });
  // Rides the same window. Its own per-day key and its own kill switch, so it can never delay or
  // suppress the push reminder, and a failure in one does not take out the other.
  runTrialNotices({ force: false }).catch((e) => console.error('[trial-notice] self-trigger failed:', e.message));
}

// Force the trial notice, optionally at ONE address — the safe first run before arming the flag.
// `?force=1` bypasses both the kill switch and the per-day guard, but NOT the one-per-account-ever
// claim, so even a forced run cannot mail somebody a second time.
pushRouter.post('/admin/trial-notice', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(403).json({ error: 'forbidden' });
  const r = await runTrialNotices({
    force: String(req.query.force || '') === '1',
    onlyEmail: req.query.email ? String(req.query.email) : null,
  });
  res.json(r);
});

pushRouter.post('/admin/push/daily', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(403).json({ error: 'forbidden' });
  const r = await runDailyReminders({ force: String(req.query.force || '') === '1' });
  if (r.reason === 'push_unconfigured') return res.status(503).json({ error: 'push_unconfigured' });
  res.json(r);
});
