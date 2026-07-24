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
import { STUDY_COHORT_DAYS, STUDY_COHORT_ID, studyCohortConfig,
  validateStudyCohortInvite, inspectStudyCohortInvite } from './studyCohortInvite.js';

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
let _storeLockTail = Promise.resolve();
let _persistTail = Promise.resolve();

// The auth store is one aggregate document in both the JSON fallback and Postgres KV seam.
// Serialize check-then-write operations inside this process so uniqueness and session-version
// decisions cannot interleave across await points. Render currently runs one app process; this
// lock deliberately matches that storage model rather than pretending the aggregate KV row has
// database-level per-email constraints that it does not have.
async function withStoreLock(operation) {
  const previous = _storeLockTail;
  let release;
  _storeLockTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); }
  finally { release(); }
}

async function load() {
  if (_store) return _store;
  if (dbEnabled()) {
    _store = (await kvGet('auth', 'store')) ?? { accounts: {}, emailIndex: {} };
  } else {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    try { _store = JSON.parse(await readFile(ACCT_FILE, 'utf8')); }
    catch { _store = { accounts: {}, emailIndex: {} }; }
  }
  // A truncated or half-written store file can parse to a NON-OBJECT without throwing —
  // JSON.parse('null') returns null, and JSON.parse('123')/'"x"' return primitives. The catch
  // above only covers malformed JSON, so those values used to flow straight into the property
  // writes below and crashed every authenticated route with
  // "Cannot read properties of null (reading 'accounts')". Fail safe to an empty store instead:
  // an unreadable file must never take auth down.
  if (!_store || typeof _store !== 'object' || Array.isArray(_store)) {
    _store = { accounts: {}, emailIndex: {} };
  }
  _store.accounts   ??= {};
  _store.emailIndex ??= {};
  return _store;
}
async function persist() {
  // Snapshot at the call boundary, then preserve call order. Without this queue an older async
  // write can finish after a newer one and roll durable state back while memory still looks right.
  const snapshot = JSON.stringify(_store);
  const operation = _persistTail.then(async () => {
    if (dbEnabled()) { await kvSet('auth', 'store', JSON.parse(snapshot)); return; }
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ACCT_FILE, JSON.stringify(JSON.parse(snapshot), null, 2), 'utf8');
  });
  _persistTail = operation.catch(() => {});
  return operation;
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
  const passwordHash = await hashPassword(newPassword);
  return withStoreLock(async () => {
    const acc = await getAccountByEmail(email);
    if (!acc) return null;
    acc.passwordHash = passwordHash;
    acc.sessionVersion = (acc.sessionVersion || 0) + 1;
    delete acc.resetToken;   // an outstanding emailed reset link must die with a support reset
    await persist();
    return acc;
  });
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

function studyInviteOwner(store, inviteId, now = Date.now()) {
  if (!inviteId) return null;
  return Object.values(store?.accounts || {}).find((candidate) => {
    const record = candidate?.subscription?.studyCohort;
    if (record?.inviteId !== inviteId) return false;
    if (record.status === 'active') return true;
    return record.status === 'pending' && Number.isFinite(record.inviteExpiresAt) && record.inviteExpiresAt > now;
  }) || null;
}

function activatePendingStudyCohort(account, now = Date.now()) {
  const pending = account?.subscription?.studyCohort;
  if (!pending || pending.status !== 'pending') return false;
  if (!Number.isFinite(pending.inviteExpiresAt) || pending.inviteExpiresAt <= now) return false;
  if (pending.cohortId !== STUDY_COHORT_ID || pending.days !== STUDY_COHORT_DAYS
      || !studyCohortConfig().enabled) return false;
  account.subscription.studyCohort = {
    status: 'active',
    cohortId: STUDY_COHORT_ID,
    inviteId: pending.inviteId,
    days: STUDY_COHORT_DAYS,
    reservedAt: pending.reservedAt,
    startedAt: now,
    endsAt: now + STUDY_COHORT_DAYS * DAY,
  };
  return true;
}

