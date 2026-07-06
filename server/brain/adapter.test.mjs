// Bridge proof — adapter (profile → snapshot). Deterministic (fixed `now`). `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, masteredSkillsFromProfile } from './adapter.js';
import { decide } from './engine.js';

const NOW = 1_700_000_000_000;
const DAY = 86400000;

test('adapter: cold profile → no mastery, sessionCount 0, engine says NEW', () => {
  const snap = buildSnapshot({ sessions: [] }, NOW);
  assert.equal(snap.sessionCount, 0);
  assert.equal(snap.masteredSkills.length, 0);
  assert.equal(decide(snap).state, 'NEW');
});

test('adapter: a functional candidate bootstraps the foundation + flags unmeasured gates', () => {
  const p = {
    sessions: [
      { date: NOW - 2 * DAY, verdict: 'weak', wpm: 130, grammarRules: [{ ruleId: 'dativ-akkusativ', count: 2 }] },
      { date: NOW - 1 * DAY, verdict: 'pass', wpm: 130, grammarRules: [{ ruleId: 'dativ-akkusativ', count: 0 }] },
    ],
    weakLog: { 'dativ-akkusativ': { ruleId: 'dativ-akkusativ', errCounts: [{ count: 2 }, { count: 0 }], drills: [] } },
  };
  const m = masteredSkillsFromProfile(p);
  assert.ok(m.has('self-intro'));          // functional → foundation bootstrapped
  assert.ok(m.has('fluency-interrupt'));   // wpm ≥ 120 measured
  const snap = buildSnapshot(p, NOW);
  assert.ok(snap.unmeasuredGates.includes('intelligibility'));   // never measured → MEASURE, not guess
  assert.ok(snap.unmeasuredGates.includes('deescalation'));
  const d = decide(snap);
  assert.ok(d.journey && d.journey.entryTotal > 0);
  assert.ok(['POST_FIGHT', 'MEASURE', 'READY', 'PLATEAU', 'APPLY'].includes(d.state));
});

test('adapter: prepDone true when a drill-event landed after the last interview', () => {
  const p = {
    sessions: [{ date: NOW - 2 * DAY, verdict: 'weak' }],
    weakLog: { 'konjunktiv-2': { errCounts: [{ count: 3 }], drills: [{ at: NOW - 1 * DAY, drill: 'sag-es-richtig' }] } },
  };
  assert.equal(buildSnapshot(p, NOW).prepDone, true);
});

// Pins the lessons→brain wiring (ROADMAP #8): a finished Video-Lektion quiz posts
// {drill:'video-lektion'} to /api/drill-event, which lands either on the general drillLog (no
// rule matched) or on the rule's weakLog spine ('lt:'-keyed) — BOTH must read as prep, so the
// brain never re-prescribes a fix the learner just studied.
test('adapter: prepDone true from a video-lektion event on the general drillLog', () => {
  const p = {
    sessions: [{ date: NOW - 2 * DAY, verdict: 'weak' }],
    drillLog: [{ at: NOW - 1 * DAY, drill: 'video-lektion', correct: true }],
  };
  assert.equal(buildSnapshot(p, NOW).prepDone, true);
});

test('adapter: prepDone true from a rule-keyed video-lektion event, false when it predates the interview', () => {
  const keyed = {
    sessions: [{ date: NOW - 2 * DAY, verdict: 'weak' }],
    weakLog: { 'lt:Verb am Satzende nach „weil"': { ltName: 'Verb am Satzende nach „weil"', errCounts: [], drills: [{ at: NOW - 1 * DAY, drill: 'video-lektion', correct: true }] } },
  };
  assert.equal(buildSnapshot(keyed, NOW).prepDone, true);

  const stale = {
    sessions: [{ date: NOW - 1 * DAY, verdict: 'weak' }],
    drillLog: [{ at: NOW - 2 * DAY, drill: 'video-lektion', correct: true }],   // BEFORE the interview
  };
  assert.equal(buildSnapshot(stale, NOW).prepDone, false);
});

test('adapter: globalRegressed when total grammar errors rose last session', () => {
  const p = { sessions: [
    { date: NOW - 2 * DAY, grammarRules: [{ count: 2 }] },
    { date: NOW - 1 * DAY, grammarRules: [{ count: 5 }] },
  ] };
  assert.equal(buildSnapshot(p, NOW).globalRegressed, true);
});

// Pins the listeningStats SHAPE fix: listening.js writes PER-TYPE ({ verstehen:{seen,correct}, … }),
// never a flat {correct,total} — before the aggregation, listening mastery was unreachable forever.
test('adapter: per-type listeningStats aggregate into listening mastery', () => {
  const base = { sessions: [
    { date: NOW - 2 * DAY, verdict: 'pass' },
    { date: NOW - 1 * DAY, verdict: 'pass' },
  ] };
  const good = { ...base, listeningStats: { verstehen: { seen: 4, correct: 4 }, name: { seen: 2, correct: 2 } } };
  assert.ok(masteredSkillsFromProfile(good).has('listen-phone'));   // 6/6 ≥ 0.8 with ≥5 answered

  const weak = { ...base, listeningStats: { verstehen: { seen: 6, correct: 2 } } };
  assert.ok(!masteredSkillsFromProfile(weak).has('listen-phone')); // 2/6 < 0.8

  const thin = { ...base, listeningStats: { verstehen: { seen: 3, correct: 3 } } };
  assert.ok(!masteredSkillsFromProfile(thin).has('listen-phone')); // <5 answered → no claim
});

// Pins on-target prep (doctrine D3): with a targeted rule, only drills on THAT rule earn the
// rematch — a rep on a different rule no longer flips READY.
test('adapter: prepDone requires the drill to land on the targeted rule', () => {
  const offTarget = {
    sessions: [{ date: NOW - 2 * DAY, verdict: 'weak' }],
    lastTargetRule: { ruleId: 'dativ-akkusativ' },
    weakLog: {
      'dativ-akkusativ': { errCounts: [{ count: 3 }], drills: [] },
      'konjunktiv-2':    { errCounts: [{ count: 1 }], drills: [{ at: NOW - 1 * DAY, drill: 'sag-es-richtig' }] },
    },
  };
  assert.equal(buildSnapshot(offTarget, NOW).prepDone, false);

  const onTarget = {
    ...offTarget,
    weakLog: {
      'dativ-akkusativ': { errCounts: [{ count: 3 }], drills: [{ at: NOW - 1 * DAY, drill: 'sag-es-richtig' }] },
      'konjunktiv-2':    { errCounts: [{ count: 1 }], drills: [] },
    },
  };
  assert.equal(buildSnapshot(onTarget, NOW).prepDone, true);
});
