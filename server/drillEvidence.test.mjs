import test from 'node:test';
import assert from 'node:assert/strict';
import { issueDrillEvidenceReceipt, redeemDrillEvidenceReceipt, resetDrillEvidenceReceiptsForTests } from './drillEvidence.js';

test.beforeEach(() => resetDrillEvidenceReceiptsForTests());

test('server drill evidence is account-bound and one-use', () => {
  const now = 1_800_000_000_000;
  const token = issueDrillEvidenceReceipt('acct-a', { drill: 'satzbau-schmiede', correct: true }, now);
  assert.match(token, /^[a-f0-9]{48}$/u);
  assert.equal(redeemDrillEvidenceReceipt('acct-b', token, now + 1), null);
  assert.deepEqual(redeemDrillEvidenceReceipt('acct-a', token, now + 2), {
    drill: 'satzbau-schmiede', verified: true, correct: true, verifiedAt: now,
  });
  assert.equal(redeemDrillEvidenceReceipt('acct-a', token, now + 3), null);
});

test('expired, malformed and outcome-free receipts fail closed', () => {
  const now = 1_800_000_000_000;
  assert.equal(issueDrillEvidenceReceipt('acct-a', { drill: 'satzbau-schmiede' }, now), null);
  assert.equal(issueDrillEvidenceReceipt('acct-a', { drill: 'unknown', correct: true }, now), null);
  const token = issueDrillEvidenceReceipt('acct-a', { drill: 'shadowing', correct: false, voicedMs: 900 }, now);
  assert.equal(redeemDrillEvidenceReceipt('acct-a', token, now + 10 * 60 * 1000 + 1), null);
  assert.equal(redeemDrillEvidenceReceipt('acct-a', '__proto__', now), null);
});

test('client cannot smuggle extra fields or completed-set credit into another drill', () => {
  const now = 1_800_000_000_000;
  const token = issueDrillEvidenceReceipt('acct-a', {
    drill: 'shadowing', correct: true, completedSet: true, voicedMs: 999_999, transcript: 'private',
  }, now);
  assert.deepEqual(redeemDrillEvidenceReceipt('acct-a', token, now + 1), {
    drill: 'shadowing', verified: true, correct: true, voicedMs: 120_000, verifiedAt: now,
  });
});
