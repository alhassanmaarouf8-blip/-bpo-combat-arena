/**
 * auth.js
 * Accounts, password auth, signed session tokens, and subscription gating.
 *
 * Multi-user: every account has an id; the progress store (store.js) is keyed by that
 * id, so each user's data is isolated. Secrets never leave the server — the browser only
 * ever holds a signed session token, never the OpenAI key or the auth secret.
 *
 * Billing is structured but NOT wired to a real processor: upgrade() simply flips the
 * tier (marked mock:true). The single seam to drop Stripe in later is billingRouter
 * POST /upgrade — everything else (tiers, entitlement, trial limits, gating) is ready.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync }                 from 'fs';
import path                           from 'path';
import { fileURLToPath }              from 'url';
import express                        from 'express';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto';
import { dbEnabled, kvGet, kvSet }    from './db.js';
import { PLANS }                       from './plans.config.js';
import { paymentStatusFor }            from './paymentsStore.js';
import { loadUser }                    from './store.js';
import { dayKey }                      from './time.js';

const DATA_DIR   = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const ACCT_FILE  = path.join(DATA_DIR, 'accounts.json');
const DEV_AUTH_SECRET = 'dev-insecure-secret-change-me-in-production';
const AUTH_SECRET = process.env.AUTH_SECRET || DEV_AUTH_SECRET;
// In a deployed environment, refuse to start with the insecure default — otherwise
// session tokens would be forgeable. (Render sets RENDER=true on every service.)
if (AUTH_SECRET === DEV_AUTH_SECRET && (process.env.RENDER || process.env.NODE_ENV === 'production')) {
  console.error('[auth] FATAL: AUTH_SECRET is unset or the insecure default in production. Set a strong AUTH_SECRET env var.');
  process.exit(1);
}
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DAY = 24 * 60 * 60 * 1000;

// ── Trial + tier config ──────────────────────────────────────────────────────
// Free tier gets the CHEAP assessment only — ZERO live Realtime fights. A live fight costs
// real money, so it is reserved for paid plans (Basic/Elite, see plans.config.js). The
// server gate in websocketManager._handleStartFight blocks any free user before a Realtime
// session can open. (Phase C replaces this session counter with daily live-minute limits.)
const TRIAL_SESSIONS = 0;   // free = 0 live fights (assessment only)
const TRIAL_DAYS     = 7;

export const TIERS = {
  trial: { id: 'trial', label: 'Gratis', priceEur: 0,  blurb: 'Kostenlose Niveau-Einstufung. Live-Interviews im Plan.' },
  pro:   { id: 'pro',   label: 'Pro',       priceEur: 19, blurb: 'Unbegrenzte Sitzungen, alle Bosse, volle Wiederholung' },
  team:  { id: 'team',  label: 'Team',      priceEur: 49, blurb: 'Pro für bis zu 5 Lernende + Fortschrittsberichte' },
};

// ── Account store (single JSON file, cached in memory) ───────────────────────
let _store = null; // { accounts: {id: account}, emailIndex: {email: id} }

async function load() {
  if (_store) return _store;
  if (dbEnabled()) {
    _store = (await kvGet('auth', 'store')) ?? { accounts: {}, emailIndex: {} };
  } else {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    try { _store = JSON.parse(await readFile(ACCT_FILE, 'utf8')); }
    catch { _store = { accounts: {}, emailIndex: {} }; }
  }
  _store.accounts   ??= {};
  _store.emailIndex ??= {};
  return _store;
}
async function persist() {
  if (dbEnabled()) { await kvSet('auth', 'store', _store); return; }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ACCT_FILE, JSON.stringify(_store, null, 2), 'utf8');
}

// ── Passwords (scrypt, no external deps) ─────────────────────────────────────
function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = scryptSync(pw, salt, 64).toString('hex');
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch { return false; }
}

// ── Signed session tokens (HMAC, no external deps) ───────────────────────────
const hmac = (s) => createHmac('sha256', AUTH_SECRET).update(s).digest('base64url');
export function signToken(uid) {
  const body = Buffer.from(JSON.stringify({ uid, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${body}.${hmac(body)}`;
}
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || hmac(body) !== sig) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

// ── Accounts ─────────────────────────────────────────────────────────────────
export async function getAccountById(id) {
  return (await load()).accounts[id] || null;
}
// Returns all account objects — used by the leaderboard to compute weekly rankings.
// Capped at 500 to prevent runaway load in the unlikely scenario of a large user base.
export async function listAllAccounts() {
  const s = await load();
  return Object.values(s.accounts || {}).slice(0, 500);
}
export async function getAccountByEmail(email) {
  const s = await load();
  const id = s.emailIndex[String(email).toLowerCase()];
  return id ? s.accounts[id] : null;
}

export async function createAccount(email, password) {
  const s = await load();
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('invalid_email'), { code: 400 });
  if (String(password || '').length < 6)        throw Object.assign(new Error('weak_password'), { code: 400 });
  if (s.emailIndex[email])                       throw Object.assign(new Error('email_taken'),   { code: 409 });

  const id = 'a_' + randomBytes(8).toString('hex');
  const account = {
    id, email,
    passwordHash: hashPassword(password),
    createdAt:    Date.now(),
    subscription: { tier: 'trial', trialStartedAt: Date.now(), trialSessionsUsed: 0 },
  };
  s.accounts[id] = account;
  s.emailIndex[email] = id;
  await persist();
  return account;
}

export async function authenticate(email, password) {
  const acct = await getAccountByEmail(email);
  if (!acct || !verifyPassword(password, acct.passwordHash)) return null;
  return acct;
}

// ── Plans (the single source of truth: server/plans.config.js) ───────────────
// Which plan does this account have? Admin → elite; legacy pro/team grants → elite;
// an explicit subscription.plan wins; everyone else is free.
export function planOf(account) {
  if (isAdminEmail(account?.email)) return 'elite';
  const s = account?.subscription || {};
  if (s.plan && PLANS[s.plan]) {
    // A paid plan with a billing end-date reverts to free once it expires.
    if (s.billingPeriodEnd && Date.now() > s.billingPeriodEnd) return 'free';
    return s.plan;
  }
  if (s.tier === 'pro' || s.tier === 'team') return 'elite'; // legacy paid grants keep access
  return 'free';
}
export function dailyMinutesFor(account) { return PLANS[planOf(account)]?.dailyLiveMinutes || 0; }

// ONE free 7-minute interview for a free account, ever — the acquisition hook. Available when the plan
// has no paid live minutes AND the free fight hasn't been spent yet (or for admins, always).
const FREE_FIGHT_SEC = 7 * 60;
export function freeFightAvailable(account) {
  if (isAdminEmail(account?.email)) return true;
  return (dailyMinutesFor(account) || 0) <= 0 && !account?.subscription?.freeFightUsed;
}

// Entitlement = the plan's capabilities. `allowed` = may start an interview: a paid plan with live
// minutes, OR the one-time free fight is still available. Enforced again server-side at fight start.
export function entitlement(account) {
  const plan = planOf(account);
  const feat = PLANS[plan] || PLANS.free;
  const freeFight = freeFightAvailable(account);
  return {
    allowed:               (feat.dailyLiveMinutes || 0) > 0 || freeFight,
    freeFight,                                   // true → client shows "1 kostenloses Interview"
    tier:                  plan,
    plan,
    dailyLiveMinutes:      feat.dailyLiveMinutes || 0,
    trainingslagerUnlocked: !!feat.trainingslagerUnlocked,
    unlimited:             isAdminEmail(account?.email),
  };
}

// Mark the one-time free fight as spent (called once a free interview actually starts).
export async function consumeFreeFight(account) {
  if (!account?.subscription) account.subscription = {};
  if (!account.subscription.freeFightUsed) {
    account.subscription.freeFightUsed = true;
    await persist();
  }
}

export async function consumeTrialSession(account) {
  if (account?.subscription?.tier === 'trial') {
    account.subscription.trialSessionsUsed = (account.subscription.trialSessionsUsed || 0) + 1;
    await persist();
  }
}

export async function upgrade(account, tier) {
  if (!TIERS[tier] || tier === 'trial') throw Object.assign(new Error('invalid_tier'), { code: 400 });
  // ── Stripe checkout would go HERE; for now we simply flip the tier (mock). ──
  account.subscription = { ...account.subscription, tier, upgradedAt: Date.now(), mock: true };
  await persist();
  return account;
}

// Set a learner's PLAN (free/basic/elite) — used by the admin grant route to fulfil a payment.
export async function setPlan(account, plan) {
  if (!PLANS[plan]) throw Object.assign(new Error('invalid_plan'), { code: 400 });
  account.subscription = { ...account.subscription, plan, planSetAt: Date.now() };
  await persist();
  return account;
}

// Activate a paid plan with a billing end-date (1 month or 1 year) — used by the admin panel
// when a Vodafone Cash payment is confirmed. The daily-minute gating takes effect immediately.
export async function activatePlan(account, plan, billingPeriod) {
  if (!PLANS[plan]) throw Object.assign(new Error('invalid_plan'), { code: 400 });
  const now = Date.now();
  const periodMs = billingPeriod === 'yearly' ? 365 * DAY : 30 * DAY;
  // activatedNoticePending → the user sees a one-time "your plan is active 🎉" message.
  account.subscription = { ...account.subscription, plan, planSetAt: now, billingPeriodEnd: now + periodMs, activatedNoticePending: true };
  await persist();
  return account;
}

// Manually REVOKE a paid plan (admin action). Reverts the account to free immediately:
// clears the explicit plan, drops any legacy pro/team grant (tier→trial), and expires the
// billing window so planOf() returns 'free' on the very next request. Note: an ADMIN_EMAIL
// account always resolves to elite (owner override) and is unaffected by this.
export async function deactivatePlan(account) {
  const now = Date.now();
  account.subscription = {
    ...account.subscription,
    plan: null,
    tier: 'trial',
    billingPeriodEnd: now,        // expired now (planOf falls back to free)
    deactivatedAt: now,
    activatedNoticePending: false,
  };
  await persist();
  return account;
}

// Hard-delete the login record AND free the email (admin action). After this, getAccountById
// returns null (cannot sign in) and createAccount sees the email as brand-new (can sign up
// again). Only touches THIS account's two entries — never any other account. Returns false if
// the account no longer exists (already deleted), so the caller can report it gracefully.
export async function deleteAccount(account) {
  const s = await load();
  const id = account?.id;
  if (!id || !s.accounts[id]) return false;
  const email = String(account.email || '').toLowerCase();
  delete s.accounts[id];
  if (email && s.emailIndex[email] === id) delete s.emailIndex[email];
  await persist();
  return true;
}

// Owner/admin recognition: ADMIN_EMAIL is a comma-separated allowlist set on the server.
// Used to gate the feedback dashboard so only you can read willingness-to-pay data.
export function isAdminEmail(email) {
  const admins = String(process.env.ADMIN_EMAIL || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return !!email && admins.includes(String(email).toLowerCase());
}

export function publicAccount(a) {
  return { id: a.id, email: a.email, subscription: a.subscription, entitlement: entitlement(a), isAdmin: isAdminEmail(a.email) };
}

// ── Express middleware + routers ─────────────────────────────────────────────
export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!payload) return res.status(401).json({ error: 'auth_required' });
  const acct = await getAccountById(payload.uid);
  if (!acct) return res.status(401).json({ error: 'auth_required' });
  req.account = acct;
  next();
}

// ── Brute-force / spam guard: in-memory sliding-window rate limiter ───────────
// A public URL means /login and /signup must not be brute-forceable. Keyed by client IP
// (read from X-Forwarded-For since Render runs behind a proxy). In-memory is sufficient for
// a single instance and simply resets on restart — an acceptable trade-off here.
const _rl = new Map(); // key -> [timestamps]
function rateLimit({ windowMs, max, tag }) {
  return (req, res, next) => {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.socket?.remoteAddress || 'unknown';
    const key = `${tag}:${ip}`;
    const now = Date.now();
    const hits = (_rl.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'too_many_attempts', retryAfter: retry });
    }
    hits.push(now);
    _rl.set(key, hits);
    if (_rl.size > 5000) { // opportunistic cleanup to bound memory
      for (const [k, v] of _rl) if (!v.some((t) => now - t < windowMs)) _rl.delete(k);
    }
    next();
  };
}

export const authRouter = express.Router();

authRouter.post('/signup', rateLimit({ windowMs: 60 * 60 * 1000, max: 8, tag: 'signup' }), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const acct = await createAccount(email, password);
    res.json({ token: signToken(acct.id), account: publicAccount(acct) });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

authRouter.post('/login', rateLimit({ windowMs: 10 * 60 * 1000, max: 10, tag: 'login' }), async (req, res) => {
  const { email, password } = req.body || {};
  const acct = await authenticate(email, password);
  if (!acct) return res.status(401).json({ error: 'invalid_credentials' });
  res.json({ token: signToken(acct.id), account: publicAccount(acct) });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ account: publicAccount(req.account) }));

export const billingRouter = express.Router();

billingRouter.get('/status', requireAuth, async (req, res) => {
  // Pending-payment state is the source of truth for "we're verifying" (vs the normal paywall).
  let pending = null, paymentRejected = false;
  try {
    const st = await paymentStatusFor(req.account.id);
    if (st.pending) pending = { referenceCode: st.pending.referenceCode, plan: st.pending.plan, billingPeriod: st.pending.billingPeriod, createdAt: st.pending.createdAt };
    paymentRejected = st.lastRejected;
  } catch (e) { console.error('[billing] status payment lookup failed:', e.message); }

  res.json({
    account:    publicAccount(req.account),
    // The paid plans straight from plans.config.js (EGP prices + daily minutes — ONE source).
    plans: [PLANS.basic, PLANS.elite],
    // Manual payment details — ONLY from env (never hardcoded). Each is null/hidden if unset.
    vodafoneNumber: process.env.VODAFONE_CASH_NUMBER || null,
    instapayAddress: process.env.INSTAPAY_ADDRESS || null,
    bankInfo:       process.env.BANK_ACCOUNT_INFO || null,
    whatsappNumber: process.env.WHATSAPP_NUMBER || null,
    pendingPayment: pending,    // { referenceCode, plan, billingPeriod, createdAt } | null
    paymentRejected,            // true if their latest payment was rejected (→ normal paywall + note)
  });
});

// Lightweight live state for the HOME screen: daily minutes left, pending payment, and a
// one-time "just activated" flag. All server-side truth.
billingRouter.get('/state', requireAuth, async (req, res) => {
  const account = req.account;
  const plan    = planOf(account);
  const minutes = dailyMinutesFor(account);

  let usedSec = 0;
  try {
    const p = await loadUser(account.id);
    if (p.liveUsage?.day === dayKey()) usedSec = p.liveUsage.sec || 0;
  } catch (e) { console.error('[billing] state usage lookup failed:', e.message); }
  const remainingSec = Math.max(0, minutes * 60 - usedSec);

  let pending = null, justActivated = false;
  try {
    const st = await paymentStatusFor(account.id);
    if (st.pending) pending = { referenceCode: st.pending.referenceCode, plan: st.pending.plan, billingPeriod: st.pending.billingPeriod };
  } catch { /* ignore */ }
  justActivated = !!(account.subscription?.activatedNoticePending) && minutes > 0;

  res.json({
    plan, dailyLiveMinutes: minutes,
    minutesUsedToday: Math.floor(usedSec / 60),
    minutesRemaining: Math.ceil(remainingSec / 60),   // whole minutes; server enforces the exact cap
    secondsRemaining: remainingSec,
    pendingPayment: pending,
    justActivated,
    vodafoneNumber: process.env.VODAFONE_CASH_NUMBER || null,
    whatsappNumber: process.env.WHATSAPP_NUMBER || null,
  });
});

