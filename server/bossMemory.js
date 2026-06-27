/**
 * bossMemory.js — "Der Chef, der dich wachsen sah" (the boss who watched you grow).
 *
 * THE INVENTION: a live interviewer that remembers THIS candidate's TRAJECTORY across sessions —
 * a layer ABOVE the existing weak-rule re-test dossier (which already makes the boss re-test the
 * one recurring weakness). A returning human interviewer who has your file notices three things no
 * language app's bot ever has:
 *   1. GROWTH — "Ihre Flüssigkeit ist seit dem letzten Mal besser. Gut." (genuine, brief, earned)
 *   2. PERSISTENCE — an error that keeps coming back across sessions gets pressed harder.
 *   3. ABSENCE — "Lange nicht gesehen." after a real break.
 * That relationship/arc is the humanness an app CAN win, and it costs nothing: this is a pure,
 * deterministic string built ONLY from stored session data. It never invents a number or a claim —
 * every clause is backed by real, stored signals, in line with the accuracy doctrine.
 *
 * This is passed as a SEPARATE `memory` field (not the dossier), so the weak-rule re-test the boss
 * already engineers stays intact and the growth narrative composes with it instead of replacing it.
 *
 * Output: a single German memory string for the boss AKTE block (woven in once, coolly), or null
 * when there is genuinely nothing real to remember (true first-timer).
 *
 * @param {object} prof      the loaded user profile (prof.sessions = PAST sessions, newest last)
 * @param {string|null} [weakRule]  optional known weak rule clause (off by default — the dossier
 *                                   re-test already owns the weak rule; pass it only to include it)
 * @param {number} [nowMs]   current time in ms (injectable for tests); defaults to Date.now()
 */
const FLUENCY_DELTA = 5;   // min change to honestly call it "besser"/"schwächer" (not noise)
const FILLER_DELTA  = 2;   // min drop in filler count to call it real progress
const BREAK_DAYS    = 4;   // a gap this long is worth a returning interviewer noticing

function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }

function daysBetween(nowMs, dateStr) {
  const t = Date.parse(dateStr);
  if (!isFinite(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

export function buildBossMemory(prof, weakRule = null, nowMs = Date.now()) {
  const sessions = Array.isArray(prof?.sessions) ? prof.sessions : [];
  const n = sessions.length;
  const clauses = [];

  // ── Weakness on file (optional — usually OFF; the dossier re-test already covers the weak rule) ──
  if (weakRule) clauses.push(`bekannte Schwäche bei "${weakRule}"`);

  // ── Persistence: an error tag that recurred across the last TWO sessions = a real pattern ──
  if (n >= 2) {
    const last = sessions[n - 1], prev = sessions[n - 2];
    const lt = new Set((last?.errorTags || []).filter(Boolean));
    const persistent = (prev?.errorTags || []).filter((t) => t && lt.has(t));
    if (persistent.length) {
      clauses.push(`derselbe Fehler zieht sich durch mehrere Gespräche: ${persistent.slice(0, 2).join(', ')}`);
    }
  }

  // ── Recurring error labels carried from the last session ──
  const recentErrs = (prof?.recentErrors || []).slice(0, 2).filter(Boolean);
  if (recentErrs.length) clauses.push(`zuletzt auffällig: ${recentErrs.join(', ')}`);

  // ── Trajectory: real, earned progress or a real dip (only when the delta is beyond noise) ──
  if (n >= 2) {
    const last = sessions[n - 1], prev = sessions[n - 2];
    const fl = num(last?.fluency), flPrev = num(prev?.fluency);
    const fi = num(last?.fillers), fiPrev = num(prev?.fillers);
    if (fl != null && flPrev != null && fl - flPrev >= FLUENCY_DELTA) {
      clauses.push('Flüssigkeit ist seit dem letzten Mal sichtbar besser geworden');
    } else if (fl != null && flPrev != null && flPrev - fl >= FLUENCY_DELTA) {
      clauses.push('zuletzt etwas schwächer als davor');
    } else if (fi != null && fiPrev != null && fiPrev - fi >= FILLER_DELTA) {
      clauses.push('weniger Füllwörter als beim letzten Mal');
    }
  }

  // ── Absence: a returning interviewer notices you were gone ──
  if (n >= 1) {
    const gap = daysBetween(nowMs, sessions[n - 1]?.date);
    if (gap != null && gap >= BREAK_DAYS) {
      clauses.push(`war ${gap} Tage nicht mehr da`);
    }
  }

  if (!clauses.length) return null;   // genuine first-timer / nothing real to remember
  return clauses.join('; ');
}
