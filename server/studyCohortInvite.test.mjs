import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createStudyCohortInvite, STUDY_COHORT_DAYS, STUDY_COHORT_ID,
  validateStudyCohortInvite } from './studyCohortInvite.js';

const SECRET = 'cohort-test-key-' + 'x'.repeat(32);
const ID = 'candidate_0001';
const NOW = 1_800_000_000_000;
const env = (overrides = {}) => ({
  STUDY_COHORT_MODE: 'beta',
  STUDY_COHORT_INVITE_SECRET: SECRET,
  STUDY_COHORT_INVITE_IDS: ID,
  ...overrides,
});

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

test('study invite validates only the exact allowlisted 21-day cohort payload', () => {
  const token = createStudyCohortInvite({ inviteId:ID, expiresAt:NOW + 86_400_000, secret:SECRET });
  assert.deepEqual(validateStudyCohortInvite(token, { env:env(), now:NOW }), {
    cohortId: STUDY_COHORT_ID, inviteId:ID, days:STUDY_COHORT_DAYS, expiresAt:NOW + 86_400_000,
  });
  assert.equal(validateStudyCohortInvite(token, { env:env({ STUDY_COHORT_MODE:'off' }), now:NOW }), null);
  assert.equal(validateStudyCohortInvite(token, { env:env({ STUDY_COHORT_INVITE_SECRET:'' }), now:NOW }), null);
  assert.equal(validateStudyCohortInvite(token, { env:env({ STUDY_COHORT_INVITE_IDS:'someone_else' }), now:NOW }), null);
});

test('study invite fails closed for tampering, expiry, oversized tokens, and extra keys', () => {
  const token = createStudyCohortInvite({ inviteId:ID, expiresAt:NOW + 60_000, secret:SECRET });
  assert.equal(validateStudyCohortInvite(`${token.slice(0, -1)}x`, { env:env(), now:NOW }), null);
  assert.equal(validateStudyCohortInvite(token, { env:env(), now:NOW + 60_000 }), null);
  assert.equal(validateStudyCohortInvite('x'.repeat(2049), { env:env(), now:NOW }), null);
  assert.equal(validateStudyCohortInvite('not.a.valid.token', { env:env(), now:NOW }), null);

  const future = signPayload({ v:1, cohort:STUDY_COHORT_ID, inviteId:ID, days:21,
    exp:NOW + 46 * 86_400_000 });
  assert.equal(validateStudyCohortInvite(future, { env:env(), now:NOW }), null);
  const extra = signPayload({ v:1, cohort:STUDY_COHORT_ID, inviteId:ID, days:21,
    exp:NOW + 60_000, __proto__:null, unexpected:'directive' });
  assert.equal(validateStudyCohortInvite(extra, { env:env(), now:NOW }), null);
});

test('invite creation rejects weak secrets, malformed ids, and invalid expiry', () => {
  assert.throws(() => createStudyCohortInvite({ inviteId:'short', expiresAt:NOW, secret:SECRET }), /invalid_invite_id/);
  assert.throws(() => createStudyCohortInvite({ inviteId:ID, expiresAt:0, secret:SECRET }), /invalid_invite_expiry/);
  assert.throws(() => createStudyCohortInvite({ inviteId:ID, expiresAt:NOW, secret:'weak' }), /invalid_invite_secret/);
});
