/**
 * fluencyDrill.test.mjs — topicRelevancy() is the "relevancy" half of the matrix the owner asked
 * for (2026-07-02: "not just speech-speed — a matrix for accuracy AND relevancy to the topic").
 * It must reward an on-topic answer, catch a fluent-but-off-topic one, tolerate German inflection,
 * and stay honest (null) when there's too little to judge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { topicRelevancy } from './fluencyDrill.js';

const PROMPT = 'Wie bleiben Sie motiviert und engagiert in Ihrem Job? Was sind die Faktoren, die Ihre Arbeitsmoral beeinflussen?';

test('topicRelevancy: an on-topic answer scores real coverage', () => {
  const answer = 'Ich bleibe motiviert, weil ich meinen Job liebe. Die wichtigsten Faktoren für meine Arbeitsmoral sind ein gutes Team und faire Bezahlung.';
  const r = topicRelevancy(PROMPT, answer);
  assert.ok(r.coverage > 0.3, `expected coverage > 0.3, got ${r.coverage}`);
  assert.ok(r.matched.length >= 2);
});

test('topicRelevancy: tolerates German inflection via stemming (motiviert↔Motivation, Faktoren↔Faktor)', () => {
  const answer = 'Meine Motivation kommt von innen. Ein wichtiger Faktor ist meine Arbeitsmoral, die ich jeden Tag pflege und die mich engagiert hält im Beruf.';
  const r = topicRelevancy(PROMPT, answer);
  assert.ok(r.matched.some((w) => w.startsWith('motiv')), `expected a motiv* match, got ${JSON.stringify(r.matched)}`);
  assert.ok(r.matched.some((w) => w.startsWith('fakto')), `expected a fakto* match, got ${JSON.stringify(r.matched)}`);
});

test('topicRelevancy: a fluent but OFF-topic answer scores near zero', () => {
  const answer = 'Gestern war das Wetter sehr schön. Ich bin mit meiner Familie an den Strand gefahren und wir haben den ganzen Tag zusammen gegessen und gelacht.';
  const r = topicRelevancy(PROMPT, answer);
  assert.ok(r.coverage < 0.15, `expected coverage < 0.15, got ${r.coverage}`);
});

test('topicRelevancy: too little to judge → null coverage (honest gate)', () => {
  assert.equal(topicRelevancy(PROMPT, 'Ja, klar.').coverage, null);         // answer too short
  assert.equal(topicRelevancy('Und?', 'irgendeine lange Antwort hier bitte').coverage, null); // no real key words in prompt
  assert.equal(topicRelevancy('', 'egal was').coverage, null);
});

test('topicRelevancy: prompt imperatives/question words are NOT counted as topic content', () => {
  // "Beschreiben"/"welche" are prompt scaffolding, not topic — they must be stopped out so an
  // answer that merely echoes them doesn't get fake coverage.
  const r = topicRelevancy('Beschreiben Sie eine schwierige Kundensituation.', 'Beschreiben welche.');
  assert.ok(!r.keyWords.includes('beschreiben'));
  assert.ok(!r.keyWords.includes('welche'));
});
