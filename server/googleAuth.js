/**
 * googleAuth.js — verify a Google Sign-In ID token, with NO new dependency.
 *
 * WHY THIS EXISTS (measured, 2026-07-24): of the 11 real people who have ever signed up, SIX have
 * `activeDays: 0` and `lastActive: null` — they created an account and never came back. That is the
 * signature of the hard e-mail-verification gate (auth.js `emailVerificationRequired: true`): a
 * phone user arriving from a Facebook/WhatsApp link must LEAVE the app, find an e-mail, click a
 * link, and return. Most never do. Every reference app checked (Headspace, Speak) offers social
 * sign-in and has no verification wall at all.
 *
 * A Google identity arrives ALREADY PROVEN, so the gate does not need weakening — it disappears for
 * this path while e-mail+password keeps verification exactly as it is today.
 *
 * NO DEPENDENCY: server/package.json has only cors, dotenv, express, nodemailer, pg, ws — and the
 * zero-spend/no-new-deps rule stands. Rather than pull in google-auth-library (which would verify
 * the JWT locally against Google's JWKS), this calls Google's own tokeninfo endpoint with the
 * built-in fetch. Google does the crypto; we still re-check every claim that matters below, because
 * "the endpoint returned 200" is NOT the same as "this token is for us".
 *
 * Trade-off, stated honestly: one outbound HTTPS call per sign-in (~100-200ms) instead of local
 * signature verification. At this scale that is irrelevant, and it keeps the dependency count at
 * zero. If sign-in volume ever makes it matter, swap in local JWKS verification behind this same
 * function — the contract below does not change.
 */

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';
// Google mints tokens with either issuer spelling; both are legitimate.
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export function googleAuthConfigured() {
  return !!String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

/**
 * Verify an ID token and return { email } — or throw. Never returns a partially-trusted result:
 * either every check below passed, or this throws.
 */
export async function verifyGoogleIdToken(idToken) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) throw Object.assign(new Error('google_not_configured'), { code: 503 });

  const raw = String(idToken || '').trim();
  // A Google ID token is a JWT: three dot-separated segments. Reject obvious junk before spending a
  // network round-trip on it (and before putting attacker-controlled text in a URL).
  if (!raw || raw.length > 4096 || raw.split('.').length !== 3) {
    throw Object.assign(new Error('invalid_google_token'), { code: 400 });
  }

  let payload;
  try {
    const res = await fetch(`${TOKENINFO}?id_token=${encodeURIComponent(raw)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    // Google returns 400 for any token it will not vouch for (bad signature, expired, malformed).
    if (!res.ok) throw Object.assign(new Error('invalid_google_token'), { code: 401 });
    payload = await res.json();
  } catch (err) {
    if (err.code) throw err;
    // Network/timeout — this is OUR outage, not the user's bad token. Say so with a 503 so the
    // client can offer e-mail sign-in instead of accusing the user of a bad login.
    console.error('[google-auth] tokeninfo unreachable:', err.message);
    throw Object.assign(new Error('google_unreachable'), { code: 503 });
  }

  // ── The checks that actually matter. A 200 from tokeninfo only proves the token is a VALID
  // GOOGLE TOKEN — not that it was minted for this app. Without the aud check below, an ID token
  // issued to ANY other Google app would log its bearer in here. This is the whole ballgame.
  if (payload.aud !== clientId) {
    throw Object.assign(new Error('google_token_audience_mismatch'), { code: 401 });
  }
  if (!VALID_ISSUERS.has(String(payload.iss || ''))) {
    throw Object.assign(new Error('google_token_issuer_invalid'), { code: 401 });
  }
  // tokeninfo rejects expired tokens, but check locally too rather than trusting one gate.
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw Object.assign(new Error('google_token_expired'), { code: 401 });
  }
  // The entire premise of this path is that the address is ALREADY PROVEN. Google returns this as
  // the string 'true' or a boolean depending on the endpoint. If it is not verified, this token
  // buys nothing that e-mail+password does not already do — refuse and let them use that path.
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (!emailVerified) {
    throw Object.assign(new Error('google_email_unverified'), { code: 401 });
  }
  const email = String(payload.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw Object.assign(new Error('google_email_missing'), { code: 401 });
  }

  return { email, sub: String(payload.sub || '') };
}

export default { googleAuthConfigured, verifyGoogleIdToken };
