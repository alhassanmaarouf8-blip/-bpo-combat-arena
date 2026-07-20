/**
 * drillSeries.mjs — the SERIES layer of the drill-prescription doctrine (owner order 2026-07-20:
 * "not a drill and then retest — a SERIES of drills that provenly solve this specific problem for
 * this specific student"). Full criteria: docs/drill-prescription-doctrine.md (rules K1–K9).
 *
 * Pure + deterministic + DERIVED: the student's current stage on a problem is computed from the
 * drill events already recorded on that rule (weakLog[ruleId].drills, written by spokenReview
 * grading and /api/drill-event) — no new persisted state, no migration, same evidence in → same
 * stage out. The ladder per problem (K4):
 *   A NOTICE      finde-den-fehler — find the error in your OWN recorded sentence, speak the fix
 *   B CONTROLLED  build/say the corrected form, slow, accuracy-first
 *   C AUTOMATIZE  produce it fast — the timed variant
 *   D TRANSFER    the disguised probe inside the next REAL interview (not a drill: represented as
 *                 transferReady, and the engine prescribes the interview; probeTarget aims the boss
 *                 at this same top-ranked rule)
 *
 * K8 regression: when the ladder is complete but a LATER interview still records errors on the
 * rule (the disguised retest failed), the automatization stage re-opens and only reps performed
 * AFTER that failure count toward it — never "do the same thing again and hope" (Bloom: a failed
 * retest triggers a different corrective, here the timed variant rather than the plain one).
 */

const STEP = (stage, drill, completions) => Object.freeze({ stage, drill, completions });

// Per-problem ladders over the canonical curriculum grammar rules. Step counts are small on
// purpose (a stage is a gate, not a grind wall); volume-per-sitting lives in the drill protocols
// (salmaCoachCore PROTOCOLS) and spacing lives in the SRS schedule (K9).
export const SERIES = Object.freeze({
  'word-order-sub': Object.freeze([
    STEP('A', 'finde-den-fehler', 1),
    STEP('B', 'satzbau-schmiede', 2),
    STEP('B', 'sag-es-richtig', 3),
    STEP('C', 'sag-es-richtig-tempo', 3),
  ]),
  'praesens-perfekt': Object.freeze([
    STEP('A', 'finde-den-fehler', 1),
    STEP('B', 'sag-es-richtig', 3),
    STEP('C', 'sag-es-richtig-tempo', 3),
  ]),
  'dativ-akkusativ': Object.freeze([
    STEP('A', 'finde-den-fehler', 1),
    STEP('B', 'sag-es-richtig', 3),
    STEP('C', 'sag-es-richtig-tempo', 3),
  ]),
  'konjunktiv-2': Object.freeze([
    STEP('A', 'finde-den-fehler', 1),
    STEP('B', 'sag-es-richtig', 3),
    STEP('C', 'sag-es-richtig-tempo', 3),
  ]),
});

export function seriesFor(ruleId) {
  return Object.hasOwn(SERIES, ruleId) ? SERIES[ruleId] : null;
}

// An event counts as a completion when it names the step's drill and was not an explicit failure.
// (Events from /api/drill-event may carry no `correct` field — absence is participation, not
// failure, and stays creditable; an explicit correct:false never advances a stage.)
function countable(event, drill, notBefore = 0) {
  return event && event.drill === drill && event.correct !== false && (event.at || 0) >= notBefore;
}

/**
 * seriesProgress(ruleId, weakLog) → null when the rule has no series, else:
 *   { ruleId, steps, totalSteps, currentIndex, current, completedSteps, transferReady, regressed }
 * totalSteps includes the final D transfer stage, so a UI can honestly say "Schritt 2 von 5".
 * current is null exactly when transferReady (stage D: the next step IS the interview).
 */
export function seriesProgress(ruleId, weakLog = {}) {
  const steps = seriesFor(ruleId);
  if (!steps) return null;
  const entry = weakLog?.[ruleId] || {};
  const events = Array.isArray(entry.drills) ? entry.drills : [];
  const lastDrillAt = events.reduce((m, e) => Math.max(m, e?.at || 0), 0);
  const lastErrorAt = (Array.isArray(entry.errCounts) ? entry.errCounts : [])
    .reduce((m, c) => ((c?.count || 0) > 0 ? Math.max(m, c?.date || 0) : m), 0);

  const doneAllTime = steps.map((step) =>
    events.filter((e) => countable(e, step.drill)).length >= step.completions);
  const firstOpen = doneAllTime.findIndex((done) => !done);

  if (firstOpen === -1) {
    // Ladder complete. If the most recent interview evidence on this rule POSTDATES the last rep
    // and still shows errors, the disguised transfer retest failed → re-open automatization (K8):
    // only reps after the failure count.
    const lastIndex = steps.length - 1;
    const regressed = lastErrorAt > lastDrillAt;
    if (regressed) {
      const last = steps[lastIndex];
      const fresh = events.filter((e) => countable(e, last.drill, lastErrorAt)).length;
      if (fresh < last.completions) {
        return { ruleId, steps, totalSteps: steps.length + 1, currentIndex: lastIndex,
          current: last, completedSteps: lastIndex, transferReady: false, regressed: true };
      }
    }
    return { ruleId, steps, totalSteps: steps.length + 1, currentIndex: steps.length,
      current: null, completedSteps: steps.length, transferReady: true, regressed: false };
  }

  return { ruleId, steps, totalSteps: steps.length + 1, currentIndex: firstOpen,
    current: steps[firstOpen], completedSteps: firstOpen, transferReady: false, regressed: false };
}
