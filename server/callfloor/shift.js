/**
 * callfloor/shift.js — "work a shift": a run of back-to-back calls with a time budget, ending in a
 * BPO shift report. Deliberately LIGHT: a shift is just a per-user time window (startedAt) — the
 * report is derived from the durable call_results created during it (no new table, no per-call
 * tagging, no schema change). One active shift per user; a new one supersedes the old.
 *
 * The time budget is clamped to the user's remaining DAILY call ceiling (callSession.dailyLimitSec),
 * so a shift can never let voice run past the metered cap.
 */

import { dayKey } from '../time.js';
import { dailyLimitSec } from './callSession.js';
import { secondsUsedToday } from './resultsStore.js';

// Allowed shift lengths (minutes) — the spec's 10/20/40, clamped to what the daily budget allows.
export const SHIFT_MINUTES = [10, 20, 40];

const active = new Map();   // userId → { id, startedAt, targetSec, cairoDay }
export function _resetForTest() { active.clear(); }
export function getShift(userId) { return active.get(String(userId || '')) || null; }

/** Start a shift; targetMin is clamped to the remaining daily ceiling. */
export async function startShift({ userId, targetMin }) {
  const day = dayKey();
  const used = await secondsUsedToday(userId, day);
  const remaining = Math.max(0, dailyLimitSec() - used);
  if (remaining <= 0) return { error: 'daily_limit', usedSec: used, limitSec: dailyLimitSec() };
  const requested = (SHIFT_MINUTES.includes(Number(targetMin)) ? Number(targetMin) : SHIFT_MINUTES[0]) * 60;
  const targetSec = Math.min(requested, remaining);
  const shift = { id: `sh_${day}_${userId}`.slice(0, 80), startedAt: Date.now(), targetSec, cairoDay: day };
  active.set(String(userId), shift);
  return { shift, remainingDailySec: remaining };
}

/** Results belonging to the active shift = this user's call_results created since it started. */
export function resultsInShift(shift, allResults) {
  if (!shift) return [];
  return (allResults || []).filter((r) => (r.createdAt || 0) >= shift.startedAt);
}

export function endShift(userId) {
  const s = active.get(String(userId));
  active.delete(String(userId));
  return s || null;
}

export default { SHIFT_MINUTES, startShift, getShift, endShift, resultsInShift, _resetForTest };
