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
import { timingSafeEqual } from 'crypto';
import { dayKey } from './time.js';
import { loadUser, saveUser } from './store.js';
import { requireAuth, listAllAccounts } from './auth.js';

export const pushRouter = express.Router();

const PUB  = process.env.VAPID_PUBLIC_KEY  || '';
const PRIV = process.env.VAPID_PRIVATE_KEY || '';   // pkcs8, base64
const SUB  = process.env.VAPID_SUBJECT     || 'mailto:info@omni-perform.app';

let privKey = null;
try { if (PUB && PRIV) privKey = crypto.createPrivateKey({ key: Buffer.from(PRIV, 'base64'), format: 'der', type: 'pkcs8' }); }
catch (e) { console.error('[push] VAPID private key invalid — push disabled:', e.message); privKey = null; }

export function pushEnabled() { return !!(PUB && privKey); }

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// A VAPID Authorization header for one push endpoint (aud = its origin). ES256 JWT, 12h expiry.
function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin;
  const header  = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUB }));
  const input = `${header}.${payload}`;
  const sig = crypto.sign('SHA256', Buffer.from(input), { key: privKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${input}.${b64u(sig)}, k=${PUB}`;
}

// Send one bodyless push. Returns { ok, status, expired }. Never throws.
async function sendPush(sub) {
  if (!pushEnabled() || !sub?.endpoint) return { ok: false, status: 0, expired: false };
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: vapidAuth(sub.endpoint), TTL: '86400', 'Content-Length': '0' },
    });
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

// ── Public: VAPID key for the client ──
pushRouter.get('/api/push/key', (_req, res) => res.json({ enabled: pushEnabled(), key: pushEnabled() ? PUB : null }));

// ── Save / clear a subscription on the user's profile ──
pushRouter.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const sub = req.body?.subscription || req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: 'no_subscription' });
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
  if (!pushEnabled()) return res.status(503).json({ error: 'push_unconfigured' });
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
function adminKeyOk(req) {
  const key = process.env.ADMIN_KEY || '';
  if (!key) return false;
  const got = String(req.query.key || req.headers['x-admin-key'] || (req.body && req.body.key) || '');
  if (got.length !== key.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(key)); } catch { return false; }
}

pushRouter.post('/admin/push/daily', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(403).json({ error: 'forbidden' });
  if (!pushEnabled()) return res.status(503).json({ error: 'push_unconfigured' });
  try {
    const today = dayKey();
    const force = String(req.query.force || '') === '1';   // send even to those already active today (for testing)
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
    console.log(`[push] daily reminder → sent=${sent} skipped(active today)=${skipped} pruned=${pruned}`);
    res.json({ ok: true, sent, skipped, pruned });
  } catch (e) { console.error('[push] daily error:', e.message); res.status(500).json({ error: 'daily_failed' }); }
});
