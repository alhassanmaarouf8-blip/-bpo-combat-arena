import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex,
  deterministicSample,
  finalizeAdjudication,
  grammarExamples,
  merlinItemHash,
  parseCsv,
  publicIndex,
  redactAdjudicationFragment,
  scorePredictions,
  summarizeAdjudication,
  summarizeInterRaterAgreement,
  validateIndependentAdjudication,
} from '../scripts/lib/merlin-benchmark.mjs';

const manifest = {
  version: 'test',
  expected: { germanRows: 5, uniqueGermanAuthors: 5, arabicL1GermanRows: 2 },
  split: { seed: 'fixed', calibration: 0.6, development: 0.2, holdout: 0.2 },
};

const rows = [
  ['a', 'Arabic', 'B1', '2'],
  ['b', 'Arabic', 'B1', '0'],
  ['c', 'Russian', 'B1', '1'],
  ['d', 'Russian', 'B1', '0'],
  ['e', 'Russian', 'B1', '3'],
].map(([_author_id, _author_L1, _rating_fair_cefr, count_G]) => ({
  _author_id, _author_L1, _rating_fair_cefr, count_G, _test_language: 'German',
}));

test('CSV parser handles quoted commas and rejects malformed row widths', () => {
  assert.deepEqual(parseCsv('a,b\n1,"two,three"\n'), [{ a: '1', b: 'two,three' }]);
  assert.throws(() => parseCsv('a,b\n1\n'), /expected 2 fields/);
});

test('MERLIN index is deterministic, learner-disjoint, and contains no author IDs', () => {
  const first = buildIndex(rows, manifest);
  const second = buildIndex(rows, manifest);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((item) => item.itemHash)).size, 5);
  assert.ok(first.every((item) => !JSON.stringify(item).match(/"[abcde]"/)));
  assert.deepEqual(publicIndex(first, 'manifest').items.every((item) => !('hasGrammarError' in item)), true);
  assert.equal(first.find((item) => item.itemHash === merlinItemHash('test', 'a')).arabicL1, true);
});

test('manifest count mismatches fail closed', () => {
  assert.throws(() => buildIndex(rows.slice(1), manifest), /German row count mismatch/);
});

test('blinded sample is deterministic, unique, priority-inclusive, and redacts contact data', () => {
  const items = buildIndex(rows, manifest);
  const sample = deterministicSample(items, 3, 'seed', (item) => item.arabicL1);
  assert.equal(sample.length, 3);
  assert.equal(new Set(sample.map((item) => item.itemHash)).size, 3);
  assert.ok(sample.slice(0, 2).every((item) => item.arabicL1));
  const redacted = redactAdjudicationFragment('Mail a@example.com, https://example.com, +20 123 456 789.');
  assert.equal(redacted.includes('example.com'), false);
  assert.equal(redacted.includes('123'), false);
  assert.match(redacted, /\[EMAIL\].*\[URL\].*\[NUMBER\]/);
  assert.deepEqual(grammarExamples({ allExamples: [{ wrong: 'a', right: 'b' }], examples: [] }), [{ wrong: 'a', right: 'b' }]);
});

test('scorer reports provenance-separated systems and rejects duplicate or extra-key input', () => {
  const items = buildIndex(rows, manifest);
  const selected = items.filter((item) => item.split === 'calibration');
  const predictions = selected.flatMap((item) => [
    { itemHash: item.itemHash, system: 'languagetool', correctionCount: item.hasGrammarError ? 1 : 0 },
    { itemHash: item.itemHash, system: 'merged', correctionCount: 1 },
  ]);
  const report = scorePredictions(items, predictions, 'calibration');
  assert.equal(report.languagetool.accuracy, 1);
  assert.equal(report.languagetool.coverage, 1);
  assert.equal(report.languagetool.slices.l1['arabic-l1'].coverage, 1);
  assert.equal(report.languagetool.slices.fairCefr.B1.coverage, 1);
  assert.ok(report.merged.falsePositiveRate == null || report.merged.falsePositiveRate >= 0);
  assert.throws(() => scorePredictions(items, [{ ...predictions[0], rawText: 'forbidden' }], 'calibration'), /unknown fields/);
  assert.throws(() => scorePredictions(items, [predictions[0], predictions[0]], 'calibration'), /Duplicate prediction/);
});

