/**
 * transcriptGuard.test.mjs — pins every filter rule to the owner's real field evidence
 * (2026-07-10 transcript) AND pins the false-positive boundaries: genuine learner turns,
 * including clarifying echoes and emphatic repetition, must NEVER be filtered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latinFraction, isRepeatLoop, isBossEcho, isGarbageUserTurn } from './transcriptGuard.js';

// ── wrong_script: the exact hallucinations from the owner's transcript ──────────────────────
test('Telugu-script hallucination is filtered (German phonetically in the wrong alphabet)', () => {
  const v = isGarbageUserTurn('నెక్స్ట్ ఆడిషన్ ఆన్ ఫార్మ్ వాలి ఇమ్మిష హార్ట్', 'Was war das Schwierigste?');
  assert.equal(v.garbage, true);
  assert.equal(v.reason, 'wrong_script');
});

test('Arabic-script noise fragment is filtered', () => {
  const v = isGarbageUserTurn('شو', '');
  assert.equal(v.garbage, true);
  assert.equal(v.reason, 'wrong_script');
});

test('German with umlauts is fully Latin (never near the threshold)', () => {
  assert.equal(latinFraction('Ich kümmere mich sofort um Ihr Anliegen, natürlich!'), 1);
});

test('mostly-German turn with one stray foreign word is KEPT', () => {
  const v = isGarbageUserTurn('Ich habe drei Jahre im Kundenservice gearbeitet und شو', '');
  assert.equal(v.garbage, false);
});

// ── repeat_loop: the "Hallo. Hallo. Hallo. Hallo. Hallo." signature ─────────────────────────
test('five-fold Hallo loop is filtered', () => {
  const v = isGarbageUserTurn('Hallo. Hallo. Hallo. Hallo. Hallo.', '');
  assert.equal(v.garbage, true);
  assert.equal(v.reason, 'repeat_loop');
});

test('emphatic human repetition ("Nein, nein, nein") is KEPT — three tokens is speech', () => {
  assert.equal(isRepeatLoop('Nein, nein, nein.'), false);
});

test('"ja ja ja ja genau" (2 distinct tokens, 5 total) is filtered as a loop', () => {
  assert.equal(isRepeatLoop('ja ja ja ja genau'), true);
});

// ── boss_echo: AEC residue re-transcribed as the candidate ──────────────────────────────────
test('verbatim fragment of the boss line is filtered as echo', () => {
  const boss = 'Das Schwierigste beim Schichtdienst, meinen Sie das wirklich so?';
  const v = isGarbageUserTurn('das schwierigste beim schichtdienst meinen sie', boss);
  assert.equal(v.garbage, true);
  assert.equal(v.reason, 'boss_echo');
});

test('a human CLARIFYING rephrase is KEPT (reordered/appended words ≠ verbatim echo)', () => {
  const boss = 'Was war das Schwierigste bei der Schichtarbeit?';
  const v = isGarbageUserTurn('Das Schwierigste bei der Schichtarbeit, meinen Sie, oder was?', boss);
  assert.equal(v.garbage, false);
});

test('tiny fragments are not judged by the echo rule', () => {
  assert.equal(isBossEcho('meinen Sie', 'Was meinen Sie damit genau?'), false);
});

test('no boss line yet → echo rule never fires', () => {
  assert.equal(isBossEcho('Guten Tag, ich bin bereit.', ''), false);
});

// ── the golden path: a real answer sails through every rule ─────────────────────────────────
test('a genuine German answer is KEPT', () => {
  const boss = 'Warum wollen Sie in der BPO-Branche arbeiten?';
  const v = isGarbageUserTurn('Ich arbeite gern mit Menschen und mein Deutsch wird jeden Tag besser.', boss);
  assert.equal(v.garbage, false);
  assert.equal(v.reason, null);
});

test('empty turn is garbage', () => {
  assert.equal(isGarbageUserTurn('', '').garbage, true);
});

// ── wiring-order regression (review 07-10): the guard MUST receive the PREVIOUS boss line ───
// (the one whose speaker audio bled into the mic), never the fresh reply pushed this turn.
test('echo is caught against the PREVIOUS boss line, not the fresh reply', () => {
  const prevBoss = 'Warum haben Sie Ihren letzten Job verlassen?';        // line N (echo source)
  const freshReply = 'Verstehe. Und was reizt Sie an der Nachtschicht?';  // line N+1 (wrong comparand)
  const echoTurn = 'warum haben sie ihren letzten job verlassen';
  assert.equal(isGarbageUserTurn(echoTurn, prevBoss).reason, 'boss_echo'); // correct wiring catches it
  assert.equal(isGarbageUserTurn(echoTurn, freshReply).garbage, false);    // wrong wiring would miss it
});

test('a short genuine answer the boss then MIRRORS must not be dropped', () => {
  const prevBoss = 'Welche Schicht bevorzugen Sie?';
  const userAnswer = 'In der Nachtschicht arbeite ich am liebsten.';
  const mirroringReply = 'In der Nachtschicht arbeite ich am liebsten — das höre ich gern.';
  assert.equal(isGarbageUserTurn(userAnswer, prevBoss).garbage, false);         // correct comparand → kept
  assert.equal(isGarbageUserTurn(userAnswer, mirroringReply).reason, 'boss_echo'); // proves the wrong comparand WOULD eat it
});
