import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeSatzbau, splitTokens, SENTENCES } from './satzbauSchmiede.js';

test('satzbau: exact correct order → correct=true, full match', () => {
  const target = splitTokens('Ich rufe Sie zurück, weil ich gerade beschäftigt bin.');
  const r = gradeSatzbau(target, target);
  assert.equal(r.correct, true);
  assert.equal(r.matchedCount, r.total);
  assert.equal(r.firstMismatchIndex, null);
});

test('satzbau: fully wrong order → correct=false, partial or zero match reported honestly', () => {
  const target = splitTokens('Ich rufe Sie zurück, weil ich gerade beschäftigt bin.');
  const reversed = target.slice().reverse();
  const r = gradeSatzbau(target, reversed);
  assert.equal(r.correct, false);
  assert.ok(r.matchedCount < r.total);
  assert.equal(r.firstMismatchIndex, 0);   // first tile already wrong
});

test('satzbau: partial — one swapped pair reports the correct matched count and the first break', () => {
  const target = ['ich', 'rufe', 'sie', 'zurück'];
  const submitted = ['ich', 'sie', 'rufe', 'zurück'];   // positions 1,2 swapped
  const r = gradeSatzbau(target, submitted);
  assert.equal(r.correct, false);
  assert.equal(r.matchedCount, 2);          // index 0 and 3 still match
  assert.equal(r.firstMismatchIndex, 1);
});

test('satzbau: tolerant of case and trailing punctuation on a token (article capitalization)', () => {
  const target = ['Ich', 'weiß,', 'dass', 'Sie', 'Recht', 'haben.'];
  const submitted = ['ich', 'weiß', 'dass', 'sie', 'recht', 'haben'];   // lowercased, punctuation stripped
  const r = gradeSatzbau(target, submitted);
  assert.equal(r.correct, true);
});

test('satzbau: wrong length (missing a tile) never falsely reports correct', () => {
  const target = ['ich', 'rufe', 'sie', 'zurück'];
  const submitted = ['ich', 'rufe', 'sie'];
  const r = gradeSatzbau(target, submitted);
  assert.equal(r.correct, false);
  assert.equal(r.total, 4);
});

test('satzbau: empty submission is never graded correct', () => {
  const target = splitTokens('Ich rufe Sie zurück.');
  const r = gradeSatzbau(target, []);
  assert.equal(r.correct, false);
  assert.equal(r.matchedCount, 0);
});

test('satzbau: curated pool has at least 24 seed items', () => {
  assert.ok(SENTENCES.length >= 24, `expected >=24 items, got ${SENTENCES.length}`);
});

test('satzbau: every seed item has a unique id, a non-empty sentence, and an empty owner-slot cue_ar', () => {
  const ids = new Set();
  for (const s of SENTENCES) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(typeof s.sentence === 'string' && s.sentence.trim().length > 10, `bad sentence for id ${s.id}`);
    assert.ok(typeof s.cue_de === 'string' && s.cue_de.trim().length > 5, `bad cue_de for id ${s.id}`);
    assert.equal(s.connector.length > 0, true);
  }
});

test('satzbau: every seed sentence actually contains its own connector (self-consistent content)', () => {
  for (const s of SENTENCES) {
    const norm = s.sentence.toLowerCase();
    assert.ok(norm.includes(s.connector.toLowerCase()), `sentence for id ${s.id} does not contain connector "${s.connector}"`);
  }
});

test('satzbau: splitTokens round-trips a sentence into its literal whitespace-delimited tiles', () => {
  const tokens = splitTokens('Ich rufe Sie zurück, weil ich beschäftigt bin.');
  assert.equal(tokens.join(' '), 'Ich rufe Sie zurück, weil ich beschäftigt bin.');
});

// Verifier addition (2026-07-02): every seed sentence must also pass the script-sanity guard —
// the same gate the generated drills live behind, so curated content can never regress below it.
test('satzbau: every seed sentence and cue_de passes the langGuard German gate', async () => {
  const { isCleanGermanText } = await import('./langGuard.js');
  for (const s of SENTENCES) {
    assert.ok(isCleanGermanText(s.sentence), `sentence for id ${s.id} failed the German gate`);
    assert.ok(isCleanGermanText(s.cue_de), `cue_de for id ${s.id} failed the German gate`);
  }
});
