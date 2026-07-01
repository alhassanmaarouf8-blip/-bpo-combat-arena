import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksTruncatedDE, sessionSubstance } from './turnQuality.js';

test('truncated: the owner\'s real cut-off fragments are flagged', () => {
  // straight from the reported broken interview
  assert.equal(looksTruncatedDE('das war mit Python. Wir haben'), true);   // ends on hanging aux "haben"
  assert.equal(looksTruncatedDE('Wir haben'), true);
  assert.equal(looksTruncatedDE('Ich habe'), true);
  assert.equal(looksTruncatedDE('das war Kundendienst, das war Ja, also IT, das war mit'), true); // ends on prep "mit"
  assert.equal(looksTruncatedDE('und dann habe ich'), true);
  assert.equal(looksTruncatedDE('weil'), true);
});

test('complete: normal finished answers are NOT flagged (no false critique)', () => {
  assert.equal(looksTruncatedDE('Ich habe drei Jahre im Kundenservice gearbeitet.'), false);
  assert.equal(looksTruncatedDE('Ich habe drei Jahre im Kundenservice gearbeitet'), false); // STT often drops the period
  assert.equal(looksTruncatedDE('Guten Tag.'), false);
  assert.equal(looksTruncatedDE('Ich heiße Alhassan und bin vierundzwanzig Jahre alt.'), false);
  assert.equal(looksTruncatedDE('Mein Name ist Karim Hassan'), false);
});

test('complete: bare interjections are finished replies, not scraps', () => {
  assert.equal(looksTruncatedDE('Ja'), false);
  assert.equal(looksTruncatedDE('Nein'), false);
  assert.equal(looksTruncatedDE('Gerne'), false);
  assert.equal(looksTruncatedDE('Ja, gerne.'), false);
});

test('edge: empty / whitespace is not "truncated"', () => {
  assert.equal(looksTruncatedDE(''), false);
  assert.equal(looksTruncatedDE('   '), false);
  assert.equal(looksTruncatedDE(null), false);
});

test('sessionSubstance: a session of only cut-off fragments is too thin to judge', () => {
  const utts = [
    { text: 'Ja, hallo, ich heiße Alhassan. Ich habe', words: 7 },
    { text: 'Arbeit. Das war IT Fachkräfte', words: 5 },
    { text: 'das war mit Python. Wir haben', words: 6 },
  ];
  const s = sessionSubstance(utts);
  assert.equal(s.tooThinToJudge, true);
  assert.ok(s.truncatedShare >= 0.6, `expected mostly-truncated, got ${s.truncatedShare}`);
});

test('sessionSubstance: two real complete answers with enough words is judgeable', () => {
  const utts = [
    { text: 'Guten Tag, mein Name ist Karim Hassan und ich habe drei Jahre im Kundenservice gearbeitet.', words: 15 },
    { text: 'Ich habe einen wütenden Kunden zuerst ausreden lassen und dann eine konkrete Lösung angeboten.', words: 13 },
  ];
  const s = sessionSubstance(utts);
  assert.equal(s.tooThinToJudge, false);
  assert.equal(s.completeTurns, 2);
});

test('sessionSubstance: empty session is trivially too thin', () => {
  assert.equal(sessionSubstance([]).tooThinToJudge, true);
});
