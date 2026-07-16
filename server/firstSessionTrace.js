/**
 * First-session trace — owner-only, privacy-bounded activation evidence.
 *
 * This records the small sequence needed to diagnose an abandoned first interview.
 * It intentionally stores no audio, transcript, prompt, IP, user agent, email, or
 * raw WebSocket close reason. The trace belongs to the immutable account profile and
 * is capped to one first journey with a small allowlisted event vocabulary.
 */
import express from 'express';
import { requireSession, rateLimit } from './auth.js';
import { mutateUser } from './store.js';

export const firstSessionTraceRouter = express.Router();

const MAX_EVENTS = 16;
const CLIENT_EVENTS = new Set(['start_clicked', 'mic_ready', 'mic_blocked', 'debrief_visible']);
const SERVER_EVENTS = new Set([
  'fight_started', 'interviewer_started', 'first_answer_received',
  'debrief_generated', 'session_closed',
]);
const TERMINAL_REASONS = new Set(['completed', 'time_limit', 'abrupt_close', 'server_shutdown', 'other']);
const MIC_REASONS = new Set(['denied', 'not_found', 'unsupported', 'other']);

function safeReason(event, reason) {
  if (event === 'mic_blocked') return MIC_REASONS.has(reason) ? reason : 'other';
  if (event === 'session_closed') return TERMINAL_REASONS.has(reason) ? reason : 'other';
  return null;
}

function freshTrace(now) {
  return { version: 1, startedAt: now, endedAt: null, events: [] };
}

function hasCompletedInterview(profile) {
  return Array.isArray(profile?.sessions) && profile.sessions.length > 0;
}

/** Apply one safe event to a plain profile; kept pure for privacy-boundary tests. */
export function appendFirstSessionTrace(profile, event, { reason = null, now = Date.now() } = {}) {
  if (!profile || (!CLIENT_EVENTS.has(event) && !SERVER_EVENTS.has(event))) return null;
  const existing = profile.firstSessionTrace;
  if (!existing && hasCompletedInterview(profile)) return null;
  if (existing?.endedAt) return publicOwnerTrace(existing);
  const trace = existing && typeof existing === 'object' ? existing : freshTrace(now);
  if (!Array.isArray(trace.events)) trace.events = [];
  const normalizedReason = safeReason(event, reason);
  const duplicate = trace.events.some((item) => item?.event === event
    && (item?.reason || null) === normalizedReason);
  if (!duplicate && trace.events.length < MAX_EVENTS) {
    trace.events.push({ event, at: now, ...(normalizedReason ? { reason: normalizedReason } : {}) });
  }
  if (event === 'session_closed' && !trace.endedAt) trace.endedAt = now;
  profile.firstSessionTrace = trace;
  return publicOwnerTrace(trace);
}

/**
 * Record one idempotent event for a candidate's first interview journey.
 * The first completed interview closes eligibility permanently; this prevents the
 * trace from becoming a surveillance log of ordinary ongoing use.
 */
export async function recordFirstSessionEvent(userId, event, { reason = null, now = Date.now() } = {}) {
  return mutateUser(userId, async (profile) => {
    const trace = appendFirstSessionTrace(profile, event, { reason, now });
    return trace ? { value: trace } : { save: false, value: null };
  });
}

export function publicOwnerTrace(trace) {
  if (!trace || typeof trace !== 'object' || !Array.isArray(trace.events)) return null;
  return {
    version: 1,
    startedAt: Number.isFinite(trace.startedAt) ? trace.startedAt : null,
    endedAt: Number.isFinite(trace.endedAt) ? trace.endedAt : null,
    events: trace.events
      .filter((item) => item && (CLIENT_EVENTS.has(item.event) || SERVER_EVENTS.has(item.event)) && Number.isFinite(item.at))
      .slice(0, MAX_EVENTS)
      .map((item) => {
        const reason = safeReason(item.event, item.reason);
        return { event: item.event, at: item.at, ...(reason ? { reason } : {}) };
      }),
  };
}

firstSessionTraceRouter.post('/first-session/event', requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, tag: 'first-session-trace', accountOnly: true,
    keyExtra: (req) => req.account.id }),
  async (req, res) => {
    const event = String(req.body?.event || '');
    const reason = String(req.body?.reason || '');
    if (!CLIENT_EVENTS.has(event)) return res.status(400).json({ error: 'invalid_first_session_event' });
    await recordFirstSessionEvent(req.account.id, event, { reason });
    res.status(204).end();
  });
