import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidates, selectBottleneck, updatePriorStatuses, persistenceMultiplier,
  masteryDampener, CLOSED_DAMPENER_DAYS } from './bottleneckSelector.js';

const DAY = 24 * 60 * 60 * 1000;
const ev = (code, sessionId, { severity = 3, impact = 2, quote = 'weil ich habe Zeit', corrected = 'weil ich Zeit habe' } = {}) => {
  const [category, subcode] = code.split('/');
  return { at: 0, sessionId, turnIndex: 1, category, subcode, code, severity, impact, quote, corrected };
};

test('score = freq × sev × imp × persistence ÷ dampener; recurring beats one-off', () => {
  const today = [
    ev('VERB_POSITION/verb_am_ende_nach_weil', 's3'), ev('VERB_POSITION/verb_am_ende_nach_weil', 's3'),
    ev('KASUS/praeposition_mit_dativ', 's3'), ev('KASUS/praeposition_mit_dativ', 's3'),
  ];
  const history = [ev('VERB_POSITION/verb_am_ende_nach_weil', 's1'), ev('VERB_POSITION/verb_am_ende_nach_weil', 's2')];
  const scored = scoreCandidates({ todayEvents: today, historyEvents: history, sessionId: 's3', level: 'b2' });
  assert.equal(scored[0].code, 'VERB_POSITION/verb_am_ende_nach_weil');   // same today-stats, but persistent
  assert.equal(scored[0].persistence, 2);                                  // 1 + 0.5×2
  assert.equal(scored[0].score, 2 * 3 * 2 * 2);                            // 24
  assert.equal(scored[1].score, 2 * 3 * 2 * 1);                            // 12
});

test('persistenceMultiplier caps at ×3', () => {
  assert.equal(persistenceMultiplier(0), 1);
  assert.equal(persistenceMultiplier(4), 3);
  assert.equal(persistenceMultiplier(99), 3);
});

test('masteryDampener: recently-closed ×2, drilled-and-improved ×1.5, expired closure ×1', () => {
  const now = 100 * DAY;
  const closedFresh = [{ code: 'X/y', status: 'closed', closedAt: now - 3 * DAY }];
  const closedStale = [{ code: 'X/y', status: 'closed', closedAt: now - (CLOSED_DAMPENER_DAYS + 1) * DAY }];
  const drilledBetter = [{ code: 'X/y', status: 'drilled', frequencyToday: 4 }];
  assert.equal(masteryDampener('X/y', closedFresh, 3, now), 2);
  assert.equal(masteryDampener('X/y', closedStale, 3, now), 1);
  assert.equal(masteryDampener('X/y', drilledBetter, 2, now), 1.5);   // 4 → 2 = halved
  assert.equal(masteryDampener('X/y', drilledBetter, 3, now), 1);     // not halved yet
});

test('drilled-and-improved code visibly drops below an untreated equal (acceptance §3)', () => {
  const today = [ev('KASUS/a', 's2'), ev('KASUS/a', 's2'), ev('TEMPUS/b', 's2'), ev('TEMPUS/b', 's2')];
  const records = [{ code: 'KASUS/a', status: 'drilled', frequencyToday: 4 }];
  const scored = scoreCandidates({ todayEvents: today, priorRecords: records, sessionId: 's2', level: 'b2' });
  assert.equal(scored[0].code, 'TEMPUS/b');
  assert.equal(scored.find((c) => c.code === 'KASUS/a').dampener, 1.5);
});

test('tie-break: level-appropriate wins over far-above-level at equal score', () => {
  const today = [ev('WORTSCHATZ_PRAEZISION/praeziser_ausdruck', 's1'), ev('ADJ_ENDUNG/nach_artikel', 's1')];
  const scored = scoreCandidates({ todayEvents: today, sessionId: 's1', level: 'a2-b1' });
  assert.equal(scored[0].code, 'ADJ_ENDUNG/nach_artikel');   // WORTSCHATZ needs ≥ b2
  assert.equal(scored[0].levelFit, true);
  assert.equal(scored[1].levelFit, false);
});

