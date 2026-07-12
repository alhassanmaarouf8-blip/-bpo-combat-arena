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
import { randomBytes, scrypt, timingSafeEqual, createHmac, createHash } from 'crypto';
import { promisify } from 'util';
import { mailerConfigured, sendResetMail, sendVerificationMail } from './mailer.js';
import { dbEnabled, kvGet, kvSet }    from './db.js';
import { PLANS, OFFER, offerActive, offerPrice } from './plans.config.js';
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
const scryptAsync = promisify(scrypt);
async function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from(await scryptAsync(pw, salt, 64)).toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = Buffer.from(await scryptAsync(pw, salt, 64)).toString('hex');
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch { return false; }
}

// ADMIN support tool: set a new password for an account (manual recovery over WhatsApp).
// There is no email infrastructure for a self-serve reset, and before this the only "fix"
// for a locked-out PAYING customer was deleting the account — wiping all their progress.
export async function adminSetPassword(email, newPassword) {
  if (String(newPassword || '').length < 10 || String(newPassword || '').length > 128) throw Object.assign(new Error('password_too_short'), { code: 400 });
  const acc = await getAccountByEmail(email);
  if (!acc) return null;
  acc.passwordHash = await hashPassword(newPassword);
  acc.sessionVersion = (acc.sessionVersion || 0) + 1;
  delete acc.resetToken;   // an outstanding emailed reset link must die with a support reset
  await persist();
  return acc;
}