test('adjudication summary aggregates by real rule and rejects duplicate/unknown verdicts', () => {
  const key = { items: [{ fairCefr: 'B1', arabicL1: true, corrections: [
    { correctionId: 'c1', ltRuleId: 'RULE_A' },
    { correctionId: 'c2', ltRuleId: 'RULE_A' },
  ] }] };
  const report = summarizeAdjudication(key, { verdicts: [
    { correctionId: 'c1', verdict: 'valid' },
    { correctionId: 'c2', verdict: 'harmful' },
  ] });
  assert.equal(report.reviewed, 2);
  assert.equal(report.harmfulRate, 0.5);
  assert.equal(report.byRule.RULE_A.harmful, 1);
  assert.throws(() => summarizeAdjudication(key, { verdicts: [
    { correctionId: 'c1', verdict: 'valid' },
    { correctionId: 'c1', verdict: 'valid' },
  ] }), /Duplicate correction/);
  assert.throws(() => summarizeAdjudication(key, { verdicts: [{ correctionId: 'missing', verdict: 'valid' }] }), /Unknown correction/);
});

test('two-rater agreement requires complete independent qualified reviews and reports kappa', () => {
  const pack = { items: [{ reviewId: 'r1', corrections: [
    { correctionId: 'c1', before: 'ein Mann', after: 'einen Mann' },
    { correctionId: 'c2', before: 'mit der Kunde', after: 'mit dem Kunden' },
    { correctionId: 'c3', before: 'guten Tag', after: 'Guten Tag' },
  ] }] };
  const review = (reviewerId, verdicts) => ({
    schemaVersion: 1,
    reviewerId,
    qualificationAttested: true,
    independentReviewAttested: true,
    verdicts: verdicts.map((verdict, index) => ({ correctionId: `c${index + 1}`, verdict, reviewerNote: '' })),
  });
  const a = review('rater_a', ['valid', 'valid', 'acceptable_alternative']);
  const b = review('rater_b', ['valid', 'harmful', 'acceptable_alternative']);
  const report = summarizeInterRaterAgreement(pack, a, b);
  assert.equal(report.reviewed, 3);
  assert.equal(report.agreements, 2);
  assert.equal(report.disagreements, 1);
  assert.equal(report.observedAgreement, 2 / 3);
  assert.equal(report.disagreementItems[0].correctionId, 'c2');
  assert.ok(report.cohenKappa < report.observedAgreement);
  assert.throws(() => summarizeInterRaterAgreement(pack, a, { ...b, reviewerId: 'rater_a' }), /distinct independent reviewers/);
  assert.throws(() => validateIndependentAdjudication(pack, { ...a, qualificationAttested: false }), /explicitly attested/);
  assert.throws(() => validateIndependentAdjudication(pack, { ...a, verdicts: a.verdicts.slice(0, 2) }), /incomplete/);
  assert.throws(() => validateIndependentAdjudication(pack, {
    ...a,
    verdicts: a.verdicts.map((entry, index) => index ? entry : { ...entry, hiddenLabel: true }),
  }), /unknown fields/);

  const key = { items: [{ fairCefr: 'B1', arabicL1: true, corrections: [
    { correctionId: 'c1', ltRuleId: 'R1' },
    { correctionId: 'c2', ltRuleId: 'R2' },
    { correctionId: 'c3', ltRuleId: 'R3' },
  ] }] };
  const resolution = {
    schemaVersion: 1,
    adjudicatorId: 'adjudicator_1',
    qualificationAttested: true,
    items: [{
      correctionId: 'c2',
      before: 'mit der Kunde',
      after: 'mit dem Kunden',
      verdictA: 'valid',
      verdictB: 'harmful',
      finalVerdict: 'valid',
      rationale: 'The complete corrected phrase has the required dative form.',
    }],
  };
  const final = finalizeAdjudication(pack, key, a, b, resolution);
  assert.equal(final.final.reviewed, 3);
  assert.equal(final.final.counts.valid, 2);
  assert.equal(final.final.counts.acceptable_alternative, 1);
  assert.throws(() => finalizeAdjudication(pack, key, a, b, { ...resolution, items: [] }), /incomplete/);
  assert.throws(() => finalizeAdjudication(pack, key, a, b, {
    ...resolution,
    items: [{ ...resolution.items[0], after: 'tampered' }],
  }), /does not match/);
  assert.throws(() => finalizeAdjudication(pack, {
    items: [...key.items, { corrections: [{ correctionId: 'extra', ltRuleId: 'R4' }] }],
  }, a, b, resolution), /does not exactly match/);
});
