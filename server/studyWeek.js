/**
 * studyWeek.js — "Study 5, rest 2" (owner 2026-07-22). A paid subscriber gets N STUDY DAYS per
 * week; the days they skip are their own rest days (they choose by showing up). Enforced as a
 * weekly COUNT of distinct days with live-voice usage, NOT as pre-declared shuffleable days — so a
 * user can't reassign "off days" to sneak a 6th/7th study day. Week starts Monday, Africa/Cairo.
 *
 * PURE: reads the durable `usageDays` map ({'YYYY-MM-DD': live-seconds}) the interview already
 * writes. A day counts once it has any voiced usage. The current day is always allowed to CONTINUE
 * if it's already a study day (you don't lose a day mid-session).
 */
import { dayKey } from './time.js';

export const DEFAULT_STUDY_DAYS_PER_WEEK = 5;

// The Monday (YYYY-MM-DD) of the week containing a given day-key. Day-of-week of a calendar date is
// timezone-independent, so deriving it from the key at noon-UTC is safe (no DST/offset edge).
export function mondayOf(dayKeyStr) {
  const d = new Date(`${dayKeyStr}T12:00:00Z`);
  const dow = d.getUTCDay();                 // 0=Sun … 6=Sat
  const sinceMonday = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * weekStudyStatus(usageDays, studyDaysPerWeek, now) → {
 *   cap, weekStartKey, studyDaysThisWeek, todayIsStudyDay, allowedToday, restDaysLeft
 * }.  cap<=0 → no weekly limit (always allowed).
 */
export function weekStudyStatus(usageDays = {}, studyDaysPerWeek = DEFAULT_STUDY_DAYS_PER_WEEK, now = Date.now()) {
  const cap = Number(studyDaysPerWeek) || 0;
  const todayKey = dayKey(now);
  const weekStartKey = mondayOf(todayKey);
  const studyKeys = Object.keys(usageDays || {}).filter(
    (k) => (Number(usageDays[k]) || 0) > 0 && k >= weekStartKey && k <= todayKey,
  );
  const studyDaysThisWeek = studyKeys.length;
  const todayIsStudyDay = studyKeys.includes(todayKey);
  // Allowed if no limit, or today is already a counted study day (continue), or still under the cap.
  const allowedToday = cap <= 0 || todayIsStudyDay || studyDaysThisWeek < cap;
  const restDaysLeft = cap <= 0 ? null : Math.max(0, cap - studyDaysThisWeek);
  return { cap, weekStartKey, studyDaysThisWeek, todayIsStudyDay, allowedToday, restDaysLeft };
}

export default { DEFAULT_STUDY_DAYS_PER_WEEK, mondayOf, weekStudyStatus };
