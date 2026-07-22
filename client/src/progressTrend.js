/**
 * progressTrend.js — honest fluency-trend helper for the debrief's "DEIN FORTSCHRITT" card.
 *
 * Why this exists (anti-slop, get-hired honesty): the sparkline was fed the raw server slice
 * `sessions.map(s => s.fluency ?? 0)`, so a session that never recorded fluency became a literal 0.
 * The old verdict line then did `last - first` on that slice and printed "du verbesserst dich" —
 * turning a fabricated 0 (or a lucky easier boss) into a confident "you're improving". That is the
 * appearance of progress substituted for real progress, on a claim that matters for getting hired,
 * and a fake "you're improving" is the fastest way to drain trust from the whole debrief.
 *
 * The ONLY honest improvement signal is week-over-week over the SAME window with both weeks real
 * (`weekTrend`, rendered separately) — never last-vs-first of a slice mixing different bosses,
 * levels and moods. This helper just strips the fabricated zeros so the sparkline shows real values.
 */

// A real spoken answer scores a composite fluency > 0, so a 0 (or a non-finite value) marks a session
// that never recorded it (`?? 0`). Keep only real, comparable values — never a fabricated 0.
export function realFluencyTrend(fluency) {
  return (Array.isArray(fluency) ? fluency : []).filter((v) => Number.isFinite(v) && v > 0);
}

export default { realFluencyTrend };
