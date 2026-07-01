import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDIOLECT_POOL, seededIdiolect, pickN, seedFrom } from './idiolect.js';

test('idiolect: deterministic — same session → same fingerprint', () => {
  assert.equal(seededIdiolect('sess-abc'), seededIdiolect('sess-abc'));
});

test('idiolect: varies across sessions (not always the same 2 habits)', () => {
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  const uniq = new Set(ids.map((id) => seededIdiolect(id)));
  assert.ok(uniq.size >= 3, `expected variety across sessions, got ${uniq.size} distinct`);
});

test('idiolect: picks 2 DISTINCT habits from the pool', () => {
  const picks = pickN(IDIOLECT_POOL, seedFrom('x:idiolect'), 2);
  assert.equal(picks.length, 2);
  assert.notEqual(picks[0], picks[1]);
});

test('idiolect: block is non-empty German guidance and mentions both picks', () => {
  const block = seededIdiolect('sess-xyz');
  assert.ok(block.includes('SPRACH-FINGERABDRUCK'));
  const picks = pickN(IDIOLECT_POOL, seedFrom('sess-xyz:idiolect'), 2);
  for (const p of picks) assert.ok(block.includes(p), 'block must contain each picked habit');
});

test('idiolect: register-safe — no slang leaked into the pool', () => {
  const slang = /\b(cool|krass|geil|ne\?|haste|isses|ok top|yo)\b/i;
  for (const item of IDIOLECT_POOL) assert.ok(!slang.test(item), `slang in pool item: ${item}`);
});
