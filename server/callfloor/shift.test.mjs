/**
 * shift.test.mjs — the shift lifecycle: budget clamped to the daily ceiling, the time-window
 * that defines a shift's calls, and one-active-shift-per-user supersession.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

delete process.env.DATABASE_URL;                       // file-store path (no DB) → secondsUsedToday reads empty
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cf-shift-'));
process.env.CALLFLOOR_DATA_DIR = tmp;
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

const shift = await import('./shift.js');

test('startShift: length clamped to the remaining daily ceiling', async () => {
  shift._resetForTest();
  const prev = process.env.CALLFLOOR_DAILY_MIN;
  process.env.CALLFLOOR_DAILY_MIN = '5';               // 300s daily budget
  try {
    const out = await shift.startShift({ userId: 'u1', targetMin: 40 });   // asks 2400s
    assert.equal(out.shift.targetSec, 300);            // clamped to the 300s remaining
    assert.ok(shift.getShift('u1'));
  } finally {
    if (prev === undefined) delete process.env.CALLFLOOR_DAILY_MIN; else process.env.CALLFLOOR_DAILY_MIN = prev;
  }
});

test('startShift: unknown length falls back to the smallest allowed option', async () => {
  shift._resetForTest();
  const out = await shift.startShift({ userId: 'u2', targetMin: 999 });
  assert.equal(out.shift.targetSec, shift.SHIFT_MINUTES[0] * 60);
});

test('resultsInShift: only calls created at/after the shift start count', () => {
  const s = { startedAt: 1000 };
  const all = [
    { sessionId: 'before', createdAt: 500 },
    { sessionId: 'during1', createdAt: 1000 },
    { sessionId: 'during2', createdAt: 5000 },
  ];
  const inShift = shift.resultsInShift(s, all).map((r) => r.sessionId);
  assert.deepEqual(inShift, ['during1', 'during2']);
  assert.deepEqual(shift.resultsInShift(null, all), []);
});

test('one active shift per user — a new shift supersedes the old', async () => {
  shift._resetForTest();
  const a = await shift.startShift({ userId: 'u3', targetMin: 10 });
  const b = await shift.startShift({ userId: 'u3', targetMin: 20 });
  // Reference identity is the robust invariant (values may coincide when the daily budget clamps both).
  assert.equal(shift.getShift('u3'), b.shift);   // the active shift IS the newer one …
  assert.notEqual(shift.getShift('u3'), a.shift); // … and NOT the superseded one
  assert.equal(shift.endShift('u3'), b.shift);
  assert.equal(shift.getShift('u3'), null);
});
