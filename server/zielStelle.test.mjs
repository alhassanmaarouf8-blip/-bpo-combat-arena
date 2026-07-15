/**
 * zielStelle.test.mjs — Ziel-Stelle matching (owner-approved 2026-07-10).
 *
 * The paid promise: an Elite candidate targeting a specific account TYPE gets roleplay scenarios
 * from that industry and a boss who frames the interview for it. These tests pin the mechanism:
 * industry-first unseen pick, honest fallbacks, and the BEWERBUNGSZIEL prompt line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BEHAVIORAL_QUESTIONS, BPO_SCREENING_QUESTIONS, CS_SCENARIOS, INDUSTRIES,
  TARGET_ROLE_SCENARIOS, scenarioSupportsRole, pickCsScenario, pickTargetRoleScenario, buildSessionScript } from './scenarios.js';
import { PLANS } from './plans.config.js';

test('the plans that ADVERTISE Ziel-Stelle actually carry the flag (perk must never be a phantom again)', () => {
  assert.equal(PLANS.elite.zielStelle, true);
  assert.ok(!PLANS.free.zielStelle);
  assert.ok(!PLANS.basic.zielStelle);
  // 'Bis zum Job' one-time plan: owner-vetoed the same evening it shipped — the plan (and its
  // Ziel-Stelle perk) no longer exists. Pin the deletion so a future session can't resurrect it
  // without a fresh owner order.
  assert.equal(PLANS.job, undefined);
});

const byIndustry = (key) => CS_SCENARIOS.filter((s) => s.industry === key);

test('every tagged scenario uses a canonical INDUSTRIES key, and every industry has ≥1 scenario', () => {
  for (const s of CS_SCENARIOS) {
    if (s.industry !== undefined) assert.ok(INDUSTRIES[s.industry], `${s.id} has unknown industry "${s.industry}"`);
  }
  for (const key of Object.keys(INDUSTRIES)) {
    assert.ok(byIndustry(key).length >= 1, `industry "${key}" has no scenario — the promise would be empty`);
  }
});

test('target set → an unseen scenario from THAT industry is picked', () => {
  for (let i = 0; i < 20; i++) {
    const pick = pickCsScenario([], 'fintech');
    assert.equal(pick.item.industry, 'fintech');
    assert.equal(pick.reset, false);
  }
});

test('industry pool exhausted → falls back to global unseen (variety over repetition)', () => {
  const fintechIds = byIndustry('fintech').map((s) => s.id);
  for (let i = 0; i < 20; i++) {
    const pick = pickCsScenario(fintechIds, 'fintech');
    assert.ok(!fintechIds.includes(pick.id), `should not repeat a seen fintech scenario, got ${pick.id}`);
    assert.equal(pick.reset, false);
  }
});

test('EVERYTHING seen → cycles inside the target industry (reset)', () => {
  const allIds = CS_SCENARIOS.map((s) => s.id);
  for (let i = 0; i < 10; i++) {
    const pick = pickCsScenario(allIds, 'airline');
    assert.equal(pick.item.industry, 'airline');
    assert.equal(pick.reset, true);
  }
});

test('no target (or unknown key) → identical contract to the old global pick', () => {
  const seen = CS_SCENARIOS.slice(0, 5).map((s) => s.id);
  for (const target of [null, undefined, '', 'not-a-key']) {
    const pick = pickCsScenario(seen, target);
    assert.ok(pick.item && pick.id, `pick works for target=${String(target)}`);
    assert.ok(!seen.includes(pick.id), 'unseen-first still holds');
  }
});

test('prototype keys never validate or reach the prompt (reviewer-proven bypass)', () => {
  for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    // Picker: inherited key ⇒ treated as no-target (global pick), never an empty-pool crash.
    const pick = pickCsScenario([], evil);
    assert.ok(pick.item && pick.id, `picker survives target=${evil}`);
    // Prompt: no BEWERBUNGSZIEL line, and no Function source leaking into the boss brief.
    const script = buildSessionScript({
      persona: 'Du bist eine strenge Interviewerin.', displayName: 'Test', greeting: 'Guten Tag.',
      levelId: 'b2', recent: {}, sessionSeed: 's', targetIndustry: evil,
    });
    assert.ok(!script.instructions.includes('BEWERBUNGSZIEL'), `no ziel line for ${evil}`);
    assert.ok(!script.instructions.includes('native code'), `no Function source for ${evil}`);
  }
});

test('buildSessionScript with a target: scenario is industry-true + BEWERBUNGSZIEL line present', () => {
  const script = buildSessionScript({
    persona: 'Du bist eine strenge Interviewerin.', displayName: 'Test', greeting: 'Guten Tag.',
    levelId: 'b2', recent: {}, sessionSeed: 'seed-1', targetIndustry: 'telecom',
  });
  assert.equal(script.csScenario.industry, 'telecom');
  assert.ok(script.instructions.includes('BEWERBUNGSZIEL'), 'boss framing line injected');
  assert.ok(script.instructions.includes(INDUSTRIES.telecom), 'industry label reaches the prompt');
  assert.ok(script.instructions.includes('NIEMALS einen echten Firmennamen'), 'anonymity law restated');
});

test('buildSessionScript without a target: no BEWERBUNGSZIEL line, nothing else changes shape', () => {
  const script = buildSessionScript({
    persona: 'Du bist eine strenge Interviewerin.', displayName: 'Test', greeting: 'Guten Tag.',
    levelId: 'b2', recent: {}, sessionSeed: 'seed-1',
  });
  assert.ok(!script.instructions.includes('BEWERBUNGSZIEL'));
  assert.ok(script.csScenario && script.picks.cs.id, 'normal pick contract intact');
});

test('vacancy role pools are bounded and role-first, including after exhaustion', () => {
  for (const [roleType, pool] of Object.entries(TARGET_ROLE_SCENARIOS)) {
    assert.ok(pool.length >= 1, `${roleType} needs at least one scenario`);
    assert.ok(pool.every((scenario) => scenario.roleType === roleType));
    for (let i = 0; i < 20; i++) {
      assert.equal(pickTargetRoleScenario([], 'telecom', roleType).item.roleType, roleType);
      assert.equal(pickTargetRoleScenario(pool.map((scenario) => scenario.id), 'telecom', roleType).item.roleType, roleType);
    }
  }
});

test('a technical-support vacancy cannot receive a telecom cancellation scenario', () => {
  for (let i = 0; i < 20; i++) {
    const pick = pickTargetRoleScenario([], 'telecom', 'technical_support');
    assert.equal(pick.item.roleType, 'technical_support');
    assert.doesNotMatch(pick.id, /kuendigung|cancellation|price-increase/u);
  }
});

test('prototype vacancy roles fail closed to the legacy picker', () => {
  for (const roleType of ['__proto__', 'constructor', 'toString']) {
    const pick = pickTargetRoleScenario([], 'telecom', roleType);
    assert.ok(pick.item && pick.id);
    assert.equal(pick.item.roleType, undefined);
  }
});

test('targeted sales and backoffice sessions get exact roleplay rules, not the angry-customer script', () => {
  for (const [roleType, expected] of [['sales', /Bedarfsfrage/u], ['backoffice', /Datenkonflikt/u]]) {
    const script = buildSessionScript({
      persona: 'Du bist eine strenge Interviewerin.', displayName: 'Test', greeting: 'Guten Tag.',
      levelId: 'b2', recent: {}, sessionSeed: `role-${roleType}`, targetIndustry: 'b2b',
      jobContext: { roleType, germanLevel: 'b2', skillIds: [], questionTopicIds: [] },
    });
    assert.equal(script.csScenario.roleType, roleType);
    assert.match(script.instructions, expected);
    assert.doesNotMatch(script.instructions, /KUNDENSERVICE-ROLLENSPIEL|w\u00fctenden Kunden/u);
    assert.notEqual(script.stages[2].label, 'Kundenservice-Rollenspiel');
  }
});

test('targeted role content is valid German at runtime and registry-bound', () => {
  const serialized = JSON.stringify(TARGET_ROLE_SCENARIOS);
  assert.doesNotMatch(serialized, /Ã|â€|KÃ|fÃ|RÃ|nÃ/u);
  for (const [roleType, pool] of Object.entries(TARGET_ROLE_SCENARIOS)) {
    for (const scenario of pool) assert.equal(scenarioSupportsRole(scenario.id, roleType), true);
  }
  assert.equal(scenarioSupportsRole('telecom-kuendigung', 'technical_support'), false);
});

test('missing role-industry coverage uses a generic same-role case, never another industry', () => {
  for (const [roleType, pool] of Object.entries(TARGET_ROLE_SCENARIOS)) {
    const covered = new Set(pool.map((scenario) => scenario.industry).filter(Boolean));
    for (const industry of Object.keys(INDUSTRIES).filter((key) => !covered.has(key))) {
      const picked = pickTargetRoleScenario([], industry, roleType).item;
      assert.equal(picked.roleType, roleType);
      assert.equal(picked.industry, undefined);
    }
  }
});

test('matched retest can lock the exact server-known scenario without changing generic rotation', () => {
  const forced = CS_SCENARIOS[0];
  const script = buildSessionScript({
    persona: 'Du bist eine strenge Interviewerin.', displayName: 'Test', greeting: 'Guten Tag.',
    levelId: 'b2', recent: { cs: [forced.id] }, sessionSeed: 'matched-lock',
    forcedScenarioId: forced.id,
  });
  assert.equal(script.picks.cs.id, forced.id);
  assert.equal(script.csScenario.id, forced.id);
});

test('transfer retest excludes the baseline scenario inside every supported role', () => {
  const customerBaseline = CS_SCENARIOS[0].id;
  for (let index = 0; index < 20; index += 1) {
    assert.notEqual(pickCsScenario([], null, [customerBaseline]).id, customerBaseline);
  }
  for (const [roleType, pool] of Object.entries(TARGET_ROLE_SCENARIOS)) {
    assert.ok(pool.length >= 2, `${roleType} requires a genuinely novel transfer scenario`);
    const baseline = pool[0].id;
    for (let index = 0; index < 20; index += 1) {
      const pick = pickTargetRoleScenario([], pool[0].industry || null, roleType, [baseline]);
      assert.equal(pick.item.roleType, roleType);
      assert.notEqual(pick.id, baseline);
    }
  }
});

test('retention excludes post-cancellation billing and generic technical support has usable facts', () => {
  assert.equal(TARGET_ROLE_SCENARIOS.retention.some((scenario) => scenario.id === 'streaming-abbuchung'), false);
  const genericTechnical = TARGET_ROLE_SCENARIOS.technical_support.find((scenario) => scenario.industry === undefined);
  assert.ok(genericTechnical);
  assert.match(`${genericTechnical.problem} ${genericTechnical.opening}`, /WLAN|Update|Gerät|Router/u);
});

test('generic session output remains byte-identical to the verified pre-change contract', () => {
  const script = buildSessionScript({
    persona: 'PERSONA', displayName: 'Test', greeting: 'Guten Tag.', levelId: 'b2',
    recent: {
      behavioral: BEHAVIORAL_QUESTIONS.slice(0, -1),
      screening: BPO_SCREENING_QUESTIONS.slice(0, -1),
      cs: CS_SCENARIOS.slice(0, -1).map((scenario) => scenario.id),
    },
    sessionSeed: 'legacy-identity',
  });
  const digest = createHash('sha256').update(JSON.stringify(script)).digest('hex');
  assert.equal(digest, 'f20d99a85401388f5b06679ecec7ec042e9881f6036554e1591cc4ea44f5d139');
});
