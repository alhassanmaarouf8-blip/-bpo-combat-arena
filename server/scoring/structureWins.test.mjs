import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStructureWins, topStructureWins } from './structureWins.js';

const u = (text, extra = {}) => ({ text, words: text.split(/\s+/).length, ...extra });

test('Konjunktiv II is detected and quoted', () => {
  const wins = detectStructureWins([
    u('Ich würde zuerst den Kunden beruhigen.'),
    u('Es wäre besser, wenn wir das System prüfen.'),
  ]);
  const k2 = wins.find((w) => w.key === 'konjunktiv2');
  assert.ok(k2, 'konjunktiv2 detected');
  assert.ok(k2.count >= 2);
  assert.ok(k2.examples.length >= 1);
});

test('the NOUN "Würde" (dignity) is NOT counted as Konjunktiv II', () => {
  const wins = detectStructureWins([
    u('Ich behandle jeden Kunden mit Würde.'),
    u('Die Würde des Menschen ist wichtig.'),
  ]);
  assert.equal(wins.find((w) => w.key === 'konjunktiv2'), undefined);
  // …while a real sentence-initial "Würde" question still counts:
  const real = detectStructureWins([
    u('Würde ich das Problem nicht lösen können, frage ich nach.'),
    u('Ich würde zuerst zuhören.'),
  ]);
  assert.ok(real.find((w) => w.key === 'konjunktiv2')?.count >= 2);
});

test('sollte/wollte (Präteritum-ambiguous) are NOT counted as Konjunktiv II', () => {
  const wins = detectStructureWins([
    u('Ich sollte gestern arbeiten.'),
    u('Er wollte das nicht machen.'),
  ]);
  assert.equal(wins.find((w) => w.key === 'konjunktiv2'), undefined);
});

test('correct verb-final subordinate clause is detected', () => {
  const wins = detectStructureWins([
    u('Ich bin zu spät, weil ich keine Zeit habe.'),
    u('Er sagt, dass er das Problem schnell lösen kann.'),
  ]);
  const vf = wins.find((w) => w.key === 'verb-final-ok');
  assert.ok(vf, 'verb-final-ok detected');
  assert.ok(vf.count >= 2);
});

test('verb-SECOND error clause ("weil ich habe keine Zeit") does NOT count as a win', () => {
  const wins = detectStructureWins([u('Ich bin zu spät, weil ich habe keine Zeit.')]);
  assert.equal(wins.find((w) => w.key === 'verb-final-ok'), undefined);
});

test('Perfekt narration is detected; ge-lookalikes are not', () => {
  const wins = detectStructureWins([
    u('Ich habe drei Jahre im Callcenter gearbeitet.'),
    u('Wir haben das Problem gemeinsam gelöst und dann habe ich den Kunden angerufen.'),
  ]);
  const pf = wins.find((w) => w.key === 'perfekt');
  assert.ok(pf, 'perfekt detected');
  assert.ok(pf.count >= 2);

  const none = detectStructureWins([u('Ich bin gegen diese Idee und habe genau das gesagt, gerne.')]);
  const pf2 = none.find((w) => w.key === 'perfekt');
  // "gesagt" IS a legitimate participle here — but "gegen/genau/gerne" alone must never count.
  if (pf2) for (const q of pf2.examples) assert.ok(!/\b(gegen|genau|gerne)\s*$/i.test(q));
});

test('topStructureWins: needs ≥2 occurrences, caps at max, returns phrase + gated quote', () => {
  const one = topStructureWins([u('Ich würde das machen.')]);
  assert.equal(one.length, 0, 'a single occurrence is never a named strength');

  const wins = topStructureWins([
    u('Ich würde zuerst zuhören.'),
    u('Ich könnte auch eine E-Mail schreiben.'),
    u('Ich habe zwei Jahre im Support gearbeitet.'),
    u('Wir haben viel gelernt und ich habe den Prozess verbessert.'),
  ]);
  assert.ok(wins.length >= 1 && wins.length <= 2);
  for (const w of wins) {
    assert.equal(typeof w.phrase, 'string');
    assert.ok(w.count >= 2);
  }
});

test('debriefStructureWins: written cards carry title+explain, same gates, max 2, note_ar empty', async () => {
  const { debriefStructureWins } = await import('./structureWins.js');
  const none = debriefStructureWins([u('Ich würde das machen.')]);   // single occurrence
  assert.equal(none.length, 0, 'a single occurrence is never a written card');

  const wins = debriefStructureWins([
    u('Ich würde zuerst zuhören.'),
    u('Ich könnte auch eine E-Mail schreiben.'),
    u('Ich habe zwei Jahre im Support gearbeitet.'),
    u('Wir haben viel gelernt und ich habe den Prozess verbessert.'),
  ]);
  assert.ok(wins.length >= 1 && wins.length <= 2);
  for (const w of wins) {
    assert.ok(w.title && w.title.startsWith('Das sitzt schon'), `title: ${w.title}`);
    assert.ok(w.explain.length > 20);
    assert.equal(w.note_ar, '', 'Arabic stays an OWNER-AR slot');
    assert.ok(w.count >= 2);
  }
});

test('honesty gates: truncated turns and low-confidence words are never quoted', () => {
  const wins = detectStructureWins([
    u('Ich würde gerne mehr über die', {}),                                  // truncated → no quote
    u('Ich würde den Vorgesetzten informieren.', { lowConf: ['würde'] }),    // low-conf → no quote
  ]);
  const k2 = wins.find((w) => w.key === 'konjunktiv2');
  assert.ok(k2, 'still COUNTED');
  assert.equal(k2.examples.length, 0, 'but never quoted');
});