export function studyCohortAccessState(account, now = Date.now()) {
  const record = account?.subscription?.studyCohort;
  if (!record || record.cohortId !== STUDY_COHORT_ID || record.days !== STUDY_COHORT_DAYS
      || !studyCohortConfig().enabled) return null;
  if (record.status === 'pending' && Number.isFinite(record.inviteExpiresAt) && record.inviteExpiresAt > now) {
    return Object.freeze({ pending: true, active: false, days: STUDY_COHORT_DAYS, daysLeft: 0 });
  }
  if (record.status === 'active' && Number.isFinite(record.startedAt) && Number.isFinite(record.endsAt)
      && record.startedAt <= now && record.endsAt > now) {
    const daysLeft = Math.max(1, Math.ceil((record.endsAt - now) / DAY));
    return Object.freeze({ pending: false, active: true, days: STUDY_COHORT_DAYS, daysLeft });
  }
  return null;
}

export async function studyCohortInviteStatus(token, now = Date.now()) {
  const inspected = inspectStudyCohortInvite(token, { now });
  if (!inspected.invite) return Object.freeze({ valid:false, state:inspected.state });
  const store = await load();
  if (studyInviteOwner(store, inspected.invite.inviteId)) return Object.freeze({ valid:false, state:'used' });
  return Object.freeze({ valid:true, state:'ready', invite:inspected.invite });
}

export async function activateAccountStudyCohort(account, token = null) {
  return withStoreLock(async () => {
    const store = await load();
    const current = account?.id ? store.accounts[account.id] : null;
    if (!current) return null;
    const now = Date.now();
    if (studyCohortAccessState(current, now)?.active) {
      if (token === null || token === undefined || token === '') return current;
      const retryInvite = validateStudyCohortInvite(token, { now });
      return retryInvite?.inviteId === current.subscription.studyCohort.inviteId ? current : null;
    }
    if (emailOwnershipVerified(current) && activatePendingStudyCohort(current, now)) {
      await persist();
      return current;
    }

    const invite = validateStudyCohortInvite(token, { now });
    if (!invite) return null;
    const owner = studyInviteOwner(store, invite.inviteId, now);
    if (owner && owner.id !== current.id) return null;
    current.subscription ||= {};
    current.subscription.studyCohort = emailOwnershipVerified(current) ? {
      status:'active', cohortId:STUDY_COHORT_ID, inviteId:invite.inviteId, days:STUDY_COHORT_DAYS,
      reservedAt:now, startedAt:now, endsAt:now + STUDY_COHORT_DAYS * DAY,
    } : {
      status:'pending', cohortId:STUDY_COHORT_ID, inviteId:invite.inviteId, days:STUDY_COHORT_DAYS,
      inviteExpiresAt:invite.expiresAt, reservedAt:now,
    };
    await persist();
    return current;
  });
}

