const STUDY_KEY = '21d';
const MAX_INVITE_LENGTH = 2048;
// A cohort invite is a short-lived bearer capability. Keep it in sessionStorage only long
// enough to survive a reload in the same browser tab; it is never written to localStorage,
// URLs, analytics, or the authenticated account response.
const SESSION_ENTRY_KEY = 'bpo_study_cohort_entry_v1';

function safeSessionStorage(storage = globalThis.sessionStorage) {
  try {
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

function validEntry(value) {
  if (!value || typeof value !== 'object' || value.study !== STUDY_KEY) return null;
  const invite = typeof value.invite === 'string' ? value.invite : '';
  return invite && invite.length <= MAX_INVITE_LENGTH ? Object.freeze({ study:STUDY_KEY, invite }) : null;
}

export function readStudyCohortEntry(locationLike = globalThis.location) {
  try {
    const url = new URL(locationLike.href || String(locationLike));
    const fragment = url.hash.startsWith('#') ? new URLSearchParams(url.hash.slice(1)) : new URLSearchParams();
    // Bearer capabilities are fragment-only. Query parameters reach the hosting edge before this
    // code runs and can enter request logs/referrers, so a query-shaped invite must fail closed.
    const invite = fragment.get('invite') || '';
    if (fragment.get('study') !== STUDY_KEY || !invite || invite.length > MAX_INVITE_LENGTH) return null;
    return Object.freeze({ study: STUDY_KEY, invite });
  } catch {
    return null;
  }
}

export function readStoredStudyCohortEntry(storage = globalThis.sessionStorage) {
  try {
    const raw = safeSessionStorage(storage)?.getItem(SESSION_ENTRY_KEY);
    return raw ? validEntry(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function rememberStudyCohortEntry(entry, storage = globalThis.sessionStorage) {
  const safe = validEntry(entry);
  if (!safe) return null;
  try { safeSessionStorage(storage)?.setItem(SESSION_ENTRY_KEY, JSON.stringify(safe)); } catch { /* optional */ }
  return safe;
}

export function forgetStudyCohortEntry(storage = globalThis.sessionStorage) {
  try { safeSessionStorage(storage)?.removeItem(SESSION_ENTRY_KEY); } catch { /* optional */ }
}

export function buildStudyBrowserHandoffUrl(locationLike, invite) {
  const url = new URL(locationLike.href || String(locationLike));
  const clean = new URL(url.pathname || '/', url.origin);
  clean.hash = new URLSearchParams({
    study:STUDY_KEY,
    invite:String(invite || '').slice(0, MAX_INVITE_LENGTH),
  }).toString();
  return clean.toString();
}

export function stripStudyCohortParams(locationLike = globalThis.location) {
  try {
    const url = new URL(locationLike.href || String(locationLike));
    url.searchParams.delete('study');
    url.searchParams.delete('invite');
    if (url.hash.startsWith('#')) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      if (fragment.has('study') || fragment.has('invite')) {
        fragment.delete('study');
        fragment.delete('invite');
        const remaining = fragment.toString();
        url.hash = remaining ? `#${remaining}` : '';
      }
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function captureStudyCohortEntry(locationLike = globalThis.location, replace = null) {
  const fromFragment = readStudyCohortEntry(locationLike);
  if (fromFragment) {
    const entry = rememberStudyCohortEntry(fromFragment);
    const cleanPath = stripStudyCohortParams(locationLike);
    try {
      if (typeof replace === 'function') replace(cleanPath);
      else globalThis.history?.replaceState?.(null, '', cleanPath);
    } catch { /* privacy cleanup is best-effort; validation still fails closed */ }
    return entry;
  }
  return readStoredStudyCohortEntry();
}

export async function verifyStudyCohortEntry(apiUrl, invite, { signal, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener?.('abort', onAbort, { once:true });
  const timer = setTimeout(() => controller.abort(), Math.max(100, Math.min(30000, Number(timeoutMs) || 12000)));
  let response;
  try {
    response = await fetch(`${apiUrl}/api/study-cohort/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite }),
      signal:controller.signal,
    });
  } catch {
    return Object.freeze({ valid:false, state:'offline' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
  if (!response.ok) return Object.freeze({ valid: false, state:'offline' });
  const body = await response.json().catch(() => ({}));
  if (body?.valid !== true || body?.cohort !== '21-day-study' || body?.days !== 21) {
    const state = ['invalid', 'expired', 'used', 'unavailable'].includes(body?.state) ? body.state : 'invalid';
    return Object.freeze({ valid: false, state });
  }
  return Object.freeze({ valid: true, days: 21, state:'ready' });
}
