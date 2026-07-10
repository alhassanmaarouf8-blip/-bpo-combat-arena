/**
 * druckLeiter.test.mjs — boundary tests for the tightened "souverän" heuristic (ROADMAP #5).
 *
 * The badge rule: souverän = a real CONTENT move (acknowledgment OR concrete solution) AND no
 * positively-detected insult. Formal register (stayedSie) supports but never earns the badge alone.
 * Credit-only doctrine holds: every blocked/withheld badge rests on a POSITIVE detection, never on
 * absence — absence only means the client's "Standgehalten" verdict stands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMoves, judgeSouveraen, stripBarbs, parseBarbs } from './druckLeiter.js';

const souv = (text) => judgeSouveraen(detectMoves(text));

// ── The tightening itself: register alone is NOT de-escalation ──────────────────────────────
test('formal register alone (the old false-badge) does not earn souverän', () => {
  const moves = detectMoves('Ja, das kann ich Ihnen sagen, ich habe viel Erfahrung.');
  assert.equal(moves.stayedSie, true);
  assert.equal(moves.acknowledged, false);
  assert.equal(moves.offeredSolution, false);
  assert.equal(judgeSouveraen(moves), false);
});

test('acknowledgment alone earns souverän', () => {
  assert.equal(souv('Ich verstehe Ihren Ärger.'), true);
  assert.equal(souv('Das tut mir leid.'), true);
  assert.equal(souv('Entschuldigen Sie bitte die Umstände.'), true);
  assert.equal(souv('Ich bedaure das sehr.'), true);
});

test('concrete solution alone earns souverän', () => {
  assert.equal(souv('Ich kümmere mich darum.'), true);
  assert.equal(souv('Ich prüfe das gleich.'), true);
  assert.equal(souv('Ich melde mich in zehn Minuten.'), true);
  assert.equal(souv('Wir machen das Schritt für Schritt.'), true);
  assert.equal(souv('Ich erstatte Ihnen den Betrag.'), true);
});

// ── The grader must credit the drill's OWN taught model answers (KONTER phrases) ─────────────
// Mirrors PressureLadder.jsx KONTER — if one of these stops earning the badge, we are teaching a
// phrase our own grader rejects. Rungs 1/2 teach self-presentation, not de-escalation, and are
// honestly NOT badge material.
const KONTER_DEESC = [
  'Ich verstehe Ihren Ärger, das darf nicht passieren. Ich kümmere mich sofort darum und melde mich in zehn Minuten mit einer Lösung.', // rung 3
  'Das kann ich nachvollziehen. Lassen Sie mich kurz zeigen, was ich konkret kann — dann urteilen Sie.',                                  // rung 4
  'Geben Sie mir dreißig Sekunden: Ich löse das jetzt Schritt für Schritt und sage Ihnen genau, was als Nächstes passiert.',              // rung 5
  'Ich verstehe, dass Sie enttäuscht sind. Was ich jetzt konkret für Sie tun kann, ist Folgendes — und ich bleibe dran, bis es gelöst ist.', // endless
];
test('every taught de-escalation KONTER phrase earns the badge', () => {
  for (const phrase of KONTER_DEESC) assert.equal(souv(phrase), true, phrase);
});
test('rung-5 phrase is credited via "löse" (the old lösung-only regex missed it)', () => {
  assert.equal(detectMoves('Ich löse das jetzt.').offeredSolution, true);
  assert.equal(detectMoves('Bis es gelöst ist.').offeredSolution, true);
});

// ── Insults block the badge (positive detection, not absence) ────────────────────────────────
test('a directed insult blocks an otherwise-earned badge', () => {
  const moves = detectMoves('Ich verstehe Ihren Ärger, aber Sie sind blöd.');
  assert.equal(moves.acknowledged, true);
  assert.equal(moves.noInsult, false);
  assert.equal(judgeSouveraen(moves), false);
});
test('name-calling and vulgarity block regardless of direction', () => {
  assert.equal(detectMoves('So ein Idiot.').noInsult, false);
  assert.equal(detectMoves('Halt die Klappe.').noInsult, false);
  assert.equal(detectMoves('Das ist doch scheiße.').noInsult, false);
});
test('undirected everyday "blöd/dumm" does NOT block (situation, not person)', () => {
  const moves = detectMoves('Das ist blöd gelaufen, ich kümmere mich sofort darum.');
  assert.equal(moves.noInsult, true);
  assert.equal(judgeSouveraen(moves), true);
  assert.equal(detectMoves('Eine dumme Situation, ich prüfe das.').noInsult, true);
});

// ── Absence never fails (credit-only floor) ──────────────────────────────────────────────────
test('empty / contentless transcript: no badge, but noInsult stays professional-by-default', () => {
  const moves = detectMoves('');
  assert.deepEqual(moves, { acknowledged: false, offeredSolution: false, stayedSie: false, noInsult: true });
  assert.equal(judgeSouveraen(moves), false);
});
test('an informal du-slip only withholds the register credit, never the content badge', () => {
  const moves = detectMoves('Ich verstehe dich, ich kümmere mich darum.');
  assert.equal(moves.stayedSie, false);
  assert.equal(judgeSouveraen(moves), true);
});
test('lowercase "sie" (she/they) earns no register credit — formal Sie is capitalised', () => {
  assert.equal(detectMoves('sie ist sauer, das weiß ich').stayedSie, false);
});

// ── Barb stripping: the boss's words must never earn or cost the learner ─────────────────────
test('a barb containing "Sie" is stripped before register detection', () => {
  const cleaned = stripBarbs('Kommen Sie zum Punkt.', ['Kommen Sie zum Punkt.']);
  assert.equal(cleaned, '');
  assert.equal(detectMoves(cleaned).stayedSie, false);
});
test('stripBarbs is case-insensitive and regex-safe (barbs contain . and !)', () => {
  const cleaned = stripBarbs('kommen sie zum punkt. Ich verstehe Ihren Ärger.', ['Kommen Sie zum Punkt.']);
  assert.equal(cleaned, 'Ich verstehe Ihren Ärger.');
});

// ── parseBarbs never throws ──────────────────────────────────────────────────────────────────
test('parseBarbs: JSON array, garbage, array param, empty', () => {
  assert.deepEqual(parseBarbs('["Nein.","Weiter!"]'), ['Nein.', 'Weiter!']);
  assert.deepEqual(parseBarbs('not json'), []);
  assert.deepEqual(parseBarbs(['Nein.', 42, 'Weiter!']), ['Nein.', 'Weiter!']);
  assert.deepEqual(parseBarbs(undefined), []);
});