export async function createAccount(email, password, ref, whatsapp, studyInvite = null) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('invalid_email'), { code: 400 });
  if (String(password || '').length < 10 || String(password || '').length > 128)
    throw Object.assign(new Error('weak_password'), { code: 400 });
  const suppliedStudyInvite = typeof studyInvite === 'string' && studyInvite.trim() ? studyInvite.trim() : null;
  const validatedStudyInvite = suppliedStudyInvite ? validateStudyCohortInvite(suppliedStudyInvite) : null;
  if (suppliedStudyInvite && !validatedStudyInvite)
    throw Object.assign(new Error('invalid_study_invite'), { code: 400 });

  // WhatsApp is optional and never collected by the current signup form. If an older trusted
  // caller supplies it, normalize it for the legacy `phone` field; marketing consent is still a
  // separate explicit post-value action below.
  const waNum = normalizeWhatsapp(whatsapp);
  const refId = typeof ref === 'string' ? ref.trim() : '';
  // Scrypt is intentionally outside the store lock. The uniqueness decision is repeated only
  // after hashing, inside the serialized mutation, so two parallel requests cannot both win.
  const passwordHash = await hashPassword(password);

  return withStoreLock(async () => {
    const s = await load();
    if (s.emailIndex[email]) throw Object.assign(new Error('email_taken'), { code: 409 });
    if (validatedStudyInvite && studyInviteOwner(s, validatedStudyInvite.inviteId))
      throw Object.assign(new Error('study_invite_used'), { code: 409 });
    const id = 'a_' + randomBytes(8).toString('hex');
    const now = Date.now();
    const account = {
      id, email,
      phone:        waNum || null,
      passwordHash,
      sessionVersion: 0,
      createdAt:    now,
      // New accounts must prove mailbox ownership before any authenticated product/API route can
      // consume provider capacity. Accounts created before this field existed are grandfathered by
      // emailOwnershipVerified() so this security repair does not lock out established customers.
      emailVerificationRequired: true,
      emailVerifiedAt: null,
      subscription: {
        tier: 'trial', trialStartedAt: null, trialSessionsUsed: 0,
        ...(validatedStudyInvite ? { studyCohort: {
          status: 'pending',
          cohortId: validatedStudyInvite.cohortId,
          inviteId: validatedStudyInvite.inviteId,
          days: validatedStudyInvite.days,
          inviteExpiresAt: validatedStudyInvite.expiresAt,
          reservedAt: now,
        } } : {}),
      },
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
  });
}

async function verifiedCredentialSnapshot(email, password) {
  const acct = await getAccountByEmail(email);
  if (!acct) return null;
  const snapshot = {
    id: acct.id,
    email: acct.email,
    passwordHash: acct.passwordHash,
    sessionVersion: acct.sessionVersion || 0,
  };
  if (!(await verifyPassword(password, snapshot.passwordHash))) return null;
  return snapshot;
}

function currentAccountForCredential(s, snapshot) {
  const current = s.accounts[snapshot.id];
  if (!current || s.emailIndex[snapshot.email] !== snapshot.id) return null;
  if (current.passwordHash !== snapshot.passwordHash) return null;
  if ((current.sessionVersion || 0) !== snapshot.sessionVersion) return null;
  return current;
}

export async function authenticate(email, password) {
  const snapshot = await verifiedCredentialSnapshot(email, password);
  if (!snapshot) return null;
  return withStoreLock(async () => currentAccountForCredential(await load(), snapshot));
}

// Login must sign while holding the same lock used by password/session-version mutations.
// Otherwise an old password can finish its expensive scrypt check after a reset and receive a
// fresh token carrying the reset account's NEW version.
export async function authenticateAndIssueSession(email, password) {
  const snapshot = await verifiedCredentialSnapshot(email, password);
  if (!snapshot) return null;
  return withStoreLock(async () => {
    const account = currentAccountForCredential(await load(), snapshot);
    if (!account) return null;
    if (emailOwnershipVerified(account) && activatePendingStudyCohort(account)) await persist();
    return { account, token: signToken(account) };
  });
}

