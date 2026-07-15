// Bridge proof — adapter (profile → snapshot). Deterministic (fixed `now`). `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, latestVerifiedImprovementFromProfile, masteredSkillsFromProfile,
  verifiedMasteredSkillsFromProfile } from './adapter.js';
import { decide } from './engine.js';
import { speakingMeasurementForSkill } from '../scoring/speakingMeasurement.js';
import { BEHAVIORAL_QUESTIONS, BPO_SCREENING_QUESTIONS, CS_SCENARIOS,
  INTERVIEW_PROMPT_CONTRACT_VERSION, interviewPromptId } from '../scenarios.js';

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
  assert.equal(m.has('sie-register'), false,
    'completing interviews cannot stand in for observed formal-register transfer');
  assert.equal(m.has('handle-clear-request'), false,
    'completing interviews cannot stand in for observed request-handling transfer');
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

// The adapter surfaces recent drill events (with each event's rule identity) so the ENGINE can
// judge whether prep addressed the target — kind and rule both travel.
test('adapter: unbound v1 listening history never impersonates an adjudicated v2 cycle', () => {
  const sessions = [{ date: NOW - 2 * DAY, verdict: 'pass' }, { date: NOW - 1 * DAY, verdict: 'pass' }];
  const listeningAttempts = Array.from({ length: 15 }, (_, index) => ({
    attemptId: (index + 1).toString(16).padStart(24, '0'), skillId: 'listen-phone', kind: 'detail', type: 'nummer',
    itemHash: (index + 1).toString(16).padStart(64, '0'),
    correct: index < 2, plays: 2, playbackRate: 1.1, responseLatencyMs: 1500,
    issuedAt: NOW + (index < 5 ? 0 : index < 10 ? DAY + 10_000 : 8 * DAY + 20_000) + index * 1000,
    gradedAt: NOW + (index < 5 ? 0 : index < 10 ? DAY + 10_000 : 8 * DAY + 20_000) + index * 1000 + 500,
  }));
  const profile = { sessions, listeningStats: { verstehen: { seen: 100, correct: 100 } }, listeningAttempts };
  const mastered = masteredSkillsFromProfile(profile);
  assert.equal(mastered.has('listen-phone'), true, 'v1 rows remain historical and cannot become the new authority');
  assert.equal(mastered.has('listen-clear'), true, 'an unmeasured sibling skill keeps its temporary legacy state');
});

test('adapter: storage order cannot redefine the latest interview or its prep boundary', () => {
  const p = { sessions: [
    { date: NOW - DAY, verdict: 'pass', grammarRules: [{ count: 2 }] },
    { date: NOW - 3 * DAY, verdict: 'weak', grammarRules: [{ count: 5 }] },
  ], drillLog: [{ at: NOW - 2 * DAY, drill: 'flow-drill', correct: true }] };
  const snapshot = buildSnapshot(p, NOW);
  assert.equal(snapshot.daysSinceActive, 1);
  assert.equal(snapshot.prepDone, false, 'practice before the actual newest interview is not post-fight prep');
  assert.equal(snapshot.globalRegressed, false, 'the real chronological change is five errors down to two');
});

test('adapter: partial verified evidence does not demote a legacy learner before the packet is reliable', () => {
  const sessions = [{ date: NOW - 2 * DAY, verdict: 'pass' }, { date: NOW - 1 * DAY, verdict: 'pass' }];
  const listeningAttempts = Array.from({ length: 2 }, (_, index) => ({
    attemptId: (index + 10).toString(16).padStart(24, '0'), skillId: 'listen-phone', kind: 'detail', type: 'nummer',
    correct: false, plays: 2, playbackRate: 1.1, responseLatencyMs: 1500,
    issuedAt: NOW - DAY + index * 1000, gradedAt: NOW - DAY + index * 1000 + 500,
  }));
  const profile = { sessions, listeningStats: { verstehen: { seen: 10, correct: 10 } }, listeningAttempts };
  const mastered = masteredSkillsFromProfile(profile);
  assert.equal(mastered.has('listen-clear'), true);
  assert.equal(mastered.has('listen-phone'), true);
});

test('adapter: recentDrillEvents carry drill kind + rule identity, only post-fight events', () => {
  const p = {
    sessions: [{ date: NOW - 2 * DAY, verdict: 'weak' }],
    weakLog: {
      'konjunktiv-2': { ruleId: 'konjunktiv-2', errCounts: [{ count: 1 }],
        drills: [{ at: NOW - 1 * DAY, drill: 'sag-es-richtig' }, { at: NOW - 3 * DAY, drill: 'sag-es-richtig' }] },
    },
    drillLog: [{ at: NOW - 1 * DAY, drill: 'hoer-check' }],
  };
  const ev = buildSnapshot(p, NOW).recentDrillEvents;
  assert.equal(ev.length, 2);   // the pre-fight event is excluded
  assert.ok(ev.some((e) => e.drill === 'sag-es-richtig' && e.ruleId === 'konjunktiv-2'));
  assert.ok(ev.some((e) => e.drill === 'hoer-check' && e.ruleId === null));
});

