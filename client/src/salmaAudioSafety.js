/*
 * Small client-only interlock for Salma's tutor audio.
 *
 * This does not acquire a microphone or alter any voice/transport parameters. It only owns the
 * stop handles that the existing audio primitives already return, so tutor speech cannot survive
 * navigation, start over a drill/capture, or continue in a hidden document.
 */
let activeTutorLease = null;
const independentPlaybackLeases = new Set();

export function stopTutorPlayback() {
  const lease = activeTutorLease;
  activeTutorLease = null;
  try { lease?.stop?.(); } catch { /* audio cleanup is best-effort */ }
}

export function beginIndependentPlayback() {
  stopTutorPlayback();
  const lease = {};
  independentPlaybackLeases.add(lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    independentPlaybackLeases.delete(lease);
  };
}

export function claimTutorPlayback() {
  // A drill benchmark/caller line already in progress outranks optional tutor narration.
  if (independentPlaybackLeases.size) return null;
  stopTutorPlayback();
  const lease = { stop: null };
  activeTutorLease = lease;
  let released = false;
  return {
    attach(stop) { if (!released) lease.stop = typeof stop === 'function' ? stop : null; },
    release() {
      if (released) return;
      released = true;
      if (activeTutorLease === lease) activeTutorLease = null;
    },
    stop() {
      if (released) return;
      released = true;
      if (activeTutorLease === lease) activeTutorLease = null;
      try { lease.stop?.(); } catch { /* audio cleanup is best-effort */ }
    },
  };
}

export function stopTutorWhenDocumentHidden(doc = typeof document === 'undefined' ? null : document) {
  if (!doc?.addEventListener) return () => {};
  const onVisibility = () => { if (doc.visibilityState === 'hidden') stopTutorPlayback(); };
  doc.addEventListener('visibilitychange', onVisibility);
  return () => doc.removeEventListener('visibilitychange', onVisibility);
}

function accountScopeFromToken(token) {
  const raw = String(token || '');
  try {
    const encoded = raw.split('.')[0];
    if (!encoded) return 'signed-out';
    const normalized = encoded.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    if (typeof payload?.uid === 'string' && payload.uid) return payload.uid;
  } catch { /* opaque tokens use the non-reversible in-memory scope below */ }
  if (!raw) return 'signed-out';
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) { hash ^= raw.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `opaque-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createTutorDrillSession(token, drillId) {
  const accountScope = accountScopeFromToken(token);
  const safeDrill = String(drillId || 'unknown').slice(0, 60);
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { accountScope, drillId: safeDrill, id: `${safeDrill}:${nonce}`, automaticInterventions: 0, spokenCueIds: new Set() };
}

export function tutorDrillSessionMatches(session, token, drillId) {
  return !!session && session.accountScope === accountScopeFromToken(token)
    && session.drillId === String(drillId || 'unknown').slice(0, 60);
}

export function consumeAutomaticTutorCue(session, cue, requestedMax = 2) {
  if (!session || !cue?.id || session.spokenCueIds.has(cue.id)) return false;
  const cap = Math.max(0, Math.min(2, Number(requestedMax) || 2));
  if (session.automaticInterventions >= cap) return false;
  session.spokenCueIds.add(cue.id);
  session.automaticInterventions += 1;
  return true;
}
