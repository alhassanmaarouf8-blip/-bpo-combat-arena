import test from 'node:test';
import assert from 'node:assert/strict';
import { observeProsody } from './prosodyObservations.js';

const answer = (words, sec) => ({ words, durationMs: sec * 1000 });

test('prosody observer abstains honestly on thin or broken input', () => {
  assert.equal(observeProsody(null), null);
  assert.equal(observeProsody([]), null);
  // two real answers are below the floor — abstention, not a confident number
  assert.equal(observeProsody([answer(20, 10), answer(25, 12)]), null);
  // fragments and glitches never count toward the floor
  assert.equal(observeProsody([
    answer(2, 0.3), answer(1, 0.5),                       // fragments (< MIN_ANSWER_MS)
    { words: 40, durationMs: 10 * 60 * 1000 },            // capture glitch (> MAX_SANE_MS)
    answer(20, 10), answer(22, 11),
  ]), null);
});

test('prosody observer reports raw arithmetic over sane answers only', () => {
  const obs = observeProsody([
    answer(20, 10),    // 120 WpM
    answer(30, 12),    // 150 WpM
    answer(24, 16),    // 90 WpM
    answer(1, 0.2),    // fragment — discarded but counted
  ]);
  assert.ok(obs);
  assert.equal(obs.answers, 3);
  assert.equal(obs.fragmentsDiscarded, 1);
  assert.equal(obs.totalSpeakingSec, 38);
  assert.equal(obs.meanAnswerSec, 12.7);
  assert.equal(obs.medianAnswerSec, 12);
  assert.equal(obs.shortestAnswerSec, 10);
  assert.equal(obs.longestAnswerSec, 16);
  assert.equal(obs.overallWpm, round(74 / (38 / 60)));   // 74 words in 38s
  assert.equal(obs.meanAnswerWpm, 120);                   // (120+150+90)/3
  assert.ok(obs.wpmSpread > 0);
  assert.ok(Object.isFrozen(obs));
});

function round(v) { return Math.round(v * 10) / 10; }

test('prosody observations carry NO judgement fields and NO learner-facing text', () => {
  const obs = observeProsody([answer(20, 10), answer(30, 12), answer(24, 16)]);
  const wire = JSON.stringify(obs);
  // observations, never verdicts — a claim may only exist behind a passed release
  for (const banned of ['slow', 'fast', 'erratic', 'hesitant', 'good', 'bad', 'score', 'verdict', 'zu ']) {
    assert.equal(wire.toLowerCase().includes(banned), false, `must not carry a judgement: ${banned}`);
  }
});

test('the targeted registry categories remain DARK until a real release lands', async () => {
  const { PRONUNCIATION_RELEASES } = await import('./pronunciationReleases.js');
  const { releasedPronunciationDeviation } = await import('./pronunciationRegistry.js');
  for (const id of ['speech_rate_clarity', 'excessive_pausing']) {
    assert.equal(releasedPronunciationDeviation(id, PRONUNCIATION_RELEASES), null,
      `${id} must stay dark: observations are stored, nothing is learner-facing before its release`);
  }
});
