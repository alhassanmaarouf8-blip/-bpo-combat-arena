/**
 * zielStelle.test.mjs — Ziel-Stelle matching (owner-approved 2026-07-10).
 *
 * The paid promise: an Elite candidate targeting a specific account TYPE gets roleplay scenarios
 * from that industry and a boss who frames the interview for it. These tests pin the mechanism:
 * industry-first unseen pick, honest fallbacks, and the BEWERBUNGSZIEL prompt line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS_SCENARIOS, INDUSTRIES, pickCsScenario, buildSessionScript } from './scenarios.js';

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
