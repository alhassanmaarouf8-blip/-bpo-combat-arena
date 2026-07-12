import test from 'node:test';
import assert from 'node:assert/strict';

import { pickRevancheMoment } from './websocketManager.js';
import { buildSessionScript } from './scenarios.js';

test('revanche keeps the lowest safely quotable scored answer', () => {
  const first = pickRevancheMoment(null, {
    quote: 'Ich habe drei Jahre im Kundenservice gearbeitet.', score: 58,
    stage: 1, stageLabel: 'VERHALTEN', question: 'Nennen Sie ein Beispiel.', reason: 'Zu allgemein',
  });
  const lower = pickRevancheMoment(first, {
    quote: 'Ich weiß nicht genau.', score: 31,
    stage: 2, stageLabel: 'ROLLENSPIEL', question: 'Wie beruhigen Sie den Kunden?', reason: 'Keine Lösung',
  });
  assert.equal(lower.score, 31);
  assert.equal(lower.stage, 2);
  assert.equal(lower.quote, 'Ich weiß nicht genau.');
});

test('revanche never quotes truncated or low-confidence speech', () => {
  const safe = { quote: 'Eine sichere Antwort.', score: 45, stage: 0, stageLabel: 'VORSTELLUNG', question: '', reason: '' };
  assert.deepEqual(pickRevancheMoment(safe, { quote: 'Ich wollte nur', score: 10, truncated: true }), safe);
  assert.deepEqual(pickRevancheMoment(safe, { quote: 'Vielleicht Kundenservice', score: 9, lowConfidence: true }), safe);
});

test('revanche prompt retests the same class without exposing the old answer', () => {
  const session = buildSessionScript({
    persona: 'Sachlich.', displayName: 'Yasmin', greeting: 'Guten Tag.', levelId: 'a2-b1',
    sessionSeed: 'revanche-test', revanche: { stage: 2, stageLabel: 'ROLLENSPIEL' },
  });
  assert.match(session.instructions, /REVANCHE:/);
  assert.match(session.instructions, /Kunden-Rollenspiel und Deeskalation/);
  assert.match(session.instructions, /zitiere oder verrate die alte Antwort nicht/);
});
