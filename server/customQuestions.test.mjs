import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVisionQuestions, sanitizeQuestions, MAX_QUESTIONS } from './customQuestions.js';
import { buildSessionScript } from './scenarios.js';

// ── parseVisionQuestions: honest extraction, NEVER fabricates ──────────────────────────────────
test('parses a clean JSON object into questions + note', () => {
  const r = parseVisionQuestions('{"questions":["Warum wollen Sie bei uns arbeiten?","Erzählen Sie von einem Konflikt."],"note":""}');
  assert.deepEqual(r.questions, ['Warum wollen Sie bei uns arbeiten?', 'Erzählen Sie von einem Konflikt.']);
  assert.equal(r.note, '');
});

test('strips a ```json fence', () => {
  const r = parseVisionQuestions('```json\n{"questions":["Was sind Ihre Stärken?"]}\n```');
  assert.deepEqual(r.questions, ['Was sind Ihre Stärken?']);
});

test('accepts a bare JSON array', () => {
  const r = parseVisionQuestions('["Wo sehen Sie sich in fünf Jahren?"]');
  assert.deepEqual(r.questions, ['Wo sehen Sie sich in fünf Jahren?']);
});

test('falls back to numbered/plain lines when not JSON', () => {
  const r = parseVisionQuestions('1. Warum Kundenservice?\n2. Wie gehen Sie mit Stress um?\n- Was motiviert Sie?');
  assert.deepEqual(r.questions, ['Warum Kundenservice?', 'Wie gehen Sie mit Stress um?', 'Was motiviert Sie?']);
});

test('no questions found → empty list, never invented', () => {
  assert.deepEqual(parseVisionQuestions('{"questions":[],"note":"Keine Fragen erkannt."}').questions, []);
  assert.deepEqual(parseVisionQuestions('').questions, []);
  assert.deepEqual(parseVisionQuestions('   ').questions, []);
  // junk OCR noise (single tokens, symbols) is not a question
  assert.deepEqual(parseVisionQuestions('{"questions":["x","--","OK"]}').questions, []);
});

test('caps the count at MAX_QUESTIONS', () => {
  const many = Array.from({ length: 30 }, (_, i) => `Frage Nummer ${i} über Ihre Motivation?`);
  const r = parseVisionQuestions(JSON.stringify({ questions: many }));
  assert.equal(r.questions.length, MAX_QUESTIONS);
});

test('de-duplicates near-identical questions (case/punctuation-insensitive)', () => {
  const r = parseVisionQuestions(JSON.stringify({ questions: [
    'Warum wollen Sie bei uns arbeiten?',
    'warum wollen sie bei uns arbeiten',
    'Was sind Ihre Stärken?',
  ] }));
  assert.deepEqual(r.questions, ['Warum wollen Sie bei uns arbeiten?', 'Was sind Ihre Stärken?']);
});

// ── sanitizeQuestions: the confirmed-set cleaner (save endpoint) ────────────────────────────────
test('sanitizeQuestions trims, drops empties/noise, caps length + count', () => {
  const out = sanitizeQuestions(['  Warum Sie?  ', '', '   ', 'a', 'Erzählen Sie von sich.']);
  assert.deepEqual(out, ['Warum Sie?', 'Erzählen Sie von sich.']);
  const longQ = 'Bitte erzählen Sie mir ausführlich '.repeat(20) + 'darüber?';
  assert.ok(sanitizeQuestions([longQ])[0].length <= 240);
});

test('sanitizeQuestions handles non-array input safely', () => {
  assert.deepEqual(sanitizeQuestions(null), []);
  assert.deepEqual(sanitizeQuestions(undefined), []);
  assert.deepEqual(sanitizeQuestions('nope'), []);
});

// ── buildSessionScript injection: custom set present → interview asks THOSE questions ────────────
const base = {
  persona: 'Du bist Herr Test, ein BPO-Interviewer.',
  displayName: 'Herr Test', greeting: 'Guten Tag.', levelId: 'b2', recent: {},
};

test('with customQuestions: instructions use the user questions, not the bank; stages reflect them', () => {
  const qs = ['Warum wollen Sie im Kundenservice arbeiten?', 'Erzählen Sie von einem schwierigen Kunden.', 'Was ist Ihre größte Stärke?'];
  const s = buildSessionScript({ ...base, customQuestions: qs });
  assert.match(s.instructions, /DIESES INTERVIEW — DIE FRAGEN/u, 'custom-mode marker present');
  for (const q of qs) assert.ok(s.instructions.includes(q), `instructions must include: ${q}`);
  assert.doesNotMatch(s.instructions, /TEIL 1 — SELBSTVORSTELLUNG/u, 'default three-part scaffold must be replaced');
  assert.deepEqual(s.stages.map((st) => st.prompt), qs, 'stages carry the custom questions in order');
  assert.equal(s.behavioral, qs[0]);
});

test('without customQuestions: the generic bank path is unchanged (three-part scaffold, no custom marker)', () => {
  const s = buildSessionScript({ ...base });
  assert.match(s.instructions, /TEIL 1 — SELBSTVORSTELLUNG/u);
  assert.doesNotMatch(s.instructions, /DIESES INTERVIEW — DIE FRAGEN/u);
  assert.equal(s.stages.length, 3);
  assert.ok(typeof s.behavioral === 'string' && s.behavioral.length > 0);
});

test('empty/whitespace customQuestions falls back to the generic path (never an empty interview)', () => {
  const s1 = buildSessionScript({ ...base, customQuestions: [] });
  assert.match(s1.instructions, /TEIL 1 — SELBSTVORSTELLUNG/u);
  const s2 = buildSessionScript({ ...base, customQuestions: ['   ', ''] });
  assert.match(s2.instructions, /TEIL 1 — SELBSTVORSTELLUNG/u);
});
