import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExerciseSet, computePlan, historyEntries, fallbackSet, STAGE2_REPS } from './exerciseGenerator.js';
import { gradeStage2, gradeStage3, targetCoverage, isComplete, sanitizedSet, allItems } from './personalStep.js';

const GOOD = {
  title_de: 'Verb ans Ende im Nebensatz', title_ar: 'x',
  stage1: [
    { faulty: 'weil ich habe viel Erfahrung mit Kunden', corrected: 'weil ich viel Erfahrung mit Kunden habe', why_de: 'a', why_ar: 'b' },
    { faulty: 'dass ich bin sehr geduldig', corrected: 'dass ich sehr geduldig bin', why_de: 'a', why_ar: 'b' },
    { faulty: 'weil die Team ist sehr gut', corrected: 'weil das Team sehr gut ist', why_de: 'a', why_ar: 'b' },
    { faulty: 'obwohl ich habe wenig Zeit', corrected: 'obwohl ich wenig Zeit habe', why_de: 'a', why_ar: 'b' },
  ],
  stage2: [
    { instruction_de: 'Sag es korrekt', instruction_ar: '', prompt: 'weil ich habe viel Erfahrung mit Kunden', target: 'weil ich viel Erfahrung mit Kunden habe', why_de: 'a', why_ar: 'b' },
    { instruction_de: 'Sag es korrekt', instruction_ar: '', prompt: 'dass ich bin sehr geduldig', target: 'dass ich sehr geduldig bin', why_de: 'a', why_ar: 'b' },
    { instruction_de: 'Transformiere', instruction_ar: '', prompt: 'Ich löse das Problem heute.', target: 'Ich verspreche, dass ich das Problem heute löse.', why_de: 'a', why_ar: 'b' },
  ],
  stage3: [
    { frage: 'Warum sollten wir Sie einstellen?', must_use_de: 'Nebensatz mit weil, Verb am Ende', must_use_ar: '',
      indicator_tokens: ['weil', 'habe'], why_de: 'a', why_ar: 'b' },
  ],
};
const EVIDENCE = [{ quote: 'weil ich habe viel Erfahrung mit Kunden', corrected: 'weil ich viel Erfahrung mit Kunden habe' }];

test('validateExerciseSet: accepts a full grounded ladder, assigns ids + reps', () => {
  const set = validateExerciseSet(structuredClone(GOOD), { evidence: EVIDENCE });
  assert.ok(set);
  assert.equal(set.stage1.length, 4);
  assert.equal(set.stage2.length, 3);
  assert.equal(set.stage3.length, 1);
  assert.equal(set.stage2[0].reps, STAGE2_REPS);
  assert.equal(set.grounded, true);
  const plan = computePlan(set);
  assert.ok(plan.totalReps >= 4 + 9 + 1);
  assert.ok(plan.estMinutes >= 3);
});

test('validateExerciseSet: rejects identical corrections, thin stages, missing indicators', () => {
  const bad = structuredClone(GOOD);
  bad.stage1 = bad.stage1.map((i) => ({ ...i, corrected: i.faulty }));   // non-corrections
  assert.equal(validateExerciseSet(bad, {}), null);
  const noStage3 = structuredClone(GOOD);
  noStage3.stage3 = [{ frage: 'x?', indicator_tokens: [], why_de: '', why_ar: '' }];
  assert.equal(validateExerciseSet(noStage3, {}), null);
});

test('novelty guard: items reused from exerciseHistory are dropped (repeat day → different set)', () => {
  const history = [GOOD.stage1[0].faulty];
  const set = validateExerciseSet(structuredClone(GOOD), { evidence: EVIDENCE, exerciseHistory: history });
  assert.ok(set);
  assert.equal(set.stage1.length, 3);   // the reused item is gone, the rest survive
  assert.ok(!set.stage1.some((i) => i.faulty === GOOD.stage1[0].faulty));
});

test('novelty guard: too much reuse starves the set → invalid (forces retry)', () => {
  const history = [GOOD.stage1[0].faulty, GOOD.stage1[1].faulty, GOOD.stage1[2].faulty];
  assert.equal(validateExerciseSet(structuredClone(GOOD), { exerciseHistory: history }), null);
});

test('fallbackSet: Stage-2-only from stored corrections, never empty when corrections exist', () => {
  const fb = fallbackSet({ bottleneck: { category: 'VERB_POSITION' }, evidence: EVIDENCE });
  assert.ok(fb);
  assert.equal(fb.fallback, true);
  assert.equal(fb.stage1.length, 0);
  assert.equal(fb.stage2.length, 1);
  assert.equal(fb.stage2[0].target, EVIDENCE[0].corrected);
  assert.ok(fb.totalReps > 0);
  assert.equal(fallbackSet({ bottleneck: { category: 'X' }, evidence: [] }), null);
});

test('historyEntries flattens the set for the novelty ledger', () => {
  const set = validateExerciseSet(structuredClone(GOOD), { evidence: EVIDENCE });
  const h = historyEntries(set);
  assert.ok(h.includes(GOOD.stage1[0].faulty));
  assert.ok(h.includes(GOOD.stage2[2].target));
  assert.ok(h.includes(GOOD.stage3[0].frage));
});

test('gradeStage2: lenient token coverage — STT noise elsewhere cannot fail a correct production', () => {
  assert.equal(gradeStage2('weil ich viel Erfahrung mit Kunden habe', 'äh weil ich viel erfahrung mit kunden habe genau'), true);
  assert.equal(gradeStage2('weil ich viel Erfahrung mit Kunden habe', 'weil ich viele erfahrung mit kunde habe'), true);   // 1-edit tolerant
  assert.equal(gradeStage2('weil ich viel Erfahrung mit Kunden habe', 'ich habe keine Ahnung'), false);
});

test('gradeStage3: indicator token OR sustained substantive answer earns credit', () => {
  assert.equal(gradeStage3(['weil', 'habe'], 'Sie sollten mich nehmen weil ich Erfahrung habe', 5000), true);
  assert.equal(gradeStage3(['weil'], 'kurz', 1000), false);
  const long = Array.from({ length: 20 }, (_, i) => `wort${i}`).join(' ');
  assert.equal(gradeStage3(['weil'], long, 15000), true);   // credit-only sustained fallback
});

test('completion: all reps across all stages required; sanitized view hides solutions', () => {
  const set = validateExerciseSet(structuredClone(GOOD), { evidence: EVIDENCE });
  const step = { sessionId: 'sess', set, progress: {}, attempts: {} };
  assert.equal(isComplete(step), false);
  for (const i of allItems(set)) step.progress[i.id] = i.reps;
  assert.equal(isComplete(step), true);
  const view = sanitizedSet(step);
  assert.ok(view.stage1[0].options.length === 2);
  assert.equal(view.stage1[0].faulty, undefined);
  assert.equal(view.stage1[0].corrected, undefined);
  assert.equal(view.stage3[0].must_use_de, undefined);      // covert until answered
  assert.equal(view.stage3[0].indicator_tokens, undefined);
});
