/**
 * assessmentRamp.test.mjs — pins the deterministic adaptive routing of the Diagnose-Interview
 * (v2 Phase 1). The contract under test: same answers in → same plan out; the ladder climbs only
 * when the candidate copes; ONE weak answer never ends a run (slip ≠ system); no run ends below
 * the 3-answer evidence floor except by the bank's edges; masri is never authored here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RAMP_QUESTIONS, measureAnswer, classifyCoping, planNext } from './assessmentRamp.mjs';

// Deterministic answer builders (no Date/random — the module forbids them and so do we).
const filler = (n) => Array(n).fill('wort').join(' ');
const strong = (qid, { subord = false } = {}) =>
  ({ qid, transcript: (subord ? 'Ich bleibe ruhig, weil der Kunde Hilfe braucht. ' : '') + filler(30), durationMs: 30000, inputMode: 'voice' });
const mid  = (qid) => ({ qid, transcript: filler(16), durationMs: 15000, inputMode: 'voice' });
const weak = (qid) => ({ qid, transcript: 'Ich weiß nicht genau.', durationMs: 4000, inputMode: 'voice' });

test('bank integrity: unique ids, tiers 0–3, two questions per tier, shipped ids keep their masri', () => {
  const ids = RAMP_QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate qid');
  for (const t of [0, 1, 2, 3]) {
    assert.equal(RAMP_QUESTIONS.filter((q) => q.tier === t).length, 2, `tier ${t} needs 2 questions`);
  }
  for (const q of RAMP_QUESTIONS) {
    assert.ok(q.de.length > 10, `q${q.id} has no German`);
    if (q.id <= 5) assert.ok(q.ar.length > 0, `shipped q${q.id} lost its masri`);
  }
});

test('MASRI LAW: new questions (id > 5) carry an EMPTY owner-ar slot — never invented Arabic', () => {
  for (const q of RAMP_QUESTIONS.filter((q) => q.id > 5)) {
    assert.equal(q.ar, '', `q${q.id}.ar must stay an empty OWNER-AR slot until the owner fills it`);
  }
});

test('measureAnswer: outputs actually vary across the input range (a knob wired to nothing is foot-gun #40)', () => {
  assert.equal(measureAnswer({ transcript: '' }).wordCount, 0);
  const m1 = measureAnswer({ transcript: 'Ich arbeite gern im Team.', durationMs: 5000, inputMode: 'voice' });
  assert.equal(m1.wordCount, 5);
  assert.equal(m1.subordCount, 0);
  const m2 = measureAnswer({ transcript: 'Ich kam zu spät, weil der Bus nicht kam, obwohl ich früh los bin.', durationMs: 8000, inputMode: 'voice' });
  assert.equal(m2.subordCount, 2);
  assert.ok(m2.wpm > 0, 'voice answer with duration must yield a speech rate');
  assert.equal(measureAnswer({ transcript: 'getippt nicht gesprochen', inputMode: 'typed' }).wpm, null, 'typed answers have no speech rate');
  assert.equal(measureAnswer({ transcript: 'kurz' }).typeTokenRatio, null, 'TTR is honest-null under 20 words');
});

test('classifyCoping: length alone is not strength at high tiers — complex structure required', () => {
  const long = measureAnswer({ transcript: filler(30) });
  const longSub = measureAnswer({ transcript: 'weil ' + filler(30) });
  const short = measureAnswer({ transcript: filler(5) });
  assert.equal(classifyCoping(short, 0), 'weak');
  assert.equal(classifyCoping(long, 0), 'strong', 'tier 0: length suffices');
  assert.equal(classifyCoping(long, 2), 'mid', 'tier 2: 30 memorized-chunk words without one subordinate clause is NOT coping');
  assert.equal(classifyCoping(longSub, 2), 'strong');
});

test('determinism: the same answer sequence twice → deep-equal plans', () => {
  const answers = [strong(1), mid(3), weak(6)];
  assert.deepEqual(planNext(answers), planNext(answers));
});

test('empty run starts at tier 0', () => {
  const p = planNext([]);
  assert.equal(p.done, false);
  assert.equal(p.next.tier, 0);
});

test('strong run: the ladder climbs 0→1→2→3 and ends at the ceiling', () => {
  assert.equal(planNext([strong(1)]).next.tier, 1, 'coping at tier 0 → probe tier 1');
  assert.equal(planNext([strong(1), strong(3)]).next.tier, 2);
  assert.equal(planNext([strong(1), strong(3), strong(4, { subord: true })]).next.tier, 3);
  const done = planNext([strong(1), strong(3), strong(4, { subord: true }), strong(5, { subord: true })]);
  assert.equal(done.done, true);
  assert.equal(done.reason, 'ceiling');
  assert.deepEqual(done.trace.map((t) => t.tier), [0, 1, 2, 3], 'the ramp trace shows the climb');
});

test('slip ≠ system: ONE weak answer triggers a confirm question at the SAME tier, never a stop', () => {
  const p = planNext([weak(1)]);
  assert.equal(p.done, false);
  assert.equal(p.next.tier, 0, 'confirm at the same tier');
});

test('weak run: never climbs, ends as confirmed breakdown — but never before 3 answers', () => {
  assert.equal(planNext([weak(1), weak(2)]).done, false, 'below the evidence floor the run continues');
  const done = planNext([weak(1), weak(2), weak(3)]);
  assert.equal(done.done, true);
  assert.equal(done.reason, 'breakdown');
  assert.ok(done.trace.every((t) => t.tier <= 1), 'a drowning candidate is never dragged up the ladder');
});

test('mixed run: strong then two weak = breakdown exactly at the evidence floor', () => {
  const done = planNext([strong(1), weak(3), weak(6)]);
  assert.equal(done.done, true);
  assert.equal(done.reason, 'breakdown');
});

test('mid answers settle the working level: tier exhausted at/above the floor ends the run', () => {
  const done = planNext([mid(1), mid(2), mid(3), mid(6)]);
  assert.equal(done.done, true);
  assert.equal(done.reason, 'tier_exhausted');
});

test('hard cap: a zigzag run ends at 7 answers no matter what', () => {
  const done = planNext([strong(1), weak(3), strong(6), weak(4), strong(7, { subord: true }), weak(5), mid(8)]);
  assert.equal(done.done, true);
  assert.equal(done.reason, 'cap');
  assert.equal(done.trace.length, 7);
});

test('unknown qid throws — a client can only answer questions this bank issued', () => {
  assert.throws(() => planNext([{ qid: 999, transcript: 'x' }]), /unknown_qid/);
});
