/**
 * realtimeClient.test.mjs — the mechanical thread-following backstop must stay bounded:
 * it fires ONLY on substantive answers that opened a NEW thread, only in Teil 1–2, at most
 * 3× per session, never back-to-back, and never when a rescue/correction owns the turn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { threadNudge, firstSentenceBoundary, earlySafeSentence } from './realtimeClient.js';

const base = { freshTerms: ['Reiseleiterin'], wordCount: 20, stageIdx: 0, used: 0, cooldown: 0, busy: false };

test('threadNudge: substantive answer with a fresh term → nudge names the term', () => {
  const n = threadNudge(base);
  assert.ok(n && n.includes('Reiseleiterin'), `got: ${n}`);
  assert.ok(n.includes('FADEN'), `got: ${n}`);
});

test('threadNudge: no fresh terms → no nudge (an answer that stays on known ground opens nothing)', () => {
  assert.equal(threadNudge({ ...base, freshTerms: [] }), null);
});

test('threadNudge: short answers never nudge (a 5-word reply is not an opened thread)', () => {
  assert.equal(threadNudge({ ...base, wordCount: 5 }), null);
});

test('threadNudge: roleplay stage stands down (the customer follows its own script)', () => {
  assert.equal(threadNudge({ ...base, stageIdx: 2 }), null);
});

test('threadNudge: session cap of 3 and cooldown block further nudges', () => {
  assert.equal(threadNudge({ ...base, used: 3 }), null);
  assert.equal(threadNudge({ ...base, cooldown: 1 }), null);
});

test('threadNudge: rescue/correction turns are never doubled up', () => {
  assert.equal(threadNudge({ ...base, busy: true }), null);
});

test('threadNudge: at most two terms are quoted', () => {
  const n = threadNudge({ ...base, freshTerms: ['Reiseleiterin', 'Stromanbieter', 'Kündigung'] });
  assert.ok(n.includes('Reiseleiterin') && n.includes('Stromanbieter') && !n.includes('Kündigung'), `got: ${n}`);
});

// ── Sentence-streaming: the early first sentence must be found safely or not at all ──

test('firstSentenceBoundary: finds the first finished sentence once the next one starts', () => {
  const cut = firstSentenceBoundary('Gut. Warum genau haben Sie gewechselt?');
  assert.equal('Gut. Warum genau haben Sie gewechselt?'.slice(0, cut).trim(), 'Gut.');
});

test('firstSentenceBoundary: a question first sentence works too', () => {
  const t = 'Und warum genau? Erzählen Sie mehr davon.';
  const cut = firstSentenceBoundary(t);
  assert.equal(t.slice(0, cut).trim(), 'Und warum genau?');
});

test('firstSentenceBoundary: never cuts at a stream tail (boundary needs following text)', () => {
  assert.equal(firstSentenceBoundary('Gut.'), -1);              // stream may still be mid-line
  assert.equal(firstSentenceBoundary('Gut. '), -1);             // whitespace but no next word yet
});

test('firstSentenceBoundary: German abbreviations do not end a sentence', () => {
  assert.equal(firstSentenceBoundary('Wir brauchen z. B. mehr Beispiele aus dem Alltag'), -1);
  assert.equal(firstSentenceBoundary('Sprechen Sie mit Dr. Weber darüber bitte'), -1);
});

test('firstSentenceBoundary: a lowercase continuation is not a new sentence', () => {
  assert.equal(firstSentenceBoundary('Sie sagten ca. drei Jahre und dann'), -1);
});

test('earlySafeSentence: real sentences pass, guard-trigger lines never speak early', () => {
  assert.equal(earlySafeSentence('Das klingt nach einer spannenden Erfahrung!'), true);
  assert.equal(earlySafeSentence('Ich habe Sie akustisch nicht verstanden.'), false);
  assert.equal(earlySafeSentence('Kandidat: Ich bin bereit.'), false);
  assert.equal(earlySafeSentence('…'), false);
});
