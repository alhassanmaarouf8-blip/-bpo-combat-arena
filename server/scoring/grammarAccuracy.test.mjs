/**
 * grammarAccuracy.test.mjs — THE GROUND-TRUTH CORPUS + REGRESS-GUARD.
 *
 * This is the memory of the Compounding Accuracy Engine (owner 2026-07-05: "structured so it's
 * dynamic, learns from itself, and compounds toward its highest accuracy over time — verifiably").
 *
 * HOW IT COMPOUNDS: every real learner error we confirm becomes a permanent labeled case below,
 * next to guard-negatives (correct German that must stay unflagged). The nightly accuracy loop
 * appends new cases + a new deterministic rule; this file then proves the whole set still holds.
 *
 * THE RATCHET (two invariants, enforced here):
 *   1. ZERO HALLUCINATION — false positives on correct German MUST be 0. HARD FAIL. Non-negotiable.
 *      A rule that flags correct German can never be committed.
 *   2. RECALL ONLY CLIMBS — recall is reported and pinned to a floor (RECALL_FLOOR). Add cases /
 *      rules → raise the floor. It can go up, never silently down.
 *
 * Run: node --test server/scoring/grammarAccuracy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectL1Patterns } from './l1Errors.js';

// ── THE CORPUS. Append here as errors are confirmed — this is how knowledge compounds. ──────────
// { t: learner sentence, expect: error-class key that MUST be caught, or null = correct (must NOT flag) }
const CORPUS = [
  // ── verb-final (the #1 Arabic-L1 wall) ──
  { t: 'Ich komme später, weil ich habe keine Zeit.',                expect: 'verb-final' },
  { t: 'Ich interessiere mich, weil ich habe drei Jahre Erfahrung.', expect: 'verb-final' },
  { t: 'Sie sagte, dass sie ist müde heute.',                        expect: 'verb-final' },
  { t: 'Ich weiß, dass er kann gut Deutsch.',                        expect: 'verb-final' },
  { t: 'Wenn ich habe Zeit, rufe ich Sie an.',                       expect: 'verb-final' },
  { t: 'Ich denke, dass ich bin die richtige Person.',              expect: 'verb-final' },
  // ── guard-negatives: verb ALREADY clause-final = correct → must NEVER be flagged ──
  { t: 'Ich komme später, weil ich keine Zeit habe.',                expect: null },
  { t: 'Ich weiß, dass er gut Deutsch spricht.',                     expect: null },
  { t: 'Wenn Sie möchten, können wir morgen sprechen.',              expect: null },
  { t: 'Ich glaube, dass das Team stark ist.',                       expect: null },
  { t: 'Ich denke, dass ich die richtige Person bin.',              expect: null },
  { t: 'Obwohl es schwierig war, habe ich nicht aufgegeben.',        expect: null },
  // ── ADVERSARIAL guard-negatives (2026-07-05): a subordinate clause ending in a finite modal/aux is
  //    CORRECT even though the early word ("arbeiten"/"gehen") shares a finite-verb form. Broke it once. ──
  { t: 'Ich komme später, weil ich arbeiten muss.',                  expect: null },
  { t: 'Ich weiß, dass ich gehen möchte.',                           expect: null },
  { t: 'Ich glaube, dass wir das schaffen können.',                  expect: null },
  { t: 'Ich denke, dass er bald kommen wird.',                       expect: null },
  { t: 'Der Kollege, der gut Deutsch spricht, hilft mir.',           expect: null },
  { t: 'Ich frage mich, ob sie das wirklich verstehen.',             expect: null },
  // subtle verb-final errors that MUST still be caught after the fix
  { t: 'Ich denke, dass ich bin sehr motiviert.',                    expect: 'verb-final' },
  { t: 'weil ich muss jeden Tag arbeiten',                           expect: 'verb-final' },
  // ── gender / article (RECALL GAP as of 2026-07-05 — detector lexicon too narrow; to be expanded) ──
  { t: 'Ich habe die Problem gelöst.',                               expect: 'gender' },
  { t: 'Das war eine Problem für mich.',                             expect: 'gender' },
  // ── guard-negatives: correct gender ──
  { t: 'Ich habe das Problem gelöst.',                               expect: null },
  { t: 'Der Kunde war zufrieden mit der Lösung.',                    expect: null },
  { t: 'Ich arbeite gern im Team und lerne schnell.',                expect: null },
  { t: 'Vielen Dank für das Gespräch, ich freue mich auf Ihre Rückmeldung.', expect: null },
];

// Detection uses the same duplicate-to-clear-the-surfacing-gate trick the harness proved with,
// so we test the DETECTION logic (regex + guards), independent of the ">=2 = named pattern" policy.
const caughtKeys = (t) => new Set(detectL1Patterns([{ text: t }, { text: t }]).map((p) => p.key));

// The floor ratchets UP as detectors improve. Never lower it. (verb-final class is at 100%.)
const RECALL_FLOOR = 0.60;

test('ZERO HALLUCINATION — no correct German is ever flagged (HARD invariant)', () => {
  const falsePositives = [];
  for (const c of CORPUS) {
    if (c.expect !== null) continue;
    const keys = caughtKeys(c.t);
    if (keys.size > 0) falsePositives.push(`"${c.t}" → wrongly flagged [${[...keys]}]`);
  }
  assert.equal(falsePositives.length, 0,
    `Detector hallucinated on correct German (must be 0):\n  ${falsePositives.join('\n  ')}`);
});

test('RECALL — real errors caught (ratchets up; floor must not regress)', () => {
  const errors = CORPUS.filter((c) => c.expect !== null);
  const missed = errors.filter((c) => !caughtKeys(c.t).has(c.expect));
  const recall = (errors.length - missed.length) / errors.length;
  console.log(`\n[grammar-accuracy] recall ${((recall) * 100).toFixed(0)}% (${errors.length - missed.length}/${errors.length}); false-positives 0; corpus ${CORPUS.length} cases`);
  if (missed.length) console.log('  known gaps (next to close): ' + missed.map((m) => `${m.expect}:"${m.t.slice(0, 40)}"`).join(', '));
  assert.ok(recall >= RECALL_FLOOR, `recall ${(recall * 100).toFixed(0)}% fell below floor ${RECALL_FLOOR * 100}% — a detector regressed`);
});