// ── Signed session tokens (HMAC, no external deps) ───────────────────────────
const hmac = (s) => createHmac('sha256', AUTH_SECRET).update(s).digest('base64url');
export function signToken(account) {
  const uid = typeof account === 'string' ? account : account?.id;
  const v = typeof account === 'string' ? 0 : (account?.sessionVersion || 0);
  const body = Buffer.from(JSON.stringify({ uid, v, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${body}.${hmac(body)}`;
}
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(hmac(body));
  const supplied = Buffer.from(sig);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

export function tokenMatchesAccount(payload, account) {
  return !!payload && !!account && payload.uid === account.id
    && (payload.v || 0) === (account.sessionVersion || 0);
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

// Normalize a raw WhatsApp/phone entry to intl digits, or return null if not a valid number.
// Egyptian mobiles: 01XXXXXXXXX (11 digits) or 1XXXXXXXXX (10) → prefixed to 20…; any other
// 10-15 digit international number is accepted as typed (diaspora users). Single source of
// truth so signup and the /whatsapp opt-in normalize identically.
export function normalizeWhatsapp(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let n = digits;
  if (/^01[0125]\d{8}$/.test(digits)) n = '2' + digits;
  else if (/^1[0125]\d{8}$/.test(digits)) n = '20' + digits;
  return /^\d{10,15}$/.test(n) ? n : null;
}

export async function createAccount(email, password, ref, whatsapp) {
  const s = await load();
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('invalid_email'), { code: 400 });
  if (String(password || '').length < 10 || String(password || '').length > 128)
    throw Object.assign(new Error('weak_password'), { code: 400 });
  if (s.emailIndex[email])                       throw Object.assign(new Error('email_taken'),   { code: 409 });

  // WhatsApp is optional and never collected by the current signup form. If an older trusted
  // caller supplies it, normalize it for the legacy `phone` field; marketing consent is still a
  // separate explicit post-value action below.
  const waNum = normalizeWhatsapp(whatsapp);

  const id = 'a_' + randomBytes(8).toString('hex');
  const refId = typeof ref === 'string' ? ref.trim() : '';
  const account = {
    id, email,
    phone:        waNum || null,
    passwordHash: await hashPassword(password),
    sessionVersion: 0,
    createdAt:    Date.now(),
    // New accounts must prove mailbox ownership before any authenticated product/API route can
    // consume provider capacity. Accounts created before this field existed are grandfathered by
    // emailOwnershipVerified() so this security repair does not lock out established customers.
    emailVerificationRequired: true,
    emailVerifiedAt: null,
    subscription: { tier: 'trial', trialStartedAt: null, trialSessionsUsed: 0 },
    // Referral attribution is analytics-only. It never grants provider-backed trial time.
    ...(refId && s.accounts[refId] && refId !== id ? { referredBy: refId } : {}),
  };
  // A phone number is never treated as marketing/reminder consent at account creation.
  // Email ownership is not verified at signup. Never attach roles, comp access or any other
  // privilege solely because the submitted address appears on an allowlist. Owner grants are
  // applied to an existing account from the separately authenticated admin panel.
  s.accounts[id] = account;
  s.emailIndex[email] = id;
  await persist();
  return account;
}

export async function authenticate(email, password) {
  const acct = await getAccountByEmail(email);
  if (!acct || !(await verifyPassword(password, acct.passwordHash))) return null;
  return acct;
}

// ── Plans (the single source of truth: server/plans.config.js) ───────────────
// Which plan does this account have? Admin → elite; legacy pro/team grants → elite;
// an explicit subscription.plan wins; everyone else is free.
export function planOf(account) {
  if (isAdminAccount(account)) return 'elite';
  const s = account?.subscription || {};
  // Comp access (server/compAccess.js): a standing owner grant, immune to billingPeriodEnd —
  // it never silently expires like a real payment period. Only admin removal revokes it.
  if (s.comp && s.plan && PLANS[s.plan]) return s.plan;
  if (s.plan && PLANS[s.plan]) {
    // A paid plan with a billing end-date reverts to free once it expires.
    if (s.billingPeriodEnd && Date.now() > s.billingPeriodEnd) return 'free';
    return s.plan;
  }
  if (s.tier === 'pro' || s.tier === 'team') return 'elite'; // legacy paid grants keep access
  return 'free';
}
// FREE TRIAL — the acquisition engine. New free users live the full Fokus product (daily interview
// minutes + ALL drills) for their first FREE_TRIAL_DAYS, so they FEEL the benefit before the paywall —
// not just one cold interview. Bounded per account (a few days), so cost exposure is capped. Tunable.
const FREE_TRIAL_DAYS = 3;
const FREE_TRIAL_DAY_MS = 86400000;
export function trialActive(account) {
  if (!account || isAdminAccount(account)) return false;   // admins are already elite
  if (planOf(account) !== 'free') return false;                // paid users don't need the trial
  const start = account.subscription?.trialStartedAt;
  const days = FREE_TRIAL_DAYS;
  return !!start && (Date.now() - start) < days * FREE_TRIAL_DAY_MS;
}
export function trialDaysLeft(account) {
  const start = account?.subscription?.trialStartedAt;
  if (!start) return 0;
  const days = FREE_TRIAL_DAYS;
  return Math.max(0, Math.ceil((days * FREE_TRIAL_DAY_MS - (Date.now() - start)) / FREE_TRIAL_DAY_MS));
}
// During the trial a free user gets Fokus-level daily minutes; otherwise the plan's own value.
export function dailyMinutesFor(account) {
  if (trialActive(account)) return PLANS.basic.dailyLiveMinutes || 0;
  return PLANS[planOf(account)]?.dailyLiveMinutes || 0;
}
// Drills (listening, fluency, spoken-review, shadowing) — unlocked for any paid plan OR an active trial.
export function drillsUnlocked(account) {
  return planOf(account) !== 'free' || trialActive(account);
}

// ONE free 7-minute interview for a free account, ever — the acquisition hook. Available when the plan
// has no paid live minutes AND the free fight hasn't been spent yet (or for admins, always).
const FREE_FIGHT_SEC = 7 * 60;
export function freeFightAvailable(account) {
  if (isAdminAccount(account)) return true;
  return (dailyMinutesFor(account) || 0) <= 0 && !account?.subscription?.freeFightUsed;
}

// Entitlement = the plan's capabilities. `allowed` = may start an interview: a paid plan with live
// minutes, OR the one-time free fight is still available. Enforced again server-side at fight start.
export function entitlement(account) {
  const plan = planOf(account);
  const feat = PLANS[plan] || PLANS.free;
  const mins = dailyMinutesFor(account);          // trial-aware (Fokus minutes during the trial)
  const freeFight = freeFightAvailable(account);
  const trial = trialActive(account);
  // Interviews/day for display — plans are SOLD as full daily interviews (owner quota law 07-11).
  const sessions = trial ? (PLANS.basic.dailySessions || 0) : (feat.dailySessions || 0);
  return {
    allowed:               mins > 0 || freeFight,
    freeFight,                                   // true → client shows "1 kostenloses Interview"
    tier:                  plan,
    plan,
    dailyLiveMinutes:      mins,
    dailySessions:         sessions,
    drillsUnlocked:        drillsUnlocked(account),
    trial:                 { active: trial, daysLeft: trial ? trialDaysLeft(account) : 0 },
    zielStelle:            !!feat.zielStelle || trial,                // Ziel-Stelle matching — trial gives the full taste
    unlimited:             isAdminAccount(account),
  };
}

// Mark the one-time free fight as spent (called once a free interview actually starts).
export async function consumeFreeFight(account) {
  if (!account?.subscription) account.subscription = {};
  if (!account.subscription.freeFightUsed) {
    account.subscription.freeFightUsed = true;
    // The trial clock begins only after the backend has accepted the learner's first
    // interview session, never while they are merely reading or registering.
    account.subscription.trialStartedAt ||= Date.now();
    await persist();
  }
}

export function emailOwnershipVerified(account) {
  if (!account) return false;
  if (account.emailVerificationRequired !== true) return true; // legacy account, pre-verification rollout
  return Number.isFinite(account.emailVerifiedAt) && account.emailVerifiedAt > 0;
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFY_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

export async function issueEmailVerificationToken(account) {
  const now = Date.now();
  const raw = randomBytes(32).toString('hex');
  account.emailVerification = {
    hash: createHash('sha256').update(raw).digest('hex'),
    exp: now + VERIFY_TTL_MS,
    issuedAt: now,
  };
  await persist();
  return raw;
}

export async function verifyEmailToken(token) {
  if (typeof token !== 'string' || token.length < 40) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const s = await load();
  const account = Object.values(s.accounts || {}).find((a) => a.emailVerification?.hash === hash);
  if (!account || !account.emailVerification || Date.now() > account.emailVerification.exp) return null;
  account.emailVerifiedAt = Date.now();
  delete account.emailVerification;
  await persist();
  return account;
}

async function prepareVerification(account, { force = false } = {}) {
  if (!account || emailOwnershipVerified(account)) return { status: 'verified' };
  if (!mailerConfigured()) return { status: 'unavailable' };
  const now = Date.now();
  if (!force && account.emailVerification?.issuedAt
      && now - account.emailVerification.issuedAt < VERIFY_RESEND_COOLDOWN_MS) {
    return { status: 'cooldown' };
  }
  const raw = await issueEmailVerificationToken(account);
  return { status: 'ready', raw };
}

function sendPreparedVerification(account, raw) {
  const expectedHash = createHash('sha256').update(raw).digest('hex');
  sendVerificationMail(account.email, `${APP_URL}/?verify=${raw}`)
    .catch(async (e) => {
      console.error(`[verify] mail failed account=${account.id}: ${e.message}`);
      // Do not leave a failed delivery inside the resend cooldown. Clear only the exact token this
      // failed send prepared; a newer resend must never be invalidated by an older SMTP failure.
      if (account.emailVerification?.hash === expectedHash) {
        delete account.emailVerification;
        try { await persist(); } catch (persistError) {
          console.error(`[verify] failed-token cleanup failed account=${account.id}: ${persistError.message}`);
        }
      }
    });
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

// Grant comp access (admin action, server/compAccess.js): apply the standing whitelist grant to
// an ALREADY-REGISTERED account immediately (the signup-time path lives in createAccount above).
// No billing period — comp access never expires on its own; only revokeComp/deactivatePlan ends it.
export async function grantComp(account, plan) {
  if (!PLANS[plan]) throw Object.assign(new Error('invalid_plan'), { code: 400 });
  account.subscription = { ...account.subscription, plan, comp: true, compGrantedAt: Date.now(), activatedNoticePending: true };
  await persist();
  return account;
}

// Activate a paid plan with a billing end-date (1 month or 1 year) — used by the admin panel
// when a Vodafone Cash payment is confirmed. The daily-minute gating takes effect immediately.
export async function activatePlan(account, plan, billingPeriod, paymentId = null) {
  if (!PLANS[plan]) throw Object.assign(new Error('invalid_plan'), { code: 400 });
  const now = Date.now();
  if (paymentId && account.subscription?.lastActivationPaymentId === paymentId) return account;
  // 'once' = a one-time plan (PLANS[plan].once): access runs its configured duration, then
  // planOf()'s normal billingPeriodEnd check lapses it to free — same mechanics, longer window.
  const periodMs = billingPeriod === 'once'   ? (PLANS[plan].onceDurationDays || 365) * DAY
                 : billingPeriod === 'yearly' ? 365 * DAY : 30 * DAY;
  // activatedNoticePending → the user sees a one-time "your plan is active 🎉" message.
  const currentEnd = Number(account.subscription?.billingPeriodEnd) || 0;
  const startsAt = Math.max(now, currentEnd);
  account.subscription = { ...account.subscription, plan, comp: false, planSetAt: now,
    billingPeriodEnd: startsAt + periodMs, activatedNoticePending: true,
    ...(paymentId ? { lastActivationPaymentId: paymentId } : {}) };
  await persist();
  return account;
}

// Grant a plan that AUTO-EXPIRES after `days` days — a real time-limited pass (e.g. a 2-day
// goodwill Basic). Unlike comp (permanent, immune to billingPeriodEnd), this is a normal
// paid-plan shape WITH a billing end date and comp:false, so planOf() reverts the account to
// 'free' by itself the moment it lapses — NO cron, NO manual removal. On lapse the user simply
// meets the normal paywall ("pay to keep training"). Owner 2026-07-08: give the 18 re-engaged
// leads Basic for exactly 2 days, then it ends on its own.
export async function grantPlanForDays(account, plan, days) {
  if (!PLANS[plan]) throw Object.assign(new Error('invalid_plan'), { code: 400 });
  const now = Date.now();
  const d = Math.max(1, Math.min(60, Math.floor(Number(days) || 0)));
  account.subscription = {
    ...account.subscription,
    plan, comp: false,                          // NOT comp → subject to expiry
    planSetAt: now,
    billingPeriodEnd: now + d * DAY,
    activatedNoticePending: true,
  };
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
    comp: false,                  // clears a comp grant too, if this account had one
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
  for (const other of Object.values(s.accounts)) {
    if (other?.referredBy === id) delete other.referredBy;
  }
  await persist();
  return true;
}

// A user-supplied email is never an authorization factor. A future verified-email flow may grant
// roles explicitly; until then only an explicit stored role plus verification timestamp can
// authorize these legacy account-authenticated admin surfaces. The separate /admin panel remains.
export function isAdminAccount(account) {
  return !!account?.emailVerifiedAt && Array.isArray(account?.roles) && account.roles.includes('admin');
}

export function publicAccount(a) {
  // whatsapp is exposed as a BOOLEAN only — the client just needs "already opted in?" to hide
  // the ask-card across devices; the number itself stays server/admin-side.
  return { id: a.id, email: a.email, emailVerified: emailOwnershipVerified(a), subscription: a.subscription, entitlement: entitlement(a), isAdmin: isAdminAccount(a), whatsapp: !!a.whatsapp?.number };
}

// ── Express middleware + routers ─────────────────────────────────────────────
export async function requireSession(req, res, next) {
  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!payload) return res.status(401).json({ error: 'auth_required' });
  const acct = await getAccountById(payload.uid);
  if (!tokenMatchesAccount(payload, acct)) return res.status(401).json({ error: 'auth_required' });
  req.account = acct;
  next();
}

// All product/API routers import requireAuth, so this one gate protects every provider-backed
// surface — not just the obvious WebSocket start button. /me and verification resend use the
// session-only middleware above so an unverified user can still complete verification or log out.
export async function requireAuth(req, res, next) {
  return requireSession(req, res, () => {
    if (!emailOwnershipVerified(req.account)) return res.status(403).json({ error: 'email_verification_required' });
    next();
  });
}

// ── Brute-force / spam guard: in-memory sliding-window rate limiter ───────────
// A public URL means /login and /signup must not be brute-forceable. Keyed by client IP
// (read from X-Forwarded-For since Render runs behind a proxy). In-memory is sufficient for
// a single instance and simply resets on restart — an acceptable trade-off here.
const _rl = new Map(); // key -> [timestamps]
export function rateLimit({ windowMs, max, tag, keyExtra, global = false }) {
  return (req, res, next) => {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    // keyExtra narrows the bucket below the IP (e.g. per-account for login) so strict limits can
    // coexist with CGNAT: hundreds of REAL Egyptian users share one carrier IP.
    const key = `${tag}:${global ? 'all' : ip}${keyExtra ? ':' + keyExtra(req) : ''}`;
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

// CGNAT reality (found 2026-07-10 when the per-IP guard blocked QA): Egyptian mobile carriers put
// hundreds of users behind ONE public IP. At max:8/hour, a successful Facebook post lets 8 people
// in and shows everyone else on that carrier IP "Zu viele Versuche" at the moment of highest
// intent. Signup is not a brute-force target (it CREATES accounts; email uniqueness + trial limits
// bound the abuse), so the per-IP cap only needs to stop scripted floods — 60/hour does that while
// surviving a real launch burst.
authRouter.post('/signup',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 250, tag: 'signup-global', global: true }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, tag: 'signup' }),
  async (req, res) => {
  try {
    const { email, password, ref } = req.body || {};
    const acct = await createAccount(email, password, ref, null);
    const prepared = await prepareVerification(acct);
    if (prepared.status === 'ready') sendPreparedVerification(acct, prepared.raw);
    res.json({ token: signToken(acct), account: publicAccount(acct), verificationEmailSent: prepared.status === 'ready' });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

// Login keeps brute-force protection but must survive CGNAT (see signup note): the per-IP cap is
// generous (80/10min — a burst of REAL users on one carrier IP), while a second, strict limiter is
// keyed per IP+account (8/10min) so credential-stuffing any one mailbox is still blocked.
authRouter.post('/login',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 80, tag: 'login' }),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 8,  tag: 'login-acct',
              keyExtra: (req) => String(req.body?.email || '').toLowerCase().slice(0, 80) }),
  async (req, res) => {
  const { email, password } = req.body || {};
  const acct = await authenticate(email, password);
  if (!acct) return res.status(401).json({ error: 'invalid_credentials' });
  res.json({ token: signToken(acct), account: publicAccount(acct) });
});

authRouter.get('/me', requireSession, (req, res) => res.json({ account: publicAccount(req.account) }));

authRouter.post('/verification/resend',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 150, tag: 'verify-resend-global', global: true }),
  requireSession,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 3, tag: 'verify-resend', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    const prepared = await prepareVerification(req.account);
    if (prepared.status === 'ready') sendPreparedVerification(req.account, prepared.raw);
    if (prepared.status === 'unavailable') return res.status(503).json({ error: 'email_unavailable' });
    res.json({ ok: true, sent: prepared.status === 'ready', cooldown: prepared.status === 'cooldown' });
  });

authRouter.post('/verify',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, tag: 'verify' }),
  async (req, res) => {
    const token = req.body?.token;
    const account = await verifyEmailToken(token);
    if (!account) return res.status(400).json({ error: 'invalid_or_expired' });
    res.json({ ok: true });
  });

// ── Self-serve password reset via E-MAIL (owner order 2026-07-10: "the reset password is done
// through email" — the WhatsApp-manual flow is dead; adminSetPassword stays as a support tool).
// Design: 32 random bytes; only the sha256 of the token is stored (a leaked store can't burn a
// live link); 45 min TTL; single-use; /forgot answers ok:true whether or not the account exists
// (no account enumeration) and never reveals a send failure. emailConfigured:false is the ONE
// honest exception — until the owner sets SMTP_USER/SMTP_PASS the client must not promise mail.
const APP_URL = process.env.APP_URL || 'https://bpo-combat-arena.vercel.app';
const RESET_TTL_MS = 45 * 60 * 1000;

// Rate shape mirrors /login's CGNAT lesson (hundreds of real users share one carrier IP):
// generous per-IP + strict per-EMAIL. The per-email cap doubles as the Gmail-quota fuse —
// no attacker can bomb one inbox or drain the 500/day free quota from a single address.
authRouter.post('/forgot',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 40, tag: 'forgot' }),
  rateLimit({ windowMs: 15 * 60 * 1000, max: 3, tag: 'forgot-acct',
              keyExtra: (req) => String(req.body?.email || '').toLowerCase().slice(0, 80) }),
  async (req, res) => {
  if (!mailerConfigured()) return res.json({ ok: false, emailConfigured: false });
  const acc = await getAccountByEmail(req.body?.email);
  const responseDelayMs = 175 + (randomBytes(1)[0] % 76);
  if (acc) {
    // Resend cooldown: a link issued <2 min ago is still in flight — don't burn another mail.
    const issuedAt = acc.resetToken ? acc.resetToken.exp - RESET_TTL_MS : 0;
    if (Date.now() - issuedAt > 2 * 60 * 1000) {
      const raw = randomBytes(32).toString('hex');
      acc.resetToken = { hash: createHash('sha256').update(raw).digest('hex'), exp: Date.now() + RESET_TTL_MS };
      // Persist, then send, in the background. The public response follows the same small jittered
      // delay for existing and unknown accounts, so database/SMTP latency cannot become an oracle.
      // Mail cannot race the stored token because sending is chained after persistence.
      persist()
        .then(() => sendResetMail(acc.email, `${APP_URL}/?reset=${raw}`))
        .catch((e) => console.error(`[forgot] reset preparation failed account=${acc.id}: ${e.message}`));
    }
  }
  setTimeout(() => res.json({ ok: true }), responseDelayMs);
});

authRouter.post('/reset', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, tag: 'reset' }), async (req, res) => {
  const { token, password } = req.body || {};
  if (String(password || '').length < 10 || String(password || '').length > 128) return res.status(400).json({ error: 'password_too_short' });
  if (typeof token !== 'string' || token.length < 40) return res.status(400).json({ error: 'invalid_token' });
  const h = createHash('sha256').update(token).digest('hex');
  const s = await load();
  const acc = Object.values(s.accounts || {}).find((a) => a.resetToken?.hash === h);
  if (!acc || !acc.resetToken || Date.now() > acc.resetToken.exp) {
    return res.status(400).json({ error: 'invalid_or_expired' });
  }
  acc.passwordHash = await hashPassword(password);
  acc.sessionVersion = (acc.sessionVersion || 0) + 1;
  delete acc.resetToken;               // single-use — the link dies with the change
  // A valid reset link reached this mailbox, so it is also valid ownership proof.
  if (acc.emailVerificationRequired === true && !emailOwnershipVerified(acc)) {
    acc.emailVerifiedAt = Date.now();
    delete acc.emailVerification;
  }
  await persist();
  console.log(`[reset] password reset via email link user=${acc.id}`);
  res.json({ token: signToken(acc), account: publicAccount(acc) });   // straight back in
});

// Optional WhatsApp opt-in — the app's ONLY re-engagement channel at $0 (no email infra, no
// push). The learner leaves a number AFTER experiencing the product (the card shows post-
// interview #1); the OWNER messages personally — nothing automated sends anywhere, so there is
// no ban risk and the "kein Spam, persönlich vom Coach" promise is true by construction.
authRouter.post('/whatsapp', rateLimit({ windowMs: 10 * 60 * 1000, max: 6, tag: 'whatsapp' }), requireAuth, async (req, res) => {
  const n = normalizeWhatsapp(req.body?.number);
  if (!n) return res.status(400).json({ error: 'invalid_number' });
  req.account.whatsapp = { number: n, optInAt: Date.now() };
  await persist();
  console.log(`[whatsapp] reminder consent saved user=${req.account.id}`);
  res.json({ ok: true });
});

export const billingRouter = express.Router();

billingRouter.get('/status', requireAuth, async (req, res) => {
  // Pending-payment state is the source of truth for "we're verifying" (vs the normal paywall).
  let pending = null, intent = null, paymentRejected = false;
  try {
    const st = await paymentStatusFor(req.account.id);
    if (st.pending) pending = { referenceCode: st.pending.referenceCode, plan: st.pending.plan, billingPeriod: st.pending.billingPeriod, createdAt: st.pending.createdAt };
    if (st.intent) intent = { intentId: st.intent.id, referenceCode: st.intent.referenceCode, plan: st.intent.plan,
      billingPeriod: st.intent.billingPeriod, amountEGP: st.intent.amountEGP, baseEGP: st.intent.baseEGP,
      offerApplied: !!st.intent.offerApplied, createdAt: st.intent.createdAt };
    paymentRejected = st.lastRejected;
  } catch (e) { console.error('[billing] status payment lookup failed:', e.message); }

  res.json({
    account:    publicAccount(req.account),
    // The paid plans straight from plans.config.js (EGP prices + daily minutes — ONE source).
    // Each plan also carries its discounted price while the launch offer is live, and `offer`
    // tells the client whether to show the deal — so the client never hardcodes the discount and
    // the ad can't outlive the actual price (offer flips off automatically after endsAt).
    plans: [PLANS.basic, PLANS.elite].map((pl) => ({
      ...pl,
      offerPriceEGP:  offerPrice(pl.priceEGP),
      offerYearlyEGP: pl.yearlyEGP != null ? offerPrice(pl.yearlyEGP) : null,
    })),
    offer: offerActive()
      ? { active: true, pct: OFFER.pct, endsAt: OFFER.endsAt, label: OFFER.label }
      : { active: false },
    // Manual payment details — ONLY from env (never hardcoded). Each is null/hidden if unset.
    vodafoneNumber: process.env.VODAFONE_CASH_NUMBER || null,
    instapayAddress: process.env.INSTAPAY_ADDRESS || null,
    bankInfo:       process.env.BANK_ACCOUNT_INFO || null,
    // WhatsApp for payment proof: falls back to the Vodafone Cash number — in Egypt that IS the
    // owner's published phone number, so the proof lands where the money does. Set WHATSAPP_NUMBER
    // explicitly to receive WhatsApp on a different number.
    whatsappNumber: process.env.WHATSAPP_NUMBER || process.env.VODAFONE_CASH_NUMBER || null,
    pendingPayment: pending,    // { referenceCode, plan, billingPeriod, createdAt } | null
    paymentIntent: intent,      // resumable transfer instructions created before money moves
    paymentRejected,            // true if their latest payment was rejected (→ normal paywall + note)
  });
});

// Lightweight live state for the HOME screen: daily minutes left, pending payment, and a
// one-time "just activated" flag. All server-side truth.
billingRouter.get('/state', requireAuth, async (req, res) => {
  const account = req.account;
  const plan    = planOf(account);
  const minutes = dailyMinutesFor(account);

  let usedSec = 0, targetIndustry = null;
  try {
    const p = await loadUser(account.id);
    if (p.liveUsage?.day === dayKey()) usedSec = p.liveUsage.sec || 0;
    targetIndustry = p.targetIndustry || null;   // Ziel-Stelle: current pick for the home Optionen panel
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
    whatsappNumber: process.env.WHATSAPP_NUMBER || process.env.VODAFONE_CASH_NUMBER || null,
    // Ziel-Stelle: entitlement flag + the stored pick, so the home Optionen panel renders honestly
    // (flag false ⇒ the picker labels itself "ab Elite" — stored aspiration, not yet active).
    zielStelle: entitlement(account).zielStelle,
    targetIndustry,
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
  if (!isAdminAccount(req.account)) return res.status(403).json({ error: 'forbidden' });
  try {
    const body = req.body || {};
    // Accept {plan} (new) or {tier} (legacy 'pro'/'team' → elite); default elite.
    let plan = body.plan;
    if (!plan) plan = (body.tier === 'team' || body.tier === 'pro') ? 'elite' : 'elite';
    const target = await getAccountByEmail(body.email);
    if (!target) return res.status(404).json({ error: 'user_not_found' });
    await setPlan(target, plan);
    console.log(`[billing] ADMIN SET PLAN plan=${plan} target=${target.id} actor=${req.account.id}`);
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
