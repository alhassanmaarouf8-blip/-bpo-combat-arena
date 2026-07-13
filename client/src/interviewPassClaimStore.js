export const INTERVIEW_PASS_CLAIM_KEY = 'omni_interview_pass_claim';

const CLAIMED_KEY_PREFIX = 'omni_interview_pass_claimed:';
const MAX_TOKEN_LENGTH = 6_000;

function browserStorage(name) {
  try { return globalThis?.[name] || null; } catch { return null; }
}

function remove(storage, key) {
  try { storage?.removeItem?.(key); } catch { /* storage is optional */ }
}

function normalizedEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : '';
}

function parsePending(raw, now) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw);
    const previewToken = typeof value?.previewToken === 'string' ? value.previewToken.trim() : '';
    const expiresAt = typeof value?.expiresAt === 'string' ? value.expiresAt : '';
    const expiresAtMs = Date.parse(expiresAt);
    if (!previewToken || previewToken.length > MAX_TOKEN_LENGTH || !Number.isFinite(expiresAtMs) || expiresAtMs <= now) return null;
    const intendedEmail = normalizedEmail(value?.intendedEmail);
    return {
      previewToken,
      expiresAt:new Date(expiresAtMs).toISOString(),
      ...(intendedEmail ? { intendedEmail } : {}),
    };
  } catch { return null; }
}

function storages(options = {}) {
  return {
    local: options.localStorage ?? browserStorage('localStorage'),
    session: options.sessionStorage ?? browserStorage('sessionStorage'),
  };
}

export function clearPendingInterviewPassClaim(options = {}) {
  const { local, session } = storages(options);
  remove(local, INTERVIEW_PASS_CLAIM_KEY);
  remove(session, INTERVIEW_PASS_CLAIM_KEY);
}

export function writePendingInterviewPassClaim(value, options = {}) {
  const now = Number(options.now) || Date.now();
  const pending = parsePending(JSON.stringify(value || {}), now);
  if (!pending) {
    clearPendingInterviewPassClaim(options);
    return false;
  }
  const { local, session } = storages(options);
  const encoded = JSON.stringify({ version:1, ...pending });
  try {
    if (typeof local?.setItem !== 'function') throw new Error('local_storage_unavailable');
    local.setItem(INTERVIEW_PASS_CLAIM_KEY, encoded);
    remove(session, INTERVIEW_PASS_CLAIM_KEY);
    return true;
  } catch {
    try {
      if (typeof session?.setItem !== 'function') return false;
      session.setItem(INTERVIEW_PASS_CLAIM_KEY, encoded);
      return true;
    } catch { return false; }
  }
}

// Bind the opaque preview to the account the visitor actually creates. The token is first written
// before the signup form is filled, so this second step is deliberately explicit and happens only
// after a successful signup response. It keeps email-verification links working across tabs without
// letting a later, unrelated login silently consume somebody else's pending pass.
export function bindPendingInterviewPassClaimToEmail(email, options = {}) {
  const intendedEmail = normalizedEmail(email);
  if (!intendedEmail) return false;
  const pending = readPendingInterviewPassClaim(options);
  if (!pending) return false;
  if (pending.intendedEmail && pending.intendedEmail !== intendedEmail) return false;
  return writePendingInterviewPassClaim({ ...pending, intendedEmail }, options);
}

export function readPendingInterviewPassClaim(options = {}) {
  const now = Number(options.now) || Date.now();
  const { local, session } = storages(options);
  let localRaw = null;
  let sessionRaw = null;
  try { localRaw = local?.getItem?.(INTERVIEW_PASS_CLAIM_KEY) || null; } catch { /* optional */ }
  const localPending = parsePending(localRaw, now);
  if (localPending) {
    if (Object.prototype.hasOwnProperty.call(options, 'accountEmail')) {
      const accountEmail = normalizedEmail(options.accountEmail);
      return accountEmail && localPending.intendedEmail === accountEmail ? localPending : null;
    }
    return localPending;
  }
  if (localRaw) remove(local, INTERVIEW_PASS_CLAIM_KEY);

  // Migrate the earlier session-only handoff. New writes use localStorage so an email
  // verification link opened in another tab can still finish the opaque one-use claim.
  try { sessionRaw = session?.getItem?.(INTERVIEW_PASS_CLAIM_KEY) || null; } catch { /* optional */ }
  const sessionPending = parsePending(sessionRaw, now);
  if (!sessionPending) {
    if (sessionRaw) remove(session, INTERVIEW_PASS_CLAIM_KEY);
    return null;
  }
  writePendingInterviewPassClaim(sessionPending, { ...options, localStorage:local, sessionStorage:session, now });
  if (Object.prototype.hasOwnProperty.call(options, 'accountEmail')) {
    const accountEmail = normalizedEmail(options.accountEmail);
    return accountEmail && sessionPending.intendedEmail === accountEmail ? sessionPending : null;
  }
  return sessionPending;
}

function claimedKey(accountId) {
  const safe = typeof accountId === 'string' ? accountId.trim() : '';
  return safe && /^[a-zA-Z0-9_-]{1,160}$/u.test(safe) ? `${CLAIMED_KEY_PREFIX}${safe}` : '';
}

export function markInterviewPassClaimed(accountId, options = {}) {
  const key = claimedKey(accountId);
  if (!key) return false;
  const { local } = storages(options);
  try {
    if (typeof local?.setItem !== 'function') return false;
    local.setItem(key, '1');
    return true;
  } catch { return false; }
}

export function wasInterviewPassClaimed(accountId, options = {}) {
  const key = claimedKey(accountId);
  if (!key) return false;
  const { local } = storages(options);
  try { return local?.getItem?.(key) === '1'; } catch { return false; }
}
