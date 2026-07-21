/**
 * callfloor/callSession.js — live call state + the DETERMINISTIC guardrails.
 *
 * The model never decides billing-relevant limits — code does: a hard per-call wall
 * (MAX_CALL_MS / MAX_AGENT_TURNS) and a hard per-user daily ceiling (CALLFLOOR_DAILY_MIN,
 * default 10 min/day, from durable call_sessions rows) checked BEFORE a call starts. No call
 * can run unmetered even before Phase 4 wires plan entitlements (this env cap is the stub the
 * phase doc demands; Phase 4 replaces it with per-plan allowances).
 *
 * Live turns are in-memory (a call is 2–4 minutes); the transcript becomes durable the moment
 * the call ends — or is abandoned — via resultsStore.
 */

import { randomBytes } from 'crypto';
import { dayKey } from '../time.js';
import { pickScenario, getScenario } from './scenarios.js';
import { openingTurn } from './callEngine.js';
import { saveCallSession, listCallResults, secondsUsedToday } from './resultsStore.js';

export const MAX_CALL_MS     = 4 * 60_000;
export const MAX_AGENT_TURNS = 8;
export const dailyLimitSec = () =>
  Math.max(60, Math.round(Number(process.env.CALLFLOOR_DAILY_MIN || 10) * 60));

const live = new Map();   // sessionId → session

export function getLive(id) { return live.get(String(id || '')) || null; }
export function _resetForTest() { live.clear(); }

function newId() { return `cf_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`; }

/** Abandon a stale/superseded live session (durable transcript; harvest happens via caller). */
export async function abandonSession(session) {
  live.delete(session.id);
  session.status = 'abandoned';
  session.endedAt = Date.now();
  await saveCallSession(session).catch(() => {});
  return session;
}

/**
 * Start a call. Enforces the daily ceiling and one-live-call-per-user. Returns
 * { session, scenario, opening } or { error, ... } for honest client messaging.
 */
export async function startCall({ userId, quadrant }) {
  const day = dayKey();
  const used = await secondsUsedToday(userId, day);
  const limit = dailyLimitSec();
  if (used >= limit) return { error: 'daily_limit', usedSec: used, limitSec: limit };

  // A user starting a new call abandons their previous live one (page reloads, crashes).
  for (const s of live.values()) {
    if (s.userId === userId) await abandonSession(s);
    else if (Date.now() - s.startedAt > MAX_CALL_MS + 120_000) await abandonSession(s);   // global stale sweep
  }

  const seen = (await listCallResults(userId).catch(() => [])).map((r) => r.scenarioId);
  const scenario = pickScenario(quadrant, seen);
  if (!scenario) return { error: 'unknown_quadrant' };

  const session = {
    id: newId(), userId, quadrant, scenarioId: scenario.id,
    startedAt: Date.now(), endedAt: null, status: 'live', analysisStatus: 'pending',
    transcript: [], mood: scenario.customer.mood0, finalMood: null, agentTurns: 0,
    cairoDay: day,
  };
  live.set(session.id, session);
  await saveCallSession(session).catch(() => {});   // durable row from second zero (daily-cap truth)

  const opening = openingTurn(scenario);
  if (opening) session.transcript.push({ role: 'customer', text: opening.text, at: Date.now() });
  return { session, scenario, opening };
}

/** Deterministic wall check — returns a reason when the call must end NOW. */
export function wallReason(session) {
  if (Date.now() - session.startedAt >= MAX_CALL_MS) return 'time';
  if (session.agentTurns >= MAX_AGENT_TURNS) return 'turns';
  return null;
}

export function recordAgentTurn(session, { text, durationSec }) {
  session.agentTurns += 1;
  session.transcript.push({ role: 'agent', text, durationSec, at: Date.now() });
}

export function recordCustomerTurn(session, { text, mood }) {
  session.mood = mood;
  session.transcript.push({ role: 'customer', text, at: Date.now() });
}

export async function endCall(session) {
  live.delete(session.id);
  session.status = 'ended';
  session.endedAt = Date.now();
  session.finalMood = session.mood;
  await saveCallSession(session);   // transcript is durable BEFORE any analysis runs
  return session;
}

export { getScenario };
export default { startCall, endCall, abandonSession, getLive, wallReason, recordAgentTurn, recordCustomerTurn, MAX_CALL_MS, MAX_AGENT_TURNS, dailyLimitSec, _resetForTest };
