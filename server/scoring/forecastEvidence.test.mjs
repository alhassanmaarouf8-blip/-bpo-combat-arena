import test from 'node:test';
import assert from 'node:assert/strict';
import { FORECAST_EVIDENCE_FRESHNESS_MS, forecastEvidenceSummary,
  forecastGrammarRuleSummary } from './forecastEvidence.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function paceSession(date, wpm, overrides = {}) {
  return {
    sessionId: `session_${date}_${wpm}`,
    date,
    bossId: 'yasmin',
    targetRoleType: 'technical_support',
    targetIndustry: 'telecom',
    scenarioId: 'technical-outage',
    wpm,
    evidenceQuality: { version: 2, words: 120, prescriptionEligible: true },
    ...overrides,
  };
}

test('forecast evidence: two fresh exact-archetype deficits are high and expire after 14 days', () => {
  const sessions = [paceSession(NOW - DAY, 70), paceSession(NOW - 1_000, 75)];
  const summary = forecastEvidenceSummary({ sessions }, 'sustained_pace', sessions[1], NOW);
  assert.deepEqual(summary, {
    confidence: 'high', supportCount: 2, conflictCount: 0, referenceDeficit: true,
    expiresAt: NOW - 1_000 + FORECAST_EVIDENCE_FRESHNESS_MS,
    supportSessionIds: [sessions[0].sessionId, sessions[1].sessionId],
  });
});

test('forecast evidence: any same-window pass demotes repeated deficits', () => {
  const sessions = [paceSession(NOW - 3 * DAY, 70), paceSession(NOW - 2 * DAY, 110),
    paceSession(NOW - DAY, 75)];
  const summary = forecastEvidenceSummary({ sessions }, 'sustained_pace', sessions[2], NOW);
  assert.equal(summary.supportCount, 2);
  assert.equal(summary.conflictCount, 1);
  assert.equal(summary.confidence, 'medium');
});

test('forecast evidence: role, industry, scenario and boss changes never combine', () => {
  const latest = paceSession(NOW - 1_000, 70);
  const sessions = [
    paceSession(NOW - 4 * DAY, 60, { targetRoleType: 'customer_service' }),
    paceSession(NOW - 3 * DAY, 60, { targetIndustry: 'b2b' }),
    paceSession(NOW - 2 * DAY, 60, { scenarioId: 'billing-dispute' }),
    paceSession(NOW - DAY, 60, { bossId: 'tarek' }),
    latest,
  ];
  const summary = forecastEvidenceSummary({ sessions }, 'sustained_pace', latest, NOW);
  assert.equal(summary.supportCount, 1);
  assert.equal(summary.conflictCount, 0);
  assert.equal(summary.confidence, 'medium');
});

test('forecast evidence: vacancy and generic simulations remain separate', () => {
  const generic = paceSession(NOW - DAY, 60);
  const vacancy = paceSession(NOW - 1_000, 65, { vacancyTargetId: 'vacancy_exact' });
  const vacancySummary = forecastEvidenceSummary({ sessions: [generic, vacancy] },
    'sustained_pace', vacancy, NOW);
  const genericSummary = forecastEvidenceSummary({ sessions: [generic, vacancy] },
    'sustained_pace', generic, NOW);
  assert.equal(vacancySummary.supportCount, 1);
  assert.equal(genericSummary.supportCount, 1);
});

test('forecast evidence: observations older than 14 days and all v1 rows fail closed', () => {
  const old = paceSession(NOW - FORECAST_EVIDENCE_FRESHNESS_MS - 1, 60);
  const legacy = paceSession(NOW - DAY, 60, {
    evidenceQuality: { version: 1, words: 120, prescriptionEligible: true },
  });
  const latest = paceSession(NOW - 1_000, 65);
  const summary = forecastEvidenceSummary({ sessions: [old, legacy, latest] },
    'sustained_pace', latest, NOW);
  assert.equal(summary.supportCount, 1);
  assert.equal(summary.conflictCount, 0);
  assert.equal(summary.confidence, 'medium');
});

test('forecast evidence: a passing reference cannot be labeled a current rejection risk', () => {
  const previous = paceSession(NOW - DAY, 60);
  const latest = paceSession(NOW - 1_000, 110);
  const summary = forecastEvidenceSummary({ sessions: [previous, latest] },
    'sustained_pace', latest, NOW);
  assert.equal(summary.referenceDeficit, false);
  assert.equal(summary.confidence, 'insufficient');
});

test('forecast evidence: missing and duplicate packet identities fail closed', () => {
  const missingReference = paceSession(NOW - 1_000, 70, { sessionId: '' });
  assert.equal(forecastEvidenceSummary({ sessions: [missingReference] },
    'sustained_pace', missingReference, NOW).confidence, 'insufficient');

  const bound = paceSession(NOW - DAY, 70, { sessionId: 'bound' });
  const missing = paceSession(NOW - 1_000, 75, { sessionId: '' });
  const oneBound = forecastEvidenceSummary({ sessions: [bound, missing] }, 'sustained_pace', bound, NOW);
  assert.equal(oneBound.supportCount, 1);
  assert.equal(oneBound.confidence, 'medium');
  assert.deepEqual(oneBound.supportSessionIds, ['bound']);

  const duplicateA = paceSession(NOW - DAY, 70, { sessionId: 'duplicate' });
  const duplicateB = paceSession(NOW - 1_000, 75, { sessionId: 'duplicate' });
  const duplicated = forecastEvidenceSummary({ sessions: [duplicateA, duplicateB] },
    'sustained_pace', duplicateB, NOW);
  assert.equal(duplicated.confidence, 'insufficient');
  assert.deepEqual(duplicated.supportSessionIds, []);
});

test('grammar forecast counts only unique immutable session identities', () => {
  const grammar = (date, sessionId) => paceSession(date, 100, { sessionId, grammarMeasured: true,
    grammarRules: [{ ruleId: 'konjunktiv-2', count: 12 }],
    evidenceQuality: { version: 2, words: 120, eligibleWords: 120, prescriptionEligible: true } });
  const first = grammar(NOW - DAY, 'grammar-duplicate');
  const duplicate = grammar(NOW - 1_000, 'grammar-duplicate');
  const summary = forecastGrammarRuleSummary({ sessions: [first, duplicate] }, duplicate, NOW);
  assert.equal(summary.ruleId, null);
  assert.equal(summary.supportCount, 0);
  assert.deepEqual(summary.supportSessionIds, []);
});