test('adapter: criterion confidence counts only reliable sessions that measured that exact signal', () => {
  const reliable = (date, wpm, overrides = {}) => ({ sessionId: `criterion-${date}`, date, wpm, fluency: 45, fillers: 2, words: 120, grammarMeasured: true,
    grammarRules: [], subClauseRate: 0.3, vocabDiversity: 0.5, deescalation: 0.8, giveUpRate: 0.1,
    intelligibility: 0.9, latencyS: 2, targetRoleType: 'technical_support', targetIndustry: 'telecom',
    scenarioId: 'billing-dispute', bossId: 'yasmin',
    evidenceQuality: { version: 2, words: 120, prescriptionEligible: true }, ...overrides });
  const p = { sessions: [reliable(NOW - 2 * DAY, 70), reliable(NOW - DAY, 75),
    { ...reliable(NOW, 60), evidenceQuality: { version: 2, words: 120, prescriptionEligible: false } }] };
  const snap = buildSnapshot(p, NOW);
  assert.equal(snap.limitingCriterionId, 'sustained_pace');
  assert.equal(snap.limitingEvidenceCount, 2);
  assert.equal(decide(snap).confidence, 'high');
});

test('adapter: a passing session does not impersonate repeated evidence for a later pace deficit', () => {
  const reliable = (date, wpm) => ({ sessionId: `passing-${date}`, date, wpm, fluency: 45, fillers: 2, words: 120, grammarMeasured: true,
    grammarRules: [], subClauseRate: 0.3, vocabDiversity: 0.5, deescalation: 0.8, giveUpRate: 0.1,
    intelligibility: 0.9, latencyS: 2, targetRoleType: 'technical_support', targetIndustry: 'telecom',
    scenarioId: 'billing-dispute', bossId: 'yasmin',
    evidenceQuality: { version: 2, words: 120, prescriptionEligible: true } });
  const snapshot = buildSnapshot({ sessions: [reliable(NOW - DAY, 130), reliable(NOW, 55)] }, NOW);
  assert.equal(snapshot.limitingCriterionId, 'sustained_pace');
  assert.equal(snapshot.limitingEvidenceCount, 1);
  assert.equal(decide(snapshot).confidence, 'low');
});

test('adapter: a same-window pass vetoes high confidence even when two exact deficits exist', () => {
  const reliable = (date, wpm) => ({ sessionId: `conflict-${date}`, date, wpm, fluency: 45, fillers: 2, words: 120, grammarMeasured: true,
    grammarRules: [], subClauseRate: 0.3, vocabDiversity: 0.5, giveUpRate: 0.1,
    intelligibility: 0.9, latencyS: 2, targetRoleType: 'technical_support', targetIndustry: 'telecom',
    scenarioId: 'billing-dispute', bossId: 'yasmin',
    evidenceQuality: { version: 2, words: 120, prescriptionEligible: true } });
  const snapshot = buildSnapshot({ sessions: [
    reliable(NOW - 3 * DAY, 70), reliable(NOW - 2 * DAY, 130), reliable(NOW - DAY, 75),
  ] }, NOW);
  assert.equal(snapshot.limitingEvidenceCount, 2);
  assert.equal(snapshot.limitingEvidenceConflictCount, 1);
  assert.equal(decide(snapshot).confidence, 'low');
});

test('adapter: deficits from a different interview archetype cannot raise criterion confidence', () => {
  const reliable = (date, scenarioId) => ({ sessionId: `archetype-${date}`, date, wpm: 60, fluency: 45, fillers: 2, words: 120,
    grammarMeasured: true, grammarRules: [], subClauseRate: 0.3, vocabDiversity: 0.5,
    deescalation: 0.8, giveUpRate: 0.1, intelligibility: 0.9, latencyS: 2,
    targetRoleType: 'technical_support', targetIndustry: 'telecom', scenarioId, bossId: 'yasmin',
    evidenceQuality: { version: 2, words: 120, prescriptionEligible: true } });
  const snapshot = buildSnapshot({ sessions: [
    reliable(NOW - DAY, 'technical-outage'), reliable(NOW, 'billing-dispute'),
  ] }, NOW);
  assert.equal(snapshot.limitingCriterionId, 'sustained_pace');
  assert.equal(snapshot.limitingEvidenceCount, 1);
  assert.equal(decide(snapshot).confidence, 'low');
});

