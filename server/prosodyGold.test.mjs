import test from 'node:test';
import assert from 'node:assert/strict';
import { cohenKappa, provisionalDetect, templateCsv, evaluateSheet } from '../scripts/prosody-gold.mjs';

test('cohen kappa: perfect agreement 1, chance-level ~0, handles the degenerate all-agree case', () => {
  assert.equal(cohenKappa([[1, 1], [0, 0], [1, 1], [0, 0]]), 1);
  const chance = cohenKappa([[1, 1], [1, 0], [0, 1], [0, 0]]);
  assert.ok(Math.abs(chance) < 1e-9, `chance agreement must be ~0, got ${chance}`);
  assert.equal(cohenKappa([]), null);
  assert.equal(cohenKappa([[1, 1], [1, 1]]), 1);   // pe === 1 degenerate branch
});

test('provisional detector: flags outside the band, abstains on thin input, never throws', () => {
  assert.equal(provisionalDetect({ words: 24, durationSec: 12 }).decision, 'clear');   // 120 WpM
  assert.equal(provisionalDetect({ words: 10, durationSec: 12 }).decision, 'flag');    // 50 WpM slow
  assert.equal(provisionalDetect({ words: 45, durationSec: 12 }).decision, 'flag');    // 225 WpM fast
  assert.equal(provisionalDetect({ words: 3, durationSec: 0.4 }).decision, 'abstain'); // fragment
  assert.equal(provisionalDetect({ words: NaN, durationSec: 12 }).decision, 'abstain');
});

// A tiny but complete sheet: consensus rows, one disagreement, one unusable+abstained row.
function sheet(rows) {
  const head = 'sampleId,speakerId,audioRef,durationSec,transcript,rater1_flag,rater1_highImpact,rater2_flag,rater2_highImpact,unusable,notes';
  return [templateCsv().split('\n')[0], head, ...rows].join('\n');
}
const slow = 'ein zwei drei vier fünf sechs sieben acht neun zehn';                    // 10 words
const normal = Array.from({ length: 24 }, (_, i) => `wort${i}`).join(' ');             // 24 words

test('evaluateSheet: maps consensus labels onto the REAL release evaluator', () => {
  const rows = [];
  // 80 usable answers across 10 speakers; detector and experts fully agree. The size is not
  // arbitrary: the release gate's Wilson lower bound ≥0.90 is mathematically unreachable below
  // ~36 flagged answers even at perfect precision (40/40 → 0.912) — the first fixture proved
  // that by failing. The sheet protocol documents the same requirement.
  for (let i = 0; i < 80; i++) {
    const speaker = `sp${(i % 10) + 1}`;
    const flagged = i < 40;                                // 40 genuinely-too-slow answers
    rows.push(flagged
      ? `F${i},${speaker},a${i}.ogg,12,"${slow}",1,1,1,1,0,`      // 50 WpM → flag; experts agree, high impact
      : `C${i},${speaker},a${i}.ogg,12,"${normal}",0,0,0,0,0,`);  // 120 WpM → clear
  }
  rows.push(`X1,sp1,x1.ogg,0.4,"zu kurz",,,,,1,cut off`);         // detector abstains; experts: unusable → correct
  rows.push(`D1,sp2,d1.ogg,12,"${normal}",1,0,0,0,0,split opinion`); // disagreement → excluded from gold
  const out = evaluateSheet(sheet(rows));
  assert.equal(out.usable, 81);                    // 80 consensus + 1 disagreement (usable, not gold)
  assert.equal(out.disagreements, 1);
  assert.equal(out.speakers, 10);
  assert.equal(out.metrics.correctionTotal, 40);
  assert.equal(out.metrics.correctionTruePositive, 40);
  assert.equal(out.metrics.abstentionTotal, 1);
  assert.equal(out.metrics.abstentionCorrect, 1);
  assert.equal(out.metrics.highImpactTotal, 40);
  assert.equal(out.metrics.highImpactDetected, 40);
  assert.ok(out.metrics.expertKappa > 0.9);
  assert.equal(out.verdict.passed, true, 'a perfect sheet must pass the real evaluator');
});

test('evaluateSheet: expert disagreement with the detector FAILS the release — the gate bites', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const speaker = `sp${(i % 10) + 1}`;
    // detector flags 10 slow answers, but the experts say only 5 of them actually harm clarity
    const flagged = i < 10;
    const expertsAgreeHarm = i < 5;
    rows.push(flagged
      ? `F${i},${speaker},a${i}.ogg,12,"${slow}",${expertsAgreeHarm ? 1 : 0},0,${expertsAgreeHarm ? 1 : 0},0,0,`
      : `C${i},${speaker},a${i}.ogg,12,"${normal}",0,0,0,0,0,`);
  }
  const out = evaluateSheet(sheet(rows));
  assert.equal(out.metrics.correctionTotal, 10);
  assert.equal(out.metrics.correctionTruePositive, 5);    // precision 0.5 — nowhere near 0.95
  assert.equal(out.verdict.passed, false, 'a half-wrong detector must NOT be released');
});

test('evaluateSheet rejects a sheet whose header was tampered with', () => {
  assert.throws(() => evaluateSheet('a,b,c\n1,2,3'), /header/);
});
