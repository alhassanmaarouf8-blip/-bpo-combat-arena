import test from 'node:test';
import assert from 'node:assert/strict';
import { parseM2, scoreGecPredictions, sentenceEdit } from '../scripts/lib/gec-benchmark.mjs';

test('M2 parser keeps spoken grammar edits and excludes noop, punctuation, spelling and orthography', () => {
  const items = parseM2([
    'S Mit der Kunde sprechen .',
    'A 1 2|||R:DET:FORM|||dem|||REQUIRED|||-NONE-|||0',
    'A 2 3|||R:NOUN:FORM|||Kunden|||REQUIRED|||-NONE-|||0',
    'A 4 5|||U:PUNCT||||||REQUIRED|||-NONE-|||0',
    '',
    'S Guten Tag .',
    'A -1 -1|||noop|||-NONE-|||REQUIRED|||-NONE-|||0',
  ].join('\n'));
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].edits.map((edit) => edit.type), ['R:DET:FORM', 'R:NOUN:FORM']);
  assert.equal(items[1].edits.length, 0);
});

test('sentenceEdit produces M2-compatible replacement, insertion and deletion spans', () => {
  assert.deepEqual(sentenceEdit('Ich spreche mit der Kunde .', 'Ich spreche mit dem Kunden .'), {
    start: 3, end: 5, replacement: 'dem Kunden',
  });
  assert.deepEqual(sentenceEdit('Ich gern arbeite .', 'Ich arbeite gern .'), {
    start: 1, end: 3, replacement: 'arbeite gern',
  });
  assert.equal(sentenceEdit('Alles stimmt .', 'Alles stimmt .'), null);
});

test('GEC scorer reports exact reference metrics and fails closed on malformed coverage', () => {
  const gold = [
    { itemId: 'a', source: 'falko', gold: [{ start: 1, end: 2, replacement: 'dem', type: 'R:DET:FORM' }] },
    { itemId: 'b', source: 'merlin', gold: [{ start: 2, end: 3, replacement: 'Kunden', type: 'R:NOUN:FORM' }] },
  ];
  const predictions = [
    { itemId: 'a', source: 'falko', predicted: [{ start: 1, end: 2, replacement: 'dem', ruleId: 'REGEL_Ä' }] },
    { itemId: 'b', source: 'merlin', predicted: [{ start: 0, end: 1, replacement: 'Ein', ruleId: 'RULE_B' }] },
  ];
  const report = scoreGecPredictions(gold, predictions);
  assert.equal(report.all.exactReferencePrecision, 0.5);
  assert.equal(report.all.exactReferenceRecall, 0.5);
  assert.equal(report.bySource.falko.exactReferencePrecision, 1);
  assert.equal(report.bySource.merlin.exactReferencePrecision, 0);
  assert.equal(report.all.byGoldType['R:DET:FORM'].exactReferenceRecall, 1);
  assert.equal(report.all.byRule['REGEL_Ä'].exactReferencePrecision, 1);
  assert.throws(() => scoreGecPredictions(gold, predictions.slice(0, 1)), /Incomplete/);
  assert.throws(() => scoreGecPredictions(gold, [{ ...predictions[0], rawText: 'forbidden' }, predictions[1]]), /unknown fields/);
  assert.throws(() => scoreGecPredictions(gold, [predictions[0], predictions[0]]), /Duplicate/);
});
