const STUDY_KEY = '21d';
const MAX_INVITE_LENGTH = 2048;

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
  const entry = readStudyCohortEntry(locationLike);
  if (!entry) return null;
  const cleanPath = stripStudyCohortParams(locationLike);
  try {
    if (typeof replace === 'function') replace(cleanPath);
    else globalThis.history?.replaceState?.(null, '', cleanPath);
  } catch { /* privacy cleanup is best-effort; validation still fails closed */ }
  return entry;
}

export async function verifyStudyCohortEntry(apiUrl, invite, { signal } = {}) {
  const response = await fetch(`${apiUrl}/api/study-cohort/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite }),
    signal,
  });
  if (!response.ok) return Object.freeze({ valid: false });
  const body = await response.json().catch(() => ({}));
  if (body?.valid !== true || body?.cohort !== '21-day-study' || body?.days !== 21) {
    return Object.freeze({ valid: false });
  }
  return Object.freeze({ valid: true, days: 21 });
}
