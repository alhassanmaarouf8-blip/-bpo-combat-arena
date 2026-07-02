/**
 * geminiBudget.test.mjs — the money math + the monthly hard cap that guards the ONLY paid path.
 * These are load-bearing: a wrong rate or a broken delta could silently overspend the owner's cap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Point persistence at a throwaway file and pin the cap BEFORE importing (env is read at import).
const TMP = path.join(os.tmpdir(), `gemini-budget-test-${process.pid}.json`);
process.env.GEMINI_BUDGET_FILE = TMP;
process.env.GEMINI_BUDGET_USD = '5';
try { fs.unlinkSync(TMP); } catch {}
const budget = (await import('./geminiBudget.js')).default;

const audioIn  = (n) => ({ promptTokensDetails:   [{ modality: 'AUDIO', tokenCount: n }] });
const audioOut = (n) => ({ responseTokensDetails: [{ modality: 'AUDIO', tokenCount: n }] });
const textIn   = (n) => ({ promptTokensDetails:   [{ modality: 'TEXT',  tokenCount: n }] });
const textOut  = (n) => ({ responseTokensDetails: [{ modality: 'TEXT',  tokenCount: n }] });

test('usageToCostUsd prices each modality at the verified Gemini rates', () => {
  assert.equal(budget.usageToCostUsd(audioIn(1_000_000)),  3,   'audio in  = $3/M');
  assert.equal(budget.usageToCostUsd(audioOut(1_000_000)), 12,  'audio out = $12/M');
  assert.equal(budget.usageToCostUsd(textIn(1_000_000)),   0.5, 'text in   = $0.50/M');
  assert.equal(budget.usageToCostUsd(textOut(1_000_000)),  2,   'text out  = $2/M');
});

test('usageToCostUsd counts native-audio thinking tokens at the output rate', () => {
  assert.equal(budget.usageToCostUsd({ thoughtsTokenCount: 1_000_000 }), 2);
  // combined: 1M audio-out ($12) + 1M thoughts ($2) = $14
  assert.equal(budget.usageToCostUsd({ ...audioOut(1_000_000), thoughtsTokenCount: 1_000_000 }), 14);
});

test('usageToCostUsd falls back to audio when only bulk counts are present (never undershoots)', () => {
  // No detail arrays → treat promptTokenCount as audio-in, responseTokenCount as audio-out.
  const cost = budget.usageToCostUsd({ promptTokenCount: 1_000_000, responseTokenCount: 1_000_000 });
  assert.equal(cost, 3 + 12);
});

test('usageToCostUsd handles null / empty safely', () => {
  assert.equal(budget.usageToCostUsd(null), 0);
  assert.equal(budget.usageToCostUsd({}), 0);
});

test('recordSessionUsage folds only the DELTA of a cumulative report into the month total', () => {
  budget._resetForTest(0);
  // First report this session: cumulative $3 → month $3.
  let r = budget.recordSessionUsage(0, audioIn(1_000_000));
  assert.equal(r.sessionUsd, 3);
  assert.equal(r.deltaUsd, 3);
  assert.equal(r.monthUsd, 3);
  assert.equal(r.capped, false);
  // Same session, unchanged cumulative report → delta 0, month unchanged.
  r = budget.recordSessionUsage(3, audioIn(1_000_000));
  assert.equal(r.deltaUsd, 0);
  assert.equal(r.monthUsd, 3);
});

test('recordSessionUsage trips the cap once the month total reaches it', () => {
  budget._resetForTest(0);
  budget.recordSessionUsage(0, audioIn(1_000_000));               // month $3
  // Cumulative jumps to $3 audio-in + $12 audio-out = $15 → delta $12 → month $15 ≥ $5 cap.
  const r = budget.recordSessionUsage(3, { ...audioIn(1_000_000), ...audioOut(1_000_000) });
  assert.equal(r.deltaUsd, 12);
  assert.equal(r.capped, true);
  assert.equal(budget.isCapped(), true);
});

test('a report pricing BELOW the previous total is counted in full (never undercount)', () => {
  budget._resetForTest(0);
  // Cumulative report: $3 → month $3.
  budget.recordSessionUsage(0, audioIn(1_000_000));
  // Anomaly: the next report prices LOWER than the running total ($0.50). Under cumulative
  // semantics this cannot happen — so treat it as an incremental report and add it whole.
  const r = budget.recordSessionUsage(3, textIn(1_000_000));
  assert.equal(r.deltaUsd, 0.5);
  assert.equal(r.monthUsd, 3.5);
});

test('a fresh month starts uncapped at $0', () => {
  budget._resetForTest(0);
  assert.equal(budget.spentThisMonth(), 0);
  assert.equal(budget.isCapped(), false);
  assert.equal(budget.capUsd(), 5);
});

test.after(() => { try { fs.unlinkSync(TMP); } catch {} });
