/**
 * chunkAutomaticity.test.mjs — Blitz-Formeln (ROADMAP #2): deterministic chunk grading,
 * latency verdicts, SRS-driven selection, and bank hygiene.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS, chunkMatch, chunkVerdict, pickChunks } from './fluencyDrill.js';
import { srsKey, addItem, grade } from './srs.js';
import { isCleanGermanText } from './langGuard.js';

// ── Bank hygiene ──────────────────────────────────────────────────────────────

test('bank has at least 30 chunks, each with a German cue and chunk, and NO authored Arabic', () => {
  assert.ok(CHUNKS.length >= 30, `only ${CHUNKS.length} chunks`);
  for (const c of CHUNKS) {
    assert.equal(typeof c.cue, 'string');
    assert.ok(c.cue.trim().length > 10, `thin cue: ${c.cue}`);
    assert.ok(c.chunk.trim().length > 10, `thin chunk: ${c.chunk}`);
    assert.ok(isCleanGermanText(c.cue), `cue failed langGuard: ${c.cue}`);
    assert.ok(isCleanGermanText(c.chunk), `chunk failed langGuard: ${c.chunk}`);
    assert.equal(c.note_ar, '', 'note_ar must be an empty OWNER-AR slot');
  }
});

test('chunk ids are stable array indices (score endpoint looks items up by index)', () => {
  CHUNKS.forEach((c, i) => assert.equal(c.id, i));
});

// ── chunkMatch: the deterministic presence rule ───────────────────────────────

test('exact production hits', () => {
  const r = chunkMatch('Ich kümmere mich sofort darum.', 'Ich kümmere mich sofort darum.');
  assert.equal(r.hit, true);
  assert.equal(r.ratio, 1);
});

test('chunk embedded in a longer sentence hits', () => {
  const r = chunkMatch('Ich kümmere mich sofort darum.', 'Ja gut, also ich kümmere mich sofort darum, kein Problem.');
  assert.equal(r.hit, true);
});

test('one STT typo on a long word is tolerated (single grading rule)', () => {
  // "kümmere" → "kümmern" is 1 edit on a 7-letter word.
  const r = chunkMatch('Ich kümmere mich sofort darum.', 'Ich kümmern mich sofort darum.');
  assert.equal(r.hit, true);
});

test('scrambled word order misses (a scrambled formula is not automatized)', () => {
  const r = chunkMatch('Ich kümmere mich sofort darum.', 'Ich kümmere mich darum sofort.');
  assert.equal(r.hit, false);
});

test('a different sentence about the same topic misses', () => {
  const r = chunkMatch('Ich kümmere mich sofort darum.', 'Ich werde das Problem später bearbeiten.');
  assert.equal(r.hit, false);
});

test('partial production misses', () => {
  const r = chunkMatch('Das ist leider nicht möglich, aber ich habe eine Alternative für Sie.', 'Das ist leider nicht möglich.');
  assert.equal(r.hit, false);
});

test('empty transcript misses without throwing', () => {
  assert.equal(chunkMatch('Vielen Dank für Ihre Geduld.', '').hit, false);
  assert.equal(chunkMatch('', 'irgendwas').hit, false);
});

test('umlaut normalization: decomposed and precomposed forms compare equal', () => {
  const r = chunkMatch('Könnten Sie das bitte wiederholen?', 'könnten sie das bitte wiederholen');
  assert.equal(r.hit, true);
});

// ── chunkVerdict: latency tiers ───────────────────────────────────────────────

test('verdict tiers: automatic / ok / slow / miss', () => {
  assert.equal(chunkVerdict(true, 900),   'automatic');
  assert.equal(chunkVerdict(true, 1500),  'automatic');
  assert.equal(chunkVerdict(true, 2200),  'ok');
  assert.equal(chunkVerdict(true, 3000),  'ok');
  assert.equal(chunkVerdict(true, 4500),  'slow');
  assert.equal(chunkVerdict(false, 500),  'miss');   // fast but wrong is just wrong
});

test('missing/unreliable latency degrades to correctness-only, never blames the learner', () => {
  assert.equal(chunkVerdict(true, 0),        'ok');
  assert.equal(chunkVerdict(true, NaN),      'ok');
  assert.equal(chunkVerdict(true, undefined),'ok');
});

// ── pickChunks: SRS-due first, then unseen, then cycle ────────────────────────

test('due SRS chunks are served first, oldest due first', () => {
  const now = Date.now();
  const profile = { srs: [], chunkSeen: [] };
  // Two chunks tracked and due (one older), one tracked but NOT due.
  const a = addItem(profile, { type: 'chunk', content: CHUNKS[5].chunk });
  a.due = now - 1000;
  const b = addItem(profile, { type: 'chunk', content: CHUNKS[2].chunk });
  b.due = now - 5000;
  const c = addItem(profile, { type: 'chunk', content: CHUNKS[9].chunk });
  c.due = now + 86_400_000;   // tomorrow — must NOT lead the session
  const picked = pickChunks(profile, 4, now);
  assert.equal(picked[0].id, CHUNKS[2].id);   // oldest due first
  assert.equal(picked[1].id, CHUNKS[5].id);
  assert.notEqual(picked[2].id, CHUNKS[9].id);
});

test('unseen chunks come before already-seen ones', () => {
  const profile = { srs: [], chunkSeen: [0, 1, 2, 3] };
  const picked = pickChunks(profile, 5);
  for (const p of picked) assert.ok(![0, 1, 2, 3].includes(p.id), `seen chunk ${p.id} served before unseen`);
});

test('exhausted bank still fills a session (cycles into seen)', () => {
  const profile = { srs: [], chunkSeen: CHUNKS.map((c) => c.id) };
  const picked = pickChunks(profile, 6);
  assert.equal(picked.length, 6);
});

test('no duplicates within one session', () => {
  const now = Date.now();
  const profile = { srs: [], chunkSeen: [4, 5] };
  const d = addItem(profile, { type: 'chunk', content: CHUNKS[4].chunk });
  d.due = now - 10;
  const picked = pickChunks(profile, 12, now);
  const ids = picked.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ── SRS wiring: the schedule advances on hit, laps on miss ───────────────────

test('hit advances the schedule; miss lapses back to stage 0', () => {
  const profile = { srs: [] };
  const key = srsKey('chunk', CHUNKS[0].chunk);
  addItem(profile, { type: 'chunk', content: CHUNKS[0].chunk, prompt: CHUNKS[0].cue, answer: CHUNKS[0].chunk });

  const afterHit = grade(profile, key, true);
  assert.equal(afterHit.stage, 1);
  assert.ok(afterHit.due > Date.now());

  const afterMiss = grade(profile, key, false);
  assert.equal(afterMiss.stage, 0);
  assert.equal(afterMiss.lapses, 1);
});
