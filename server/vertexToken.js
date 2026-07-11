/**
 * vertexToken.js — OAuth2 access tokens for Vertex AI, zero new dependencies.
 *
 * Why: Gemini through VERTEX AI bills the GCP project (= the owner's $300 free-trial
 * credit) instead of the AI Studio API key path (= his card). Vertex takes no API key —
 * it takes a Bearer token minted from a service-account key (Render: secret file +
 * GOOGLE_APPLICATION_CREDENTIALS, or the key JSON inline in GOOGLE_SA_KEY_JSON).
 *
 * Same pattern as push.js (self-provisioned crypto, no google-auth-library): sign an
 * RS256 JWT with the service account's private key, exchange it at Google's token
 * endpoint, cache until shortly before expiry (tokens live 1h; a token is only read at
 * session open, so a 5-min early refresh can never hand out a token that dies mid-mint).
 *
 * GEMINI_VERTEX_TOKEN (dev/test only): inject a token directly, e.g.
 *   GEMINI_VERTEX_TOKEN=$(gcloud auth print-access-token) — bypasses the key file.
 */

import { createSign } from 'crypto';
import { readFileSync } from 'fs';

let cached = { token: null, exp: 0 };

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SA_KEY_JSON
    || (process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
        : null);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** True when the operator has switched Gemini Live to Vertex AND credentials exist. */
export function vertexConfigured() {
  return process.env.GEMINI_USE_VERTEX === '1'
    && !!(process.env.GEMINI_VERTEX_TOKEN
       || process.env.GOOGLE_SA_KEY_JSON
       || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export async function getVertexAccessToken() {
  if (process.env.GEMINI_VERTEX_TOKEN) return process.env.GEMINI_VERTEX_TOKEN;

  const now = Math.floor(Date.now() / 1000);
  if (cached.token && now < cached.exp - 300) return cached.token;

  const sa = loadServiceAccount();
  if (!sa) {
    throw new Error('vertexToken: no usable credentials (set GOOGLE_SA_KEY_JSON or GOOGLE_APPLICATION_CREDENTIALS)');
  }

  // authorized_user (gcloud ADC file) support: refresh-token grant instead of a signed JWT.
  // Lets the owner's own gcloud credentials run Render until a real service account exists.
  // NOTE: user creds carry OWNER-level project access — a scoped service account is the
  // better long-term key; swap when one exists (revoke: myaccount.google.com/permissions).
  if (sa.type === 'authorized_user' || (sa.refresh_token && !sa.private_key)) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: sa.client_id,
        client_secret: sa.client_secret,
        refresh_token: sa.refresh_token,
      }),
    });
    if (!res.ok) {
      throw new Error(`vertexToken: refresh-token exchange failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const j = await res.json();
    cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
    return cached.token;
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error('vertexToken: credentials file is neither a service-account key nor an authorized_user file');
  }

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`vertexToken: token exchange failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = await res.json();
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}

export default { vertexConfigured, getVertexAccessToken };
