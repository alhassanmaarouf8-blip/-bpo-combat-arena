import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shadowingRoundTruth, flowRoundTruth } from '../client/src/drillTruth.js';

test('shadowing never calls a partly failed round complete', () => {
  const truth = shadowingRoundTruth([
    { match: 0 }, { match: 55 }, { match: 100 }, { match: 10 },
  ], 4);
  assert.deepEqual(truth, { attempted: 4, passed: 1, total: 4, complete: false });
});

test('flow refuses praise and zero-error claims for a two-word final round', () => {
  const truth = flowRoundTruth([
    { metrics: { words: 166, voicedMs: 60000, wpm: 166, fillers: 0 } },
    { metrics: { words: 31, voicedMs: 60000, wpm: 31, fillers: 0 } },
    { metrics: { words: 2, voicedMs: 5700, wpm: 21, fillers: 0 } },
  ]);
  assert.equal(truth.allMeaningful, false);
  assert.equal(truth.finalMeaningful, false);
  assert.equal(truth.grammarMeasured, false);
  assert.equal(truth.fillerPraiseAllowed, false);
});

test('flow recognizes three substantial rounds', () => {
  const row = { metrics: { words: 30, voicedMs: 12000, wpm: 90, relevancy: 0.5 } };
  const truth = flowRoundTruth([row, row, row]);
  assert.equal(truth.allMeaningful, true);
  assert.equal(truth.grammarMeasured, true);
  assert.equal(truth.relevancyMeasured, true);
  assert.equal(truth.fillerPraiseAllowed, true);
});

test('known exhausted allowance is checked before any interview audio or microphone work', () => {
  const source = fs.readFileSync(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('const beginSession = useCallback');
  const end = source.indexOf('const closeSalma', start);
  const body = source.slice(start, end);
  const gate = body.indexOf("setError('daily_limit')");
  assert.ok(gate > -1);
  assert.ok(gate < body.indexOf('stopTutorPlayback()'));
  assert.ok(gate < body.indexOf('unlockAudioPlayback()'));
  assert.ok(gate < body.indexOf('start();'));
});
