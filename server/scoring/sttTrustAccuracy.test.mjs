/**
 * sttTrustAccuracy.test.mjs — GROUND-TRUTH CORPUS + REGRESS-GUARD for owner-LAW 7 (STT trust).
 *
 * The half-duplex interview can end a turn mid-sentence; a cut-off fragment is then stored identically
 * to a freely-chosen short answer, and every downstream scorer reads "the app cut him off" as "he froze
 * / can't produce German" — blaming the learner for the system's bug. looksTruncatedDE() is the
 * deterministic gate that tells the two apart from text alone, so a fragment is SKIPPED, never graded.
 *
 * THE RATCHET (invariants enforced here):
 *   1. ZERO-HARM — HARD FAIL, count MUST be 0: every CUT-OFF turn in the detector's COVERED classes
 *      (dangling function word / aux+pronoun / short dangling scrap) is flagged. A regression here means
 *      a fragment gets graded as the learner's weakness — the exact law-7 harm.
 *   2. RATCHET — two climbing floors: (a) OVERALL fragment-recall INCLUDING documented lexicon gaps
 *      (adverb-trailing scraps like "…nur"/"normalerweise ich", noted in turnQuality.js:154) — the
 *      nightly loop closes these; (b) SPECIFICITY on complete answers (the detector is deliberately
 *      biased toward over-flagging — safer to skip a critique than invent one — but must not over-flag
 *      so much that normal complete answers stop being critiqued). Floors only rise.
 *
 * Append confirmed real turns forever. Run: node --test server/scoring/sttTrustAccuracy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksTruncatedDE } from './turnQuality.js';

// { t: turn text, cut: true=CUT OFF (flag) / false=COMPLETE (don't flag), knownGap?: true = a documented
//   out-of-lexicon fragment the detector doesn't yet catch (RATCHET target, NOT part of the HARD invariant) }
const CORPUS = [
  // ── CUT OFF, COVERED classes — must be flagged (missing these is the law-7 harm; HARD) ──
  { t: 'Wir haben',                         cut: true },   // dangling auxiliary, no terminal
  { t: 'Ich möchte gerne mit',              cut: true },   // dangling preposition
  { t: 'und dann habe ich',                 cut: true },   // aux + trailing pronoun, nothing after
  { t: 'Das war für',                       cut: true },   // dangling preposition
  { t: 'Ich denke, dass',                   cut: true },   // dangling subordinating conjunction
  { t: 'weil',                              cut: true },   // bare conjunction
  { t: 'Meine',                             cut: true },   // dangling determiner, one word
  { t: 'Wir haben.',                        cut: true },   // STT stamped a period on a short dangling scrap
  { t: 'Der Kunde hat',                     cut: true },   // aux dangling
  // ── CUT OFF, KNOWN GAP — genuinely a fragment, but the dangling lexicon doesn't cover adverb endings
  //    (turnQuality.js:154 documents this class). Ratchet target for the nightly loop, not a HARD fail. ──
  { t: 'Ich wollte nur',                    cut: true, knownGap: true },   // modal + adverb, trails off
  // ── COMPLETE — must NOT be flagged (over-flagging these silently swallows real critique) ──
  { t: 'Ja.',                                                              cut: false },
  { t: 'Gerne.',                                                           cut: false },
  { t: 'Natürlich.',                                                       cut: false },
  { t: 'Ich habe drei Jahre im Kundenservice gearbeitet.',                 cut: false },
  { t: 'Der Kunde war zufrieden mit der Lösung.',                          cut: false },
  { t: 'Ich arbeite gern im Team und lerne schnell.',                      cut: false },
  { t: 'Vielen Dank für das Gespräch.',                                    cut: false },
  { t: 'Ich würde den Kunden zuerst beruhigen und dann eine Lösung anbieten.', cut: false },
  { t: 'Mein Name ist Omar und ich komme aus Kairo.',                      cut: false },
  { t: 'Das ist eine gute Frage, lassen Sie mich kurz überlegen.',         cut: false },
];

const RECALL_FLOOR = 0.85;         // overall fragment-recall incl. known gaps. Ratchets up as gaps close.
const SPECIFICITY_FLOOR = 0.80;    // complete answers correctly left unflagged. Ratchets up, never down.

test('ZERO-HARM — every COVERED-class cut-off is flagged (HARD; a miss blames the learner for a system cut)', () => {
  const missed = CORPUS.filter((c) => c.cut && !c.knownGap && !looksTruncatedDE(c.t)).map((c) => `"${c.t}"`);
  assert.equal(missed.length, 0,
    `MISSED FRAGMENT (covered class) — a cut-off turn was NOT flagged (would be graded as the learner's weakness):\n  ${missed.join('\n  ')}`);
});

test('RATCHET — fragment-recall and complete-specificity stay above their floors', () => {
  const cut = CORPUS.filter((c) => c.cut);
  const caught = cut.filter((c) => looksTruncatedDE(c.t)).length;
  const recall = cut.length ? caught / cut.length : 1;
  const complete = CORPUS.filter((c) => !c.cut);
  const ok = complete.filter((c) => !looksTruncatedDE(c.t)).length;
  const specificity = complete.length ? ok / complete.length : 1;
  console.log(`\n[stt-trust-accuracy] covered-class missed 0 · fragment-recall ${(recall * 100).toFixed(0)}% (${caught}/${cut.length}) · complete-specificity ${(specificity * 100).toFixed(0)}% (${ok}/${complete.length}) · corpus ${CORPUS.length}`);
  const gaps = cut.filter((c) => !looksTruncatedDE(c.t)).map((c) => `"${c.t}"`);
  if (gaps.length) console.log('  known recall gaps (nightly loop to close): ' + gaps.join(', '));
  const overflag = complete.filter((c) => looksTruncatedDE(c.t)).map((c) => `"${c.t}"`);
  if (overflag.length) console.log('  over-flagged (skips valid critique): ' + overflag.join(', '));
  assert.ok(recall >= RECALL_FLOOR, `fragment-recall ${(recall * 100).toFixed(0)}% fell below floor ${RECALL_FLOOR * 100}%`);
  assert.ok(specificity >= SPECIFICITY_FLOOR, `specificity ${(specificity * 100).toFixed(0)}% fell below floor ${SPECIFICITY_FLOOR * 100}%`);
});