test('adapter: v1 deficits cannot authorize v2 forecast confidence after migration', () => {
  const reliable = (date, wpm, version) => ({ sessionId: `migration-${date}-${version}`, date, wpm, fluency: 45, fillers: 2, words: 120,
    grammarMeasured: true, grammarRules: [], subClauseRate: 0.3, vocabDiversity: 0.5,
    deescalation: 0.8, giveUpRate: 0.1, intelligibility: 0.9, latencyS: 2,
    targetRoleType: 'technical_support', targetIndustry: 'telecom', scenarioId: 'billing-dispute', bossId: 'yasmin',
    evidenceQuality: { version, words: 120, eligibleWords: 120, prescriptionEligible: true } });
  const snapshot = buildSnapshot({ sessions: [
    reliable(NOW - 2 * DAY, 55, 1), reliable(NOW - DAY, 60, 1), reliable(NOW, 58, 2),
  ] }, NOW);
  assert.equal(snapshot.limitingCriterionId, 'sustained_pace');
  assert.equal(snapshot.limitingEvidenceCount, 1);
  assert.equal(decide(snapshot).confidence, 'low');
});

test('non-customer-service roles do not enter an impossible deescalation measurement loop', () => {
  const p = { sessions: [{ date: NOW - DAY, targetRoleType: 'technical_support',
    scenarioId: 'telecom-portierung', targetIndustry: 'telecom', wpm: 120, intelligibility: 0.8,
    words: 120, fillers: 2, grammarMeasured: true, grammarRules: [], subClauseRate: 0.3,
    vocabDiversity: 0.5, giveUpRate: 0.1, latencyS: 2,
    evidenceQuality: { version: 2, words: 120, prescriptionEligible: true } }] };
  const snapshot = buildSnapshot(p, NOW);
  assert.equal(snapshot.roleMeasurementState, 'role_criterion_not_yet_validated');
  assert.equal(snapshot.unmeasuredGates.includes('deescalation'), false);
  assert.notEqual(decide(snapshot).prescription?.signal, 'deescalation');
});

