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
const TRIAL_SESSIONS = 1;   // one free trial fight, then upgrade required
const TRIAL_DAYS     = 7;

export const TIERS = {
  trial: { id: 'trial', label: 'Testphase', priceEur: 0,  blurb: `${TRIAL_SESSIONS} Gratis-Sitzung${TRIAL_SESSIONS === 1 ? '' : 'en'} zum Ausprobieren` },
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
async function getAccountByEmail(email) {
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

// ── Subscription / entitlement ───────────────────────────────────────────────
export function entitlement(account) {
  const s = account?.subscription || {};
  if (s.tier === 'pro' || s.tier === 'team') {
    return { allowed: true, tier: s.tier, unlimited: true };
  }
  const used         = s.trialSessionsUsed || 0;
  const sessionsLeft = Math.max(0, TRIAL_SESSIONS - used);
  const daysLeft     = Math.max(0, TRIAL_DAYS - Math.floor((Date.now() - (s.trialStartedAt || Date.now())) / DAY));
  return {
    allowed: sessionsLeft > 0 && daysLeft > 0,
    tier: 'trial', sessionsLeft, daysLeft, trialSessions: TRIAL_SESSIONS,
  };
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

billingRouter.get('/status', requireAuth, (req, res) =>
  res.json({ tiers: TIERS, account: publicAccount(req.account) }));

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