// Acknowledge the one-time activation message so it never shows again.
billingRouter.post('/ack-activation', requireAuth, async (req, res) => {
  try {
    const s = req.account.subscription;
    if (s && s.activatedNoticePending) { s.activatedNoticePending = false; await persist(); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'ack_failed' }); }
});

// Owner-only: set a learner's PLAN (free/basic/elite) by email — used to fulfil a manual
// payment, and to flip your own account for testing. Gated to ADMIN_EMAIL accounts.
billingRouter.post('/admin/grant', requireAuth, async (req, res) => {
  if (!isAdminEmail(req.account.email)) return res.status(403).json({ error: 'forbidden' });
  try {
    const body = req.body || {};
    // Accept {plan} (new) or {tier} (legacy 'pro'/'team' → elite); default elite.
    let plan = body.plan;
    if (!plan) plan = (body.tier === 'team' || body.tier === 'pro') ? 'elite' : 'elite';
    const target = await getAccountByEmail(body.email);
    if (!target) return res.status(404).json({ error: 'user_not_found' });
    await setPlan(target, plan);
    console.log(`[billing] ADMIN SET PLAN ${plan} -> ${target.email}  by ${req.account.email}`);
    res.json({ ok: true, email: target.email, plan: target.subscription.plan });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

billingRouter.post('/upgrade', requireAuth, async (req, res) => {
  // Mock upgrade has NO payment verification, so anyone could self-grant Pro. Keep it
  // OFF unless explicitly enabled (set ENABLE_MOCK_BILLING=true for demos/testing). Once
  // a real payment processor is wired in, this gate is replaced by a verified webhook.
  if (process.env.ENABLE_MOCK_BILLING !== 'true') {
    return res.status(403).json({ error: 'billing_not_available' });
  }
  try {
    await upgrade(req.account, (req.body || {}).tier);
    res.json({ account: publicAccount(req.account) });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});
