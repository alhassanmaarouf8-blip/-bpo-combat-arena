/**
 * usage.test.mjs — pins the Call Floor Phase 1 cost instrumentation:
 * price-book math (list vs actual), event shaping, the no-DB JSONL fallback round-trip,
 * and the loggedChat wrapper's pass-through + never-throws-from-logging contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { PRICEBOOK, priceChatUsage } from './pricebook.config.js';
import { shapeUsageEvent, recordAiUsage, readUsageEvents } from './usage.js';
import { loggedChat } from './loggedChat.js';

// These tests exercise the FILE fallback — they must not accidentally hit a real database.
delete process.env.DATABASE_URL;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cf-usage-'));
process.env.CALLFLOOR_USAGE_FILE = path.join(tmp, 'usage.jsonl');
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

test('priceChatUsage: Groq list rate is charged, actual is free-tier zero', () => {
  const p = priceChatUsage('groq:llama-3.3-70b-versatile', { prompt_tokens: 1000, completion_tokens: 500 });
  assert.equal(p.known, true);
  assert.ok(Math.abs(p.usdList - (1000 * 0.59e-6 + 500 * 0.79e-6)) < 1e-12);
  assert.equal(p.usdActual, 0);
  assert.equal(p.unitsIn, 1000);
  assert.equal(p.unitsOut, 500);
});

test('priceChatUsage: unknown provider is flagged, never silently zero-known', () => {
  const p = priceChatUsage('mystery:model-x', { prompt_tokens: 10, completion_tokens: 10 });
  assert.equal(p.known, false);
  assert.equal(p.usdList, 0);
});

test('priceChatUsage: provider-family fallback prices an unlisted cerebras model', () => {
  const p = priceChatUsage('cerebras:new-model', { prompt_tokens: 100, completion_tokens: 100 });
  assert.equal(p.known, true);
  assert.ok(p.usdList > 0);
  assert.equal(p.usdActual, 0);
});

test('pricebook hygiene: every entry has list, actual, checkedOn, source', () => {
  for (const [key, e] of Object.entries(PRICEBOOK)) {
    assert.ok(e.list && e.actual && e.checkedOn && e.source, `pricebook entry ${key} incomplete`);
    assert.match(e.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `pricebook ${key} checkedOn must be a date`);
  }
});

test('shapeUsageEvent: rejects bad unitType, clamps negatives, defaults measured=true', () => {
  assert.equal(shapeUsageEvent({ unitType: 'bananas' }), null);
  const row = shapeUsageEvent({ unitType: 'tokens', unitsIn: -5, usdList: -1, userId: '  u1  ' });
  assert.equal(row.unitsIn, 0);
  assert.equal(row.usdList, 0);
  assert.equal(row.userId, 'u1');
  assert.equal(row.measured, true);
  assert.equal(shapeUsageEvent({ unitType: 'seconds', measured: false }).measured, false);
});

test('recordAiUsage: JSONL fallback round-trips and filters by user', async () => {
  const a = await recordAiUsage({ userId: 'userA', feature: 'test-f', provider: 'groq',
    model: 'llama-3.3-70b-versatile', unitType: 'tokens', unitsIn: 10, unitsOut: 5, usdList: 0.001 });
  const b = await recordAiUsage({ userId: 'userB', feature: 'test-f', provider: 'deepgram',
    model: 'aura-2', unitType: 'chars', unitsOut: 400, measured: false });
  assert.deepEqual([a.ok, a.sink, b.ok, b.sink], [true, 'file', true, 'file']);
  const all = await readUsageEvents();
  assert.equal(all.length, 2);
  const onlyA = await readUsageEvents({ userId: 'userA' });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].feature, 'test-f');
  assert.equal((await readUsageEvents({ userId: 'userB' }))[0].measured, false);
});

test('recordAiUsage: malformed event → ok:false, never throws', async () => {
  const r = await recordAiUsage({ unitType: 'nope' });
  assert.deepEqual(r, { ok: false, sink: null });
});

test('loggedChat: passes the chat result through unchanged and records a measured row', async () => {
  const fake = { content: '{"x":1}', usage: { prompt_tokens: 200, completion_tokens: 40 },
    provider: 'groq:llama-3.3-70b-versatile', finishReason: 'stop' };
  const res = await loggedChat({ messages: [] }, { userId: 'userC', feature: 'callfloor-test', _chat: async () => fake });
  assert.deepEqual(res, fake);                       // byte-identical pass-through
  const rows = await readUsageEvents({ userId: 'userC' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, 'groq');
  assert.equal(rows[0].model, 'llama-3.3-70b-versatile');
  assert.ok(rows[0].usdList > 0);
  assert.equal(rows[0].usdActual, 0);
  assert.equal(rows[0].measured, true);
});

test('loggedChat: a provider failure propagates to the caller (failure semantics unchanged)', async () => {
  await assert.rejects(
    () => loggedChat({ messages: [] }, { _chat: async () => { throw new Error('all_providers_failed'); } }),
    /all_providers_failed/,
  );
});

test('loggedChat: logging failure never reaches the caller', async () => {
  // Point the fallback file at an impossible path (a directory that is actually a file).
  const blocker = path.join(tmp, 'blocker');
  await (await import('node:fs/promises')).writeFile(blocker, 'x');
  const prev = process.env.CALLFLOOR_USAGE_FILE;
  process.env.CALLFLOOR_USAGE_FILE = path.join(blocker, 'cant', 'exist.jsonl');
  try {
    const fake = { content: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1 }, provider: 'groq:llama-3.3-70b-versatile' };
    const res = await loggedChat({ messages: [] }, { _chat: async () => fake });
    assert.deepEqual(res, fake);                     // caller still gets the result
  } finally {
    process.env.CALLFLOOR_USAGE_FILE = prev;
  }
});

test('usage file content is one valid JSON object per line', async () => {
  const text = await readFile(process.env.CALLFLOOR_USAGE_FILE, 'utf8');
  for (const line of text.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
});
