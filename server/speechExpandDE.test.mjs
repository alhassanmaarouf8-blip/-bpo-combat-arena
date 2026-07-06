/**
 * speechExpandDE.test.mjs — ROADMAP #20 DoD: digits/€/times/abbreviations become the exact
 * German words a human interviewer would say, and anything ambiguous is left alone.
 * Pure module — no express/auth imports, so the suite stays side-effect-free.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { numberToWordsDE, expandForSpeechDE } from './speechExpandDE.js';

test('numberToWordsDE: the German cardinal system, including its irregulars', () => {
  const cases = [
    [0, 'null'], [1, 'eins'], [7, 'sieben'], [16, 'sechzehn'], [17, 'siebzehn'],
    [21, 'einundzwanzig'], [30, 'dreißig'], [99, 'neunundneunzig'],
    [100, 'einhundert'], [101, 'einhunderteins'], [271, 'zweihunderteinundsiebzig'],
    [999, 'neunhundertneunundneunzig'], [1000, 'eintausend'],
    [1234, 'eintausendzweihundertvierunddreißig'], [20000, 'zwanzigtausend'],
  ];
  for (const [n, w] of cases) assert.equal(numberToWordsDE(n), w, `n=${n}`);
});

test('expandForSpeechDE: currency is spoken, never engine luck ("19,99 €")', () => {
  assert.equal(expandForSpeechDE('Das macht 19,99 €.'),
    'Das macht neunzehn Euro und neunundneunzig Cent.');
  assert.equal(expandForSpeechDE('Das kostet 10,00 €.'), 'Das kostet zehn Euro.');
  assert.equal(expandForSpeechDE('Nur 1 € pro Tag.'), 'Nur ein Euro pro Tag.');
  assert.equal(expandForSpeechDE('Budget: € 250 im Monat.'), 'Budget: zweihundertfünfzig Euro im Monat.');
});

test('expandForSpeechDE: "24h", times and percent become words', () => {
  assert.equal(expandForSpeechDE('Wir sind 24h erreichbar.'), 'Wir sind vierundzwanzig Stunden erreichbar.');
  assert.equal(expandForSpeechDE('Der Termin ist um 14:30 Uhr.'), 'Der Termin ist um vierzehn Uhr dreißig.');
  assert.equal(expandForSpeechDE('Um 9:00 fangen wir an.'), 'Um neun Uhr fangen wir an.');
  assert.equal(expandForSpeechDE('Das sind 5 % mehr.'), 'Das sind fünf Prozent mehr.');
  assert.equal(expandForSpeechDE('Wir arbeiten 24/7.'), 'Wir arbeiten rund um die Uhr.');
});

test('expandForSpeechDE: plain integers and decimals in boss speech', () => {
  assert.equal(expandForSpeechDE('Teil 2 beginnt jetzt.'), 'Teil zwei beginnt jetzt.');
  assert.equal(expandForSpeechDE('Sie haben 90 Sekunden.'), 'Sie haben neunzig Sekunden.');
  assert.equal(expandForSpeechDE('Note 3,5 ist okay.'), 'Note drei Komma fünf ist okay.');
});

test('expandForSpeechDE: abbreviations a voice should not spell out', () => {
  assert.equal(expandForSpeechDE('Nennen Sie z. B. eine Situation.'), 'Nennen Sie zum Beispiel eine Situation.');
  assert.equal(expandForSpeechDE('Rufen Sie Nr. 5 auf.'), 'Rufen Sie Nummer fünf auf.');
  assert.equal(expandForSpeechDE('Das dauert ca. 8 Std.'), 'Das dauert circa acht Stunden');
});

test('expandForSpeechDE: ambiguous forms stay untouched (never make speech worse)', () => {
  // Ordinal before a noun — the engine reads German ordinals correctly; we must not break it.
  assert.equal(expandForSpeechDE('Am 2. Juli haben wir frei.'), 'Am 2. Juli haben wir frei.');
  // Digits glued to letters (version tags etc.) are not speech numbers.
  assert.equal(expandForSpeechDE('Version v2 bleibt aktiv.'), 'Version v2 bleibt aktiv.');
  // No digits at all → identical text.
  const plain = 'Guten Tag, schön, dass Sie da sind.';
  assert.equal(expandForSpeechDE(plain), plain);
});

test('expandForSpeechDE: idempotent — expanding twice changes nothing', () => {
  const once = expandForSpeechDE('Das macht 19,99 € um 14:30 Uhr, z. B. 24/7.');
  assert.equal(expandForSpeechDE(once), once);
});