// ── Plans (the single source of truth: server/plans.config.js) ───────────────
// Which plan does this account have? Admin → elite; legacy pro/team grants → elite;
// an explicit subscription.plan wins; everyone else is free.
export function planOf(account, now = Date.now()) {
  if (isAdminAccount(account)) return 'elite';
  const s = account?.subscription || {};
  // Comp access (server/compAccess.js): a standing owner grant, immune to billingPeriodEnd —
  // it never silently expires like a real payment period. Only admin removal revokes it.
  if (s.comp && s.plan && PLANS[s.plan]) return s.plan;
  if (s.plan && PLANS[s.plan]) {
    // A paid plan with a billing end-date reverts to free once it expires.
    if (s.billingPeriodEnd && now > s.billingPeriodEnd) return 'free';
    return s.plan;
  }
  if (s.tier === 'pro' || s.tier === 'team') return 'elite'; // legacy paid grants keep access
  return 'free';
}
// FREE TRIAL — the acquisition engine. New free users live the full Fokus product (daily interview
// minutes + ALL drills) for their first FREE_TRIAL_DAYS, so they FEEL the benefit before the paywall —
// not just one cold interview. Bounded per account (a few days), so cost exposure is capped. Tunable.
export const FREE_TRIAL_DAYS = 3;
const FREE_TRIAL_DAY_MS = 86400000;
export function trialActive(account, now = Date.now()) {
  if (!account || isAdminAccount(account)) return false;   // admins are already elite
  if (planOf(account, now) !== 'free') return false;                // paid users don't need the trial
  if (studyCohortAccessState(account, now)?.active) return true;
  const start = account.subscription?.trialStartedAt;
  const days = FREE_TRIAL_DAYS;
  return !!start && now >= start && (now - start) < days * FREE_TRIAL_DAY_MS;
}
export function trialDaysLeft(account, now = Date.now()) {
  const studyAccess = studyCohortAccessState(account, now);
  if (studyAccess?.active) return studyAccess.daysLeft;
  const start = account?.subscription?.trialStartedAt;
  if (!start) return 0;
  const days = FREE_TRIAL_DAYS;
  return Math.max(0, Math.ceil((days * FREE_TRIAL_DAY_MS - (now - start)) / FREE_TRIAL_DAY_MS));
}
// During the trial a free user gets the complete Elite experience promised by the
// current offer, including the same live-session allowance. Otherwise use the
// account's paid/free plan value.
export function dailyMinutesFor(account) {
  if (trialActive(account)) return PLANS.elite.dailyLiveMinutes || 0;
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
  const sessions = trial ? (PLANS.elite.dailySessions || 0) : (feat.dailySessions || 0);
  return {
    allowed:               mins > 0 || freeFight,
    freeFight,                                   // true → client shows "1 kostenloses Interview"
    tier:                  plan,
    plan,
    dailyLiveMinutes:      mins,
    dailySessions:         sessions,
    drillsUnlocked:        drillsUnlocked(account),
    // `days` = the FULL trial length, so the client can tell "day 1" from "day 2" without
    // hardcoding 3 (a literal there would silently lie the moment FREE_TRIAL_DAYS changes).
    trial:                 { active: trial, daysLeft: trial ? trialDaysLeft(account) : 0, days: FREE_TRIAL_DAYS },
    zielStelle:            !!feat.zielStelle || trial,                // Ziel-Stelle matching — trial gives the full taste
    // "Meine eigenen Fragen": armed only when the server flag is on AND the user is entitled (trial or
    // paid — same gate as drills). Drives whether the client shows the entry at all (dark by default).
    customQuestions:       (process.env.CUSTOM_QUESTIONS_ENABLED === '1') && drillsUnlocked(account),
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

// ONE trial-ending notice per account, EVER. Claim-then-send: the flag is written and persisted
// BEFORE the mail is dispatched and this returns false if it was already set, so a retry, a double
// self-trigger, or two instances racing can never mail the same person twice. Mailing a learner
// twice about the same expiry is the kind of thing that gets a sender domain reported.
// Cost of the trade: if delivery then fails, that account silently gets no notice. That is the
// correct side to fail on — a missed nudge is recoverable, a spam complaint is not.
export async function claimTrialNotice(account) {
  if (!account?.subscription) account.subscription = {};
  if (account.subscription.trialNoticeSentAt) return false;
  account.subscription.trialNoticeSentAt = Date.now();
  await persist();
  return true;
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
  return withStoreLock(async () => {
    const s = await load();
    const account = Object.values(s.accounts || {}).find((a) => a.emailVerification?.hash === hash);
    const now = Date.now();
    if (!account || !account.emailVerification || now > account.emailVerification.exp) return null;
    account.emailVerifiedAt = now;
    delete account.emailVerification;
    activatePendingStudyCohort(account, now);
    await persist();
    return account;
  });
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
  const safeSubscription = { ...(a.subscription || {}) };
  delete safeSubscription.studyCohort;
  const studyAccess = studyCohortAccessState(a);
  return { id: a.id, email: a.email, emailVerified: emailOwnershipVerified(a), subscription: safeSubscription,
    entitlement: entitlement(a), ...(studyAccess ? { studyAccess } : {}),
    isAdmin: isAdminAccount(a), whatsapp: !!a.whatsapp?.number };
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
export function rateLimit({ windowMs, max, tag, keyExtra, global = false, accountOnly = false }) {
  if (accountOnly && typeof keyExtra !== 'function') throw new Error(`rateLimit ${tag}: accountOnly requires keyExtra`);
  return (req, res, next) => {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    // keyExtra narrows the bucket below the IP (e.g. per-account for login) so strict limits can
    // coexist with CGNAT: hundreds of REAL Egyptian users share one carrier IP.
    const extra = keyExtra ? String(keyExtra(req) || '').slice(0, 160) : '';
    // Paid/provider routes need a true per-account ceiling that cannot be reset by changing proxy
    // IPs. They layer this accountOnly bucket with a broader IP/global fuse. Login/forgot retain
    // their intentional IP+email shape.
    const key = accountOnly ? `${tag}:account:${extra || 'missing'}`
      : `${tag}:${global ? 'all' : ip}${extra ? ':' + extra : ''}`;
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
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, tag: 'signup' }),
  async (req, res) => {
  try {
    const { email, password, ref, studyInvite } = req.body || {};
    const acct = await createAccount(email, password, ref, null, studyInvite);
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
  const session = await authenticateAndIssueSession(email, password);
  if (!session) return res.status(401).json({ error: 'invalid_credentials' });
  res.json({ token: session.token, account: publicAccount(session.account) });
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
  // A carrier IP can represent hundreds of Egyptian customers. Keep a generous shared-IP fuse,
  // then apply the strict limit to the high-entropy token itself so one bad link cannot be
  // hammered without blocking unrelated customers on the same mobile network.
  rateLimit({ windowMs: 15 * 60 * 1000, max: 120, tag: 'verify' }),
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, tag: 'verify-token',
              keyExtra: (req) => createHash('sha256').update(String(req.body?.token || '')).digest('hex').slice(0, 20) }),
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
const APP_URL = process.env.APP_URL || 'https://omni-perform.vercel.app';
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
  const candidate = Object.values((await load()).accounts || {}).find((a) => a.resetToken?.hash === h);
  if (!candidate || !candidate.resetToken || Date.now() > candidate.resetToken.exp) {
    return res.status(400).json({ error: 'invalid_or_expired' });
  }
  const passwordHash = await hashPassword(password);
  const session = await withStoreLock(async () => {
    // Re-check after scrypt while holding the mutation lock. This makes the reset token genuinely
    // single-use even when two reset requests arrive together.
    const s = await load();
    const acc = Object.values(s.accounts || {}).find((a) => a.resetToken?.hash === h);
    if (!acc || !acc.resetToken || Date.now() > acc.resetToken.exp) return null;
    acc.passwordHash = passwordHash;
    acc.sessionVersion = (acc.sessionVersion || 0) + 1;
    delete acc.resetToken;               // single-use — the link dies with the change
    // A valid reset link reached this mailbox, so it is also valid ownership proof.
    if (acc.emailVerificationRequired === true && !emailOwnershipVerified(acc)) {
      acc.emailVerifiedAt = Date.now();
      delete acc.emailVerification;
    }
    await persist();
    return { account: acc, token: signToken(acc) };
  });
  if (!session) return res.status(400).json({ error: 'invalid_or_expired' });
  console.log(`[reset] password reset via email link user=${session.account.id}`);
  res.json({ token: session.token, account: publicAccount(session.account) });   // straight back in
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
    paymentAvailable: !!process.env.VODAFONE_CASH_NUMBER,
    // Paymob card + wallet checkout available (env-only check, no import → no circular dep).
    cardPayment: process.env.PAYMOB_ENABLED === '1' && !!process.env.PAYMOB_SECRET_KEY
      && !!process.env.PAYMOB_PUBLIC_KEY && !!process.env.PAYMOB_HMAC,
    pendingPayment: pending,    // { referenceCode, plan, billingPeriod, createdAt } | null
    paymentIntent: intent,      // resumable transfer instructions created before money moves
    paymentRejected,            // true if their latest payment was rejected (→ normal paywall + note)
  });
});

