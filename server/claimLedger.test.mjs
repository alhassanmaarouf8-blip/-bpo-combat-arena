import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, extractNumberClaims, noteTurn, findContradiction, pickCallback } from './claimLedger.js';

test('extracts a spelled-out number claim ("drei Jahre")', () => {
  const cs = extractNumberClaims({ text: 'Ich habe drei Jahre Erfahrung im Kundenservice.' });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].value, 3);
  assert.equal(cs[0].unit, 'jahr');
  assert.match(cs[0].raw, /drei Jahre/);
});

test('extracts a digit number claim ("10 Kunden")', () => {
  const cs = extractNumberClaims({ text: 'Ich habe pro Stunde 10 Kunden betreut.' });
  assert.equal(cs[0].value, 10);
  assert.equal(cs[0].unit, 'kunde');
});

test('SAFETY GATE: low-confidence STT turns yield no claims', () => {
  assert.deepEqual(extractNumberClaims({ text: 'Ich habe fünf Jahre Erfahrung.', lowConf: true }), []);
});

test('SAFETY GATE: truncated turns yield no claims', () => {
  assert.deepEqual(extractNumberClaims({ text: 'Ich habe drei Jahre', truncated: true }), []);
});

test('findContradiction catches a changed number on the same axis', () => {
  const led = createLedger();
  noteTurn(led, { text: 'Ich habe drei Jahre Erfahrung.' }, 0);
  noteTurn(led, { text: 'Also insgesamt fünf Jahre im Support.' }, 2);
  const c = findContradiction(led);
  assert.ok(c);
  assert.equal(c.unit, 'jahr');
  assert.equal(c.earlier.value, 3);
  assert.equal(c.now.value, 5);
});

test('no contradiction when the same number is restated', () => {
  const led = createLedger();
  noteTurn(led, { text: 'Drei Jahre Erfahrung.' }, 0);
  noteTurn(led, { text: 'Ja, drei Jahre genau.' }, 1);
  assert.equal(findContradiction(led), null);
});

test('no contradiction across DIFFERENT units', () => {
  const led = createLedger();
  noteTurn(led, { text: 'Drei Jahre Erfahrung.' }, 0);
  noteTurn(led, { text: 'Ich habe fünf Kunden betreut.' }, 1);
  assert.equal(findContradiction(led), null);
});

test('same-turn different numbers do not count as a contradiction', () => {
  const led = createLedger();
  noteTurn(led, { text: 'Drei Jahre hier, fünf Jahre dort.' }, 0);
  assert.equal(findContradiction(led), null);
});

test('unrelated time-ago and work-experience years never become a false contradiction', () => {
  const led = createLedger();
  noteTurn(led, { text: 'Ich habe zwei Jahre Erfahrung im Kundenservice.' }, 0);
  noteTurn(led, { text: 'Vor drei Jahren bin ich nach Kairo gezogen.' }, 1);
  assert.equal(findContradiction(led), null);
});

test('the same work-experience axis still catches a changed number', () => {
  const led = createLedger();
  noteTurn(led, { text: 'Ich habe zwei Jahre Erfahrung im Kundenservice.' }, 0);
  noteTurn(led, { text: 'Ich habe drei Jahre Berufserfahrung im Kundenservice.' }, 1);
  assert.ok(findContradiction(led));
});

test('lowercase employer history never enters callback memory', () => {
  const led = createLedger();
  noteTurn(led, { text: 'Ich arbeite bei vodafone als Kundenberater.' }, 0);
  assert.equal(pickCallback(led), null);
});
