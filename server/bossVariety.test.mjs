import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectWornOpener, stripWornOpener,
  createVarietyState, isRepeatOpener, noteBossTurn, recentOpenerSignatures,
} from './bossVariety.js';

test('detects the canonical worn opener "Das ist interessant"', () => {
  assert.equal(detectWornOpener('Das ist interessant. Warum haben Sie gekündigt?'), 'das ist interessant');
});

test('detects a one-word worn opener with punctuation', () => {
  assert.equal(detectWornOpener('Verstehe. Und wie ging es weiter?'), 'verstehe');
});

test('a normal content opening is NOT flagged', () => {
  assert.equal(detectWornOpener('Warum möchten Sie bei uns arbeiten?'), null);
});

test('stripWornOpener removes the cliché and re-capitalises the real content', () => {
  const r = stripWornOpener('Das ist interessant. Warum haben Sie gekündigt?');
  assert.equal(r.removed, 'das ist interessant');
  assert.equal(r.text, 'Warum haben Sie gekündigt?');
});

test('stripWornOpener keeps the turn if the opener was the WHOLE turn', () => {
  const r = stripWornOpener('Interessant.');
  assert.equal(r.removed, null);
  assert.equal(r.text, 'Interessant.');
});

test('stripWornOpener leaves a clean turn untouched', () => {
  const r = stripWornOpener('Erzählen Sie mir von einem Konflikt.');
  assert.equal(r.removed, null);
  assert.equal(r.text, 'Erzählen Sie mir von einem Konflikt.');
});

test('rolling anti-repeat flags a repeated opening within the window', () => {
  const s = createVarietyState(4);
  noteBossTurn(s, 'Und wie haben Sie reagiert?');
  assert.equal(isRepeatOpener(s, 'Und wie haben Sie das gemacht?'), true); // same first 3 words
  assert.equal(isRepeatOpener(s, 'Warum haben Sie das getan?'), false);
});

test('anti-repeat forgets openings older than the window', () => {
  const s = createVarietyState(2);
  noteBossTurn(s, 'Und wie haben Sie reagiert?');
  noteBossTurn(s, 'Was war das Ergebnis davon?');
  noteBossTurn(s, 'Wie ging es dann weiter?');       // pushes the first out (window=2)
  assert.equal(isRepeatOpener(s, 'Und wie war das genau?'), false);
  assert.deepEqual(recentOpenerSignatures(s).length, 2);
});

test('signatures ignore punctuation/case', () => {
  const s = createVarietyState(3);
  noteBossTurn(s, 'Und, wie war das?');
  assert.equal(isRepeatOpener(s, 'UND WIE WAR es bei Ihnen?'), true);
});