test('selectBottleneck: exactly one record with evidence quotes, runner-ups and an honest why', () => {
  const today = [
    ev('VERB_POSITION/verb_am_ende_nach_weil', 's1'), ev('VERB_POSITION/verb_am_ende_nach_weil', 's1'),
    ev('KASUS/praeposition_mit_dativ', 's1'), ev('ADJ_ENDUNG/nach_artikel', 's1'),
  ];
  const rec = selectBottleneck({ todayEvents: today, sessionId: 's1', cairoDay: '2026-07-20',
    now: 1, level: 'b2', answersAnalyzed: 8 });
  assert.equal(rec.status, 'open');
  assert.equal(rec.code, 'VERB_POSITION/verb_am_ende_nach_weil');
  assert.ok(rec.evidenceQuotes.length >= 1 && rec.evidenceQuotes[0].quote);
  assert.equal(rec.runnerUps.length, 2);
  assert.match(rec.why, /Verbstellung/);
  assert.match(rec.why, /Gewählt vor/);
  assert.equal(rec.repeat, false);
  assert.equal(rec.dayStreak, 1);
});

test('repeat-day: same dominant code selected again → repeat flagged, streak grows on a NEW day, exercise history carried', () => {
  const mk = (sid, day, records) => selectBottleneck({
    todayEvents: [ev('VERB_POSITION/x', sid), ev('VERB_POSITION/x', sid)],
    sessionId: sid, cairoDay: day, now: 1, level: 'b2', answersAnalyzed: 8, records,
  });
  const day1 = mk('s1', '2026-07-20', []);
  day1.exerciseHistory = ['ex-1'];                       // Phase 4 would have appended this
  const day2 = mk('s2', '2026-07-21', [day1]);
  assert.equal(day2.repeat, true);
  assert.equal(day2.dayStreak, 2);
  assert.deepEqual(day2.exerciseHistory, ['ex-1']);      // generation call gets the history
  const sameDayAgain = mk('s3', '2026-07-21', [day1, day2]);
  assert.equal(sameDayAgain.repeat, true);
  assert.equal(sameDayAgain.dayStreak, 2);               // streak counts DAYS, not sessions
});

test('updatePriorStatuses: closes at ≤1 occurrence with no high severity; drilled→retested otherwise', () => {
  const records = [
    { code: 'VERB_POSITION/x', status: 'open' },
    { code: 'KASUS/y', status: 'drilled' },
    { code: 'TEMPUS/z', status: 'open' },
  ];
  const today = [
    ev('KASUS/y', 's9'), ev('KASUS/y', 's9'),                       // still 2× → not closed, drilled→retested
    ev('TEMPUS/z', 's9', { severity: 5 }),                          // 1× but severity 5 → stays open
  ];                                                                 // VERB_POSITION absent → closed
  updatePriorStatuses(records, today, { sessionId: 's9', now: 7 });
  assert.equal(records[0].status, 'closed');
  assert.equal(records[0].closedBySessionId, 's9');
  assert.equal(records[1].status, 'retested');
  assert.equal(records[2].status, 'open');
});

test('near-perfect interview: polish fallback, never "nothing to train"', () => {
  const rec = selectBottleneck({ todayEvents: [], sessionId: 's1', cairoDay: 'd', now: 1,
    level: 'b2', answersAnalyzed: 8, aggregates: { fillerCount: 0 }, metrics: { wpm: 150 },
    answers: [{ original: 'Ich habe drei Jahre in einer Firma gearbeitet und dabei viel gelernt.' }] });
  assert.equal(rec.fallback, true);
  assert.equal(rec.category, 'ANTWORT_STRUKTUR');
  assert.ok(rec.why.length > 10);
  const fillers = selectBottleneck({ todayEvents: [], sessionId: 's1', cairoDay: 'd', now: 1,
    level: 'b2', answersAnalyzed: 8, aggregates: { fillerCount: 5 }, metrics: {}, answers: [] });
  assert.equal(fillers.category, 'FUELLWOERTER');
});

test('very short interview: low_confidence set, persistent history code beats thin today-noise', () => {
  const history = [
    ev('VERB_POSITION/x', 's1', { severity: 4, impact: 3 }), ev('VERB_POSITION/x', 's1', { severity: 4, impact: 3 }),
    ev('VERB_POSITION/x', 's2', { severity: 4, impact: 3 }), ev('VERB_POSITION/x', 's2', { severity: 4, impact: 3 }),
  ];
  const rec = selectBottleneck({
    todayEvents: [ev('PLURAL/schwacher_plural', 's3', { severity: 1, impact: 1 })],
    historyEvents: history, sessionId: 's3', cairoDay: 'd', now: 1, level: 'b2',
    answersAnalyzed: 1, wordsSpoken: 12,
  });
  assert.equal(rec.lowConfidence, true);
  assert.equal(rec.code, 'VERB_POSITION/x');
  assert.equal(rec.source, 'history');
});
