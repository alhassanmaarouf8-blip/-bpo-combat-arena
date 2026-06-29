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

test('adapter: globalRegressed when total grammar errors rose last session', () => {
  const p = { sessions: [
    { date: NOW - 2 * DAY, grammarRules: [{ count: 2 }] },
    { date: NOW - 1 * DAY, grammarRules: [{ count: 5 }] },
  ] };
  assert.equal(buildSnapshot(p, NOW).globalRegressed, true);
});