test('adapter: only delayed transfer proof enters readiness-authorizing mastery', () => {
  const reliable = (sessionId, date, count, scenarioId, novel = false) => ({
    sessionId, date, verdict: 'pass', level: 'a2-b1', bossId: 'yasmin', targetRoleType: 'customer_service', scenarioId,
    grammarMeasured: true, grammarRules: [{ ruleId: 'word-order-sub', count }],
    evidenceQuality: { version: 2, words: 120, prescriptionEligible: true },
    speakingTaskContract: {
      version: 1, promptContractVersion: INTERVIEW_PROMPT_CONTRACT_VERSION, assessmentMode: 'diagnostic',
      levelId: 'a2-b1', bossId: 'yasmin', roleType: 'customer_service', scenarioId,
      behavioralPromptId: interviewPromptId('behavioral', BEHAVIORAL_QUESTIONS[novel ? 1 : 0], 'a2-b1'),
      screeningPromptId: interviewPromptId('screening', BPO_SCREENING_QUESTIONS[novel ? 1 : 0], 'a2-b1'),
      industryKey: null, targetId: null, contentSeed: 'stable-comparison-seed', mood: 'neutral',
      replayContext: { dossier: '', memory: '', focusTitle: '' },
    },
  });
  const sessions = [reliable('live-baseline', NOW - 3 * DAY, 4, CS_SCENARIOS[0].id),
    reliable('live-matched', NOW - 2 * DAY, 2, CS_SCENARIOS[0].id),
    reliable('live-transfer', NOW - DAY, 1, CS_SCENARIOS[1].id, true)];
  const shell = { sessions };
  const baseline = speakingMeasurementForSkill(shell, 'word-order-sub', { sessionId: 'live-baseline' });
  const matched = speakingMeasurementForSkill(shell, 'word-order-sub', { sessionId: 'live-matched' });
  const transfer = speakingMeasurementForSkill(shell, 'word-order-sub', { sessionId: 'live-transfer' });
  const matchedProof = {
    id: 'aaaaaaaaaaaaaaaa', prescriptionId: '2222222222222222', skillId: 'word-order-sub', metricKey: 'grammar_errors',
    phase: 'matched', status: 'improved', before: baseline.value, after: matched.value, verifiedAt: matched.measuredAt + 100,
    measuredAt: matched.measuredAt, measurementEvidenceId: matched.evidenceId, retestSessionId: matched.sourceSessionId,
    baselineSessionId: baseline.sourceSessionId, baselineMeasurementEvidenceId: baseline.evidenceId,
    comparedValue: baseline.value, comparedMeasurementEvidenceId: baseline.evidenceId, comparedRetestSessionId: baseline.sourceSessionId,
    contextId: matched.contextId, noveltyId: matched.noveltyId,
    comparedContextId: baseline.contextId, comparedNoveltyId: baseline.noveltyId,
  };
  const proof = (overrides = {}) => ({
    id: '1111111111111111', prescriptionId: '2222222222222222', measurementEvidenceId: transfer.evidenceId,
    retestSessionId: transfer.sourceSessionId, skillId: 'word-order-sub', metricKey: 'grammar_errors',
    contextId: transfer.contextId, noveltyId: transfer.noveltyId,
    comparedContextId: matched.contextId, comparedNoveltyId: matched.noveltyId,
    baselineSessionId: baseline.sourceSessionId, baselineMeasurementEvidenceId: baseline.evidenceId,
    comparedValue: matched.value, comparedMeasurementEvidenceId: matched.evidenceId,
    comparedRetestSessionId: matched.sourceSessionId, comparedProofId: matchedProof.id,
    phase: 'transfer', status: 'improved', before: baseline.value, after: transfer.value,
    measuredAt: transfer.measuredAt, verifiedAt: NOW, ...overrides,
  });
  const p = { sessions, salmaCoach: { coachState: { improvementHistory: [
    matchedProof,
    proof({ id: '5555555555555555', status: 'held' }),
    proof(),
    proof({ id: '6666666666666666', skillId: '__proto__' }),
    proof({ id: '7777777777777777', before: 0, after: 1 }),
    proof({ id: '8888888888888888', verifiedAt: NOW + DAY }),
    proof({ id: '9999999999999999', after: 150 }),
  ] } } };
  const provisional = masteredSkillsFromProfile(p);
  const verified = verifiedMasteredSkillsFromProfile(p, NOW);
  assert.equal(provisional.has('self-intro'), true);
  assert.deepEqual([...verified], ['word-order-sub']);
  const snapshot = buildSnapshot(p, NOW);
  assert.equal(snapshot.masteredSkills.includes('self-intro'), true);
  assert.deepEqual(snapshot.verifiedMasteredSkills, ['word-order-sub']);
  assert.deepEqual(latestVerifiedImprovementFromProfile(p, NOW), {
    skillId: 'word-order-sub', metricKey: 'grammar_errors', before: baseline.value, after: transfer.value,
    direction: 'lower', phase: 'transfer', verifiedAt: NOW,
  });
  assert.deepEqual(snapshot.verifiedImprovement, latestVerifiedImprovementFromProfile(p, NOW));
  const replayedContext = { ...p, salmaCoach: { coachState: { improvementHistory: [
    proof({ noveltyId: '777777777777' }),
  ] } } };
  assert.deepEqual([...verifiedMasteredSkillsFromProfile(replayedContext, NOW)], [],
    'the same roleplay novelty identity cannot authorize mastery');
});

// Pins on-target prep (doctrine D3) at the ENGINE: with a concrete target, a drill event earns
// READY only if it hit the targeted rule OR came from the target's prescribed drill — an
// unrelated rep (shadowing for a dative target) stays POST_FIGHT even when legacy prepDone=true.
test('engine: READY only for on-target prep (rule match or prescribed-drill match)', () => {
  const snap = {
    masteredSkills: ['praesens-perfekt', 'self-intro', 'core-vocab', 'listen-clear'],
    weakLog: { 'dativ-akkusativ': { errCounts: [{ count: 3 }, { count: 2 }], drills: [] } },
    limitingSkill: 'grammar',
    unmeasuredGates: [],
    sessionCount: 3,
    daysSinceActive: 0,
    globalRegressed: false,
    prepDone: true,   // the loose legacy signal says yes — the engine must still refuse off-target prep
    recentDrillEvents: [{ drill: 'shadowing', ruleId: null }],
  };
  const off = decide(snap);
  assert.equal(off.target?.skillId, 'dativ-akkusativ');
  assert.equal(off.state, 'POST_FIGHT');   // off-target rep does NOT earn the rematch

  const ruleMatched = decide({ ...snap, recentDrillEvents: [{ drill: 'sag-es-richtig', ruleId: 'dativ-akkusativ' }] });
  assert.equal(ruleMatched.state, 'READY');

  const kindMatched = decide({ ...snap, recentDrillEvents: [{ drill: 'sag-es-richtig', ruleId: null }] });
  assert.equal(kindMatched.state, 'READY');  // a rule-less event from the PRESCRIBED drill counts
});
