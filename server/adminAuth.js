import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const COOKIE = 'omni_admin_session';
const TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  try { return timingSafeEqual(left, right); } catch { return false; }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

function sessionHash(raw) {
  return createHash('sha256').update(String(raw)).digest('base64url');
}

export function adminCredentialOk(candidate) {
  const expected = process.env.ADMIN_KEY || '';
  return !!expected && safeEqual(candidate, expected);
}

export function paymentMonitorCredentialOk(candidate) {
  const expected = process.env.PAYMENT_MONITOR_KEY || '';
  return !!expected && safeEqual(candidate, expected);
}

export function issueAdminSession(res) {
  const raw = randomBytes(32).toString('base64url');
  sessions.set(sessionHash(raw), Date.now() + TTL_MS);
  const secure = process.env.NODE_ENV === 'production' || !!process.env.RENDER ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(raw)}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${TTL_MS / 1000}`);
  return raw;
}

export function clearAdminSession(req, res) {
  const raw = cookies(req)[COOKIE];
  if (raw) sessions.delete(sessionHash(raw));
  const secure = process.env.NODE_ENV === 'production' || !!process.env.RENDER ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`);
}

export function adminRequestOk(req) {
  // Automation may use the secret in a header. Never accept it in a URL or JSON body.
  if (adminCredentialOk(req.headers['x-admin-key'])) return true;
  const raw = cookies(req)[COOKIE];
  if (!raw) return false;
  const key = sessionHash(raw);
  const exp = sessions.get(key) || 0;
  if (exp <= Date.now()) { sessions.delete(key); return false; }
  sessions.set(key, Date.now() + TTL_MS); // sliding owner session
  if (sessions.size > 100) {
    const now = Date.now();
    for (const [id, until] of sessions) if (until <= now) sessions.delete(id);
  }
  return true;
}

export function requireAdmin(req, res, next) {
  if (!adminRequestOk(req)) return res.status(403).json({ error: 'forbidden' });
  next();
}