// PUBLIC pricing — so the LANDING PAGE can state the offer BEFORE signup.
// Why this exists: the measured leak recorded at App.jsx "THE OFFER AT THE PEAK" (elite-marketer
// teardown 2026-07-10) — only 8 of ~120 openers ever SAW a price, because price lived behind
// signup + e-mail verification + the paywall. Owner decision 2026-07-24: state it publicly.
// This changes DISPLAY ONLY — no billing logic, no entitlement, nobody pays earlier.
//
// No auth, no account lookup, no PII, zero I/O (plans.config.js values are module constants), so
// it is as cheap as /health and safe to cache. Fields are EXPLICITLY PROJECTED — never `...pl` the
// way /status does above: that route is authed, this one is anonymous, so internal plan shape
// (callFloor, trackedApplications, jobRadarDaily, vacancy*) must not leak.
billingRouter.get('/pricing', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');   // 5 min — public marketing data, cheap to cache
  try {
    res.json({
      available: true,   // fail-closed contract: the client renders a price ONLY when this is true
      plans: [PLANS.basic, PLANS.elite].map((pl) => ({
        id:             pl.id,
        label:          pl.label,
        priceEGP:       pl.priceEGP,
        yearlyEGP:      pl.yearlyEGP ?? null,
        dailySessions:  pl.dailySessions,
        sessionMinutes: pl.sessionMinutes,
        // offerPrice() returns the ORIGINAL price when no offer is live, so the landing shows the
        // discount automatically the moment OFFER flips on — and can never advertise a stale one.
        offerPriceEGP:  offerPrice(pl.priceEGP),
        offerYearlyEGP: pl.yearlyEGP != null ? offerPrice(pl.yearlyEGP) : null,
      })),
      offer: offerActive()
        ? { active: true, pct: OFFER.pct, endsAt: OFFER.endsAt, label: OFFER.label }
        : { active: false },
      // What the trial ACTUALLY grants — from the same constants dailyMinutesFor()/entitlement() use
      // above, so the landing can never repeat the old "3 Tage Basic" line while the code hands a
      // trial user Elite-level dailySessions (4/day, not Basic's 2), all drills, and Ziel-Stelle.
      trial: {
        days:             FREE_TRIAL_DAYS,
        dailySessions:    PLANS.elite.dailySessions || 0,
        dailyLiveMinutes: PLANS.elite.dailyLiveMinutes || 0,
        drills:           true,
        zielStelle:       true,
      },
      free: { assessments: PLANS.free.assessments, freeInterviews: 1 },
    });
  } catch (err) {
    console.error('[billing] public pricing error:', err.message);
    res.json({ available: false });   // never break the landing page over this
  }
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
    account: publicAccount(account),
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
    customQuestions: entitlement(account).customQuestions,   // "Meine eigenen Fragen" armed + entitled
    // Paymob card + wallet checkout available → client shows "Mit Karte/Wallet zahlen". Env-only check
    // (no import of paymob.js) to avoid a circular dependency; mirrors paymobEnabled()'s core.
    cardPayment: process.env.PAYMOB_ENABLED === '1' && !!process.env.PAYMOB_SECRET_KEY
      && !!process.env.PAYMOB_PUBLIC_KEY && !!process.env.PAYMOB_HMAC,
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
