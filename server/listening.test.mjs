import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferSpeakerGender, makeVoicePicker, ITEMS, COMPREHENSION } from './listening.js';
import { LESSONS, LESSON_BY_RULE } from './lessons.config.js';
import { classifyGrammar } from './errorTags.js';

test('gender inference: named female callers never get a male voice (and vice versa)', () => {
  assert.equal(inferSpeakerGender('Guten Tag, hier ist Frau Schneider. Welche Kundennummer hat die Anruferin?'), 'f');
  assert.equal(inferSpeakerGender('Hier spricht Frau Öztürk.'), 'f');
  assert.equal(inferSpeakerGender('Worüber ärgert sich die Kundin?'), 'f');
  assert.equal(inferSpeakerGender('Welche Kundennummer nennt der Anrufer?'), 'm');
  assert.equal(inferSpeakerGender('Was verlangt der Kunde?'), 'm');
  assert.equal(inferSpeakerGender('Die Sendungsnummer ist eins zwei drei.'), null);
});

test('voice picker: a 5-item session gets 5 DIFFERENT German voices when genders are mixed', () => {
  const pick = makeVoicePicker();
  const voices = ['f', 'm', null, null, null].map((g) => pick(g));
  assert.equal(new Set(voices).size, 5, `expected 5 distinct voices, got ${voices.join(', ')}`);
  for (const v of voices) assert.match(v, /^aura-2-[a-z]+-de$/);
});

test('voice picker: gendered requests always come from the right pool', () => {
  const pick = makeVoicePicker();
  const FEMALE = new Set(['aura-2-elara-de', 'aura-2-viktoria-de', 'aura-2-aurelia-de', 'aura-2-kara-de', 'aura-2-lara-de']);
  const MALE   = new Set(['aura-2-julius-de', 'aura-2-fabian-de']);
  for (let i = 0; i < 8; i++) assert.ok(FEMALE.has(pick('f')));
  for (let i = 0; i < 8; i++) assert.ok(MALE.has(pick('m')));
});

test('detail pool: every item is well-formed and no question leaks its own answer in the hint', () => {
  assert.ok(ITEMS.length >= 38, `pool should have grown (have ${ITEMS.length})`);
  for (const it of ITEMS) {
    assert.ok(it.audioText.length >= 12 && it.question_de && it.answer, `malformed: ${it.audioText.slice(0, 40)}`);
    const hint = it.question_de.match(/z\. B\. ([0-9.,]+)/)?.[1];
    if (hint) assert.notEqual(hint, it.answer, `hint leaks the answer: ${it.question_de}`);
  }
});

test('comprehension pool: grown, options well-formed, correct index valid', () => {
  assert.ok(COMPREHENSION.length >= 18, `pool should have grown (have ${COMPREHENSION.length})`);
  for (const it of COMPREHENSION) {
    assert.ok(it.audioText.length >= 25 && it.q_de);
    assert.equal(it.opts.length, 4);
    assert.ok(it.opts.every((o) => o.de && o.ar));
    assert.ok(Number.isInteger(it.correct) && it.correct >= 0 && it.correct < 4);
  }
});

test('lessons: new L1-wall lessons exist, ids unique, every quiz is 3×4 with a valid correctIndex', () => {
  for (const id of ['verbstellung-nebensatz', 'perfekt', 'artikel-genus', 'wechselpraepositionen', 'konnektoren', 'indirekte-fragen', 'imperativ-sie', 'reflexive-verben']) {
    assert.ok(LESSON_BY_RULE[id], `missing lesson: ${id}`);
  }
  const ids = LESSONS.map((l) => l.ruleId);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ruleId');
  for (const l of LESSONS) {
    assert.equal(l.quiz.length, 3, `${l.ruleId}: quiz must be exactly 3 questions`);
    for (const q of l.quiz) {
      assert.equal(q.options.length, 4, `${l.ruleId}: each question needs 4 options`);
      assert.ok(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4);
      assert.ok(q.question_de);
    }
  }
});

test('errorTags: word-order and article errors now map to the REAL lessons', () => {
  const tag = (rule) => classifyGrammar([{ rule, count: 1 }])[0];
  assert.equal(tag('Verbstellung im Nebensatz'), 'verbstellung-nebensatz');
  assert.equal(tag('Falscher Artikel'), 'artikel-genus');
  assert.equal(tag('Partizip II falsch gebildet'), 'perfekt');
  assert.equal(tag('Konjunktiv fehlt'), 'konjunktiv-2');   // unchanged mappings still hold
});
