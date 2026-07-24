/**
 * googleAuth.test.mjs — the signup-wall fix.
 *
 * WHY THIS PATH EXISTS: measured 2026-07-24, of 11 real accounts SIX had activeDays:0 and
 * lastActive:null — signed up, never returned. That is the e-mail-verification round trip killing
 * phone users who arrive from a Facebook/WhatsApp link. A Google identity is already proven, so
 * this path removes the wall for those users instead of weakening it for everyone.
 *
 * What is locked here, in priority order:
 *   1. AUDIENCE. A 200 from Google's tokeninfo only proves the token is a valid GOOGLE token — not
 *      that it was minted for THIS app. Without the `aud` check, an ID token issued to any other
 *      Google application would log its bearer straight in. This is the whole ballgame.
 *   2. DARK BY DEFAULT. No GOOGLE_CLIENT_ID → the route refuses and the client never shows a button.
 *   3. PASSWORD LOGIN CANNOT BE BYPASSED. Google accounts store passwordHash:null; that must never
 *      authenticate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';
delete process.env.GOOGLE_CLIENT_ID;   // prove the DEFAULT, not a leaked env

const { googleAuthConfigured, verifyGoogleIdToken } = await import('./googleAuth.js');

test('dark by default — without GOOGLE_CLIENT_ID nothing is offered and nothing verifies', async () => {
  assert.equal(googleAuthConfigured(), false);
  await assert.rejects(() => verifyGoogleIdToken('a.b.c'), (e) => e.code === 503);
});

test('obvious junk is rejected before any network round-trip', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not be reached'); };
  try {
    for (const bad of ['', '   ', 'not-a-jwt', 'only.two', 'a.b.c.d', 'x'.repeat(5000)]) {
      await assert.rejects(() => verifyGoogleIdToken(bad), (e) => e.code === 400,
        `"${String(bad).slice(0, 20)}" must be refused locally`);
    }
    assert.equal(called, false, 'malformed tokens must never reach Google (or our URL builder)');
  } finally { globalThis.fetch = originalFetch; delete process.env.GOOGLE_CLIENT_ID; }
});

test('THE SECURITY TEST: a valid Google token minted for a DIFFERENT app is refused', async () => {
  process.env.GOOGLE_CLIENT_ID = 'our-app.apps.googleusercontent.com';
  const originalFetch = globalThis.fetch;
  // Google says 200 — the token is genuinely valid. It just is not OURS.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    aud: 'SOME-OTHER-APP.apps.googleusercontent.com',
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'attacker@gmail.com',
    email_verified: true,
  }) });
  try {
    await assert.rejects(() => verifyGoogleIdToken('a.b.c'),
      (e) => e.message === 'google_token_audience_mismatch' && e.code === 401,
      'a token for another Google app MUST NOT sign anyone in');
  } finally { globalThis.fetch = originalFetch; delete process.env.GOOGLE_CLIENT_ID; }
});

test('every other claim is checked, not just the audience', async () => {
  process.env.GOOGLE_CLIENT_ID = 'our-app.apps.googleusercontent.com';
  const originalFetch = globalThis.fetch;
  const base = {
    aud: 'our-app.apps.googleusercontent.com',
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'real@gmail.com',
    email_verified: true,
  };
  const cases = [
    [{ iss: 'evil.example.com' }, 'google_token_issuer_invalid'],
    [{ exp: Math.floor(Date.now() / 1000) - 60 }, 'google_token_expired'],
    // The ENTIRE premise is that the address is already proven. Unverified buys nothing.
    [{ email_verified: false }, 'google_email_unverified'],
    [{ email: '' }, 'google_email_missing'],
    [{ email: 'not-an-email' }, 'google_email_missing'],
  ];
  try {
    for (const [override, expected] of cases) {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...base, ...override }) });
      await assert.rejects(() => verifyGoogleIdToken('a.b.c'), (e) => e.message === expected,
        `${JSON.stringify(override)} must fail as ${expected}`);
    }
    // Google itself refusing the token (bad signature / expired / forged) → 401, never a sign-in.
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
    await assert.rejects(() => verifyGoogleIdToken('a.b.c'), (e) => e.code === 401);
    // Google unreachable is OUR outage, not a bad login — 503 so the client can offer e-mail
    // sign-in instead of telling a legitimate user their account is wrong.
    globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
    await assert.rejects(() => verifyGoogleIdToken('a.b.c'), (e) => e.code === 503);
  } finally { globalThis.fetch = originalFetch; delete process.env.GOOGLE_CLIENT_ID; }
});

test('the happy path returns a normalised e-mail', async () => {
  process.env.GOOGLE_CLIENT_ID = 'our-app.apps.googleusercontent.com';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    aud: 'our-app.apps.googleusercontent.com',
    iss: 'accounts.google.com',          // the non-https issuer spelling is also legitimate
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: '  Real.User@GMAIL.com  ',
    email_verified: 'true',              // Google sometimes sends the string, not the boolean
    sub: '1234567890',
  }) });
  try {
    const out = await verifyGoogleIdToken('a.b.c');
    assert.equal(out.email, 'real.user@gmail.com', 'e-mail must be trimmed and lowercased to match emailIndex');
    assert.equal(out.sub, '1234567890');
  } finally { globalThis.fetch = originalFetch; delete process.env.GOOGLE_CLIENT_ID; }
});

test('a Google account can never be password-logged-into, and the wall is skipped only here', async () => {
  const source = await readFile(new URL('./auth.js', import.meta.url), 'utf8');
  // Google accounts store no password hash. verifyPassword must refuse that explicitly rather than
  // relying on a parse throwing into a catch.
  assert.match(source, /if \(typeof stored !== 'string' \|\| !stored\.includes\(':'\)\) return false;/,
    'a null/absent passwordHash must be an explicit refusal in the password path');
  assert.match(source, /passwordHash: null,\s*\/\/ Google-only identity/);
  // The wall is removed ONLY for the Google path...
  assert.match(source, /emailVerificationRequired: false,\s*\/\/ Google proved it/);
  // ...and e-mail+password signup keeps it, unchanged.
  assert.match(source, /emailVerificationRequired: true,/,
    'e-mail+password signup must still require verification');
  // Route must be flag-gated so a deploy without the env var changes nothing.
  assert.match(source, /if \(!googleAuthConfigured\(\)\) return res\.status\(503\)/);
  // Public flag is a boolean — never leak the client ID from the server payload.
  assert.match(source, /googleSignIn: googleAuthConfigured\(\)/);
  assert.doesNotMatch(source, /googleClientId:\s*process\.env\.GOOGLE_CLIENT_ID/,
    'the client ID must not be served from this endpoint');
});
