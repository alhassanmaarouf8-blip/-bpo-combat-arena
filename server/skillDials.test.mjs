/**
 * skillDials.test.mjs — pins the 6-dial profile's honesty contract (v2 Phase 1 slice 3):
 * deterministic, evidence-floored, fails honest (measurable:false + reason) instead of guessing,
 * and Aussprache is NEVER measured from text — that pin may only fall after the external gold
 * study, by explicit owner order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDials } from './skillDials.mjs';

const filler = (n) => Array(n).fill('wort').join(' ');
const voice = (qid, transcript, durationMs = 20000) => ({ qid, transcript, durationMs, inputMode: 'voice' });
const RICH = 'Ich arbeite gern im Kundenservice, weil ich Menschen helfen kann, obwohl es manchmal stressig wird. Wir finden immer eine gute Lösung, wenn wir ruhig bleiben und ehrlich sprechen.';

const strongRun = [voice(1, RICH), voice(3, RICH), voice(4, RICH), voice(5, RICH)];

test('PRONUNCIATION PIN: never measurable from text, no matter how rich the input', () => {
  const p = computeDials({ answers: strongRun, grammarErrors: 0 }).find((d) => d.key === 'pronunciation');
  assert.equal(p.measurable, false);
  assert.equal(p.level, null);
  assert.equal(p.reason, 'unvalidated');
});

test('determinism: same input twice → deep-equal dials', () => {
  const input = { answers: strongRun, grammarErrors: 3 };
  assert.deepEqual(computeDials(input), computeDials(input));
});

test('empty input: every dial fails honest, none throws or guesses', () => {
  for (const d of computeDials({ answers: [], grammarErrors: null })) {
    assert.equal(d.measurable, false, `${d.key} guessed on zero evidence`);
    assert.equal(d.level, null);
  }
});

test('typed-only run: fluency is honest about WHY (typed, not thin)', () => {
  const typed = strongRun.map((a) => ({ ...a, inputMode: 'typed', durationMs: 0 }));
  const f = computeDials({ answers: typed, grammarErrors: 0 }).find((d) => d.key === 'fluency');
  assert.equal(f.measurable, false);
  assert.equal(f.reason, 'typed_only');
});

test('fluency: measured from voiced words/duration and the raw wpm is exposed', () => {
  const f = computeDials({ answers: strongRun, grammarErrors: 0 }).find((d) => d.key === 'fluency');
  assert.equal(f.measurable, true);
  assert.ok(f.metric.wpm > 0);
  assert.ok(f.evidence.voicedAnswers >= 2);
});

test('grammar: checker unavailable → unmeasured with its own reason, never a guessed 0', () => {
  const g = computeDials({ answers: strongRun, grammarErrors: null }).find((d) => d.key === 'grammar');
  assert.equal(g.measurable, false);
  assert.equal(g.reason, 'checker_unavailable');
});

test('grammar band edges: 2 vs 7 errors per 100 words land in different bands (#40: output varies)', () => {
  const base = { answers: strongRun };
  const words = computeDials({ ...base, grammarErrors: 0 })[0].evidence.words;
  const few  = computeDials({ ...base, grammarErrors: Math.floor(words * 0.02) }).find((d) => d.key === 'grammar');
  const many = computeDials({ ...base, grammarErrors: Math.ceil(words * 0.07) }).find((d) => d.key === 'grammar');
  assert.equal(few.level, 2);
  assert.equal(many.level, 0);
});

test('structures: rich subordinate clauses → measured with a positive density', () => {
  const s = computeDials({ answers: strongRun, grammarErrors: 0 }).find((d) => d.key === 'structures');
  assert.equal(s.measurable, true);
  assert.ok(s.metric.subordPer100w > 0);
});

test('stability: strong adaptive climb holds; a non-adaptive (fixed-flow) run is honest about it', () => {
  const s = computeDials({ answers: strongRun, grammarErrors: 0 }).find((d) => d.key === 'stability');
  assert.equal(s.measurable, true);
  assert.equal(s.level, 2, 'no weak upper-tier answers → holds');
  assert.equal(s.metric.maxTier, 3);

  const fixed = strongRun.map((a) => ({ ...a, qid: undefined }));
  const s2 = computeDials({ answers: fixed, grammarErrors: 0 }).find((d) => d.key === 'stability');
  assert.equal(s2.measurable, false);
  assert.equal(s2.reason, 'not_adaptive');
});

test('stability: collapse in the upper tiers is called out (weak short answers up high)', () => {
  const collapse = [voice(1, RICH), voice(3, 'Ich weiß nicht.'), voice(6, 'Keine Ahnung wirklich.'), voice(4, filler(15))];
  const s = computeDials({ answers: collapse, grammarErrors: 0 }).find((d) => d.key === 'stability');
  assert.equal(s.measurable, true);
  assert.equal(s.level, 0, '2 of 3 upper answers weak → bricht ein');
});

test('thin sample: vocab/structures refuse to measure under 40 words', () => {
  const thin = [voice(1, 'Ich heiße Ahmed und komme aus Kairo.')];
  const dials = computeDials({ answers: thin, grammarErrors: 0 });
  assert.equal(dials.find((d) => d.key === 'vocab').reason, 'thin');
  assert.equal(dials.find((d) => d.key === 'structures').reason, 'thin');
});
