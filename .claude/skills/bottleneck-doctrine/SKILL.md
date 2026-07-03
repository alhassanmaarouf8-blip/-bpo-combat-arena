---
name: bottleneck-doctrine
description: THE decision mechanism for how OMNI-PERFORM leads a learner (owner vision 2026-07-03, decisions delegated to Fable 5 and locked here). Read before touching the brain, home guidance, assessment, prescriptions, or "what should the student do next" logic anywhere.
---

# bottleneck-doctrine — the app leads the student

**Owner's vision (2026-07-03, his words distilled):** a learner has 100 problems and doesn't
know which. The app's entire intelligence serves ONE question — *what is this person's single
biggest bottleneck, the fix with the largest effect?* Then **the app leads** ("الأب يقود
الابن"): diagnose → prescribe ONE fix → prove it's fixed → next bottleneck. Accuracy is the
non-negotiable #1 property; a false diagnosis destroys everything.

The owner explicitly delegated the four design decisions below ("I will not be smarter than
it — Fable 5 decides, build the mechanism, save it reusable"). They are now LAW. Change them
only on new explicit owner instruction, and update this file in the same change.

## The four locked decisions

### D1 — The first interview IS the diagnosis (no separate mandatory test)
The free first interview doubles as the diagnostic. Rationale: diagnosis from real interview
behavior beats a synthetic quiz; a mandatory 15-min assessment is a drop-off cliff; and the
product's unique claim is "we ARE the live test". The engine's cold-start state (`NEW`)
frames it explicitly as a **Diagnose-Interview** — the learner must know they are being
diagnosed, not judged.

### D2 — Clear lead + open doors (not a locked path)
ONE commanding step dominates the home (`NextStep.jsx`, directive from `GET /api/brain`);
every other surface stays reachable below it. The father points firmly; he doesn't lock the
house. Full-lock was rejected (fights paying users + psychology), map-only was rejected (too
weak to be "leading").

### D3 — Drills NOMINATE, the live interview CONFIRMS
A bottleneck is "fixed" ONLY when it holds inside a live interview re-test (the boss's AKTE
deliberately re-tests the weakness). Drill mastery earns the rematch (`READY` state), never
the verdict. Encoded in `engine.js`: aha requires drilled + ≥2 measurements + a real drop +
no global regression.

### D4 — Thin evidence → "I need to hear you more" (owner's own pick)
No diagnosis is asserted below the evidence floor. Cold start prescribes the diagnosis
interview; an unmeasured hire-gating signal produces `MEASURE` ("Ich kann X noch nicht
sicher messen — und ich rate nicht"); a target with <2 sessions of evidence renders with
soft wording (`confidence: 'low'` → "Erste Diagnose", never "Deine größte Baustelle").

## The mechanism (where each part lives)

| Part | File | Contract |
|---|---|---|
| Skill DAG + tiers + journey | `server/brain/skillGraph.js` | frontier(), progress(), tierStatus() |
| Mastery evidence | `server/brain/bkt.js` + `adapter.js` | BKT ≥0.8 gate; mastery only with positive evidence |
| THE decision | `server/brain/engine.js` `decide()` | snapshot → ONE directive {state, target, prescription, journey, aha}; deterministic, copy-free, no LLM |
| Profile → snapshot | `server/brain/adapter.js` `buildSnapshot()` | reuses hireReadiness/weakLog/sessions — no new signals invented |
| API | `GET /api/brain` (progress.js) | requireAuth; returns {directive, level, hireReady} |
| The visible hand | `client/src/NextStep.jsx` | German copy per state; OWNER-AR slots; renders NOTHING on error (never a fake card) |
| Fix-proof loop | drill-event (`POST /api/drill-event`) + weakLog spine + boss AKTE re-test | closes D3 |

## Rules for any future change in this area

1. The engine stays **pure and deterministic** — same snapshot in, same directive out. No LLM
   ever decides a diagnosis, a mastery, or a prescription.
2. Exactly **ONE** prescribed step is ever shown. Adding a second "also try…" violates the
   doctrine (and owner law #6: sharp, sparse).
3. Every new drill/lesson/surface must plug into the loop: report `drill-event`, appear as a
   `drill` mapping in the skill graph or NextStep's `drillKey`, or it is incongruent (law #5).
4. Copy renders in the CLIENT (or a render layer) — never inside the engine. German only;
   Arabic = OWNER-AR slots.
5. When evidence thins (new signal, new skill), extend `MEASURE`/confidence handling — never
   let a guess render as a verdict.
6. Verification bar for changes here: engine/adapter unit tests + a headless probe of
   `/api/brain` for a fresh account (expect `NEW`) and a played account (expect a target).
