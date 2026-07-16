import test from 'node:test';
import assert from 'node:assert/strict';
import { adminStudyCohortInventory, createAdminStudyInviteLink, studyCohortSlotAvailable } from './studyCohortAdmin.js';
import { validateStudyCohortInvite } from './studyCohortInvite.js';

const SECRET = 's'.repeat(48);
const NOW = Date.parse('2026-07-16T15:00:00.000Z');
const ID = 'cohort_student_01';
const env = (overrides = {}) => ({
  STUDY_COHORT_MODE: 'beta',
  STUDY_COHORT_INVITE_SECRET: SECRET,
  STUDY_COHORT_INVITE_IDS: ID,
  APP_URL: 'https://omni-perform.vercel.app/',
  ...overrides,
});

test('admin creates a bounded one-use cohort link without exposing its token in the query', () => {
  const result = createAdminStudyInviteLink({ inviteId: ID, participantSlot: 1,
    validHours: 72, env: env(), now: NOW });
  const url = new URL(result.url);
  assert.equal(url.origin, 'https://omni-perform.vercel.app');
  assert.equal(url.search, '');
  assert.equal(url.hash.startsWith('#study=21d&invite='), true);
  const token = new URLSearchParams(url.hash.slice(1)).get('invite');
  assert.deepEqual(validateStudyCohortInvite(token, { env: env(), now: NOW }), {
    cohortId: 'omni-perform-21d-v1', inviteId: `${ID}__01`, days: 21,
    expiresAt: NOW + 72 * 60 * 60 * 1000,
  });
});

test('admin invite generation fails closed for disabled config, unknown ids, bad lifetime and unsafe URL', () => {
  assert.throws(() => createAdminStudyInviteLink({ inviteId: ID, participantSlot: 1,
    env: env({ STUDY_COHORT_MODE: 'off' }) }),
    /not_configured/u);
  assert.throws(() => createAdminStudyInviteLink({ inviteId: 'unknown_slot', participantSlot: 1,
    env: env() }), /not_allowlisted/u);
  assert.throws(() => createAdminStudyInviteLink({ inviteId: ID, participantSlot: 0,
    env: env() }), /participant_slot/u);
  assert.throws(() => createAdminStudyInviteLink({ inviteId: ID, participantSlot: 1,
    validHours: 0, env: env() }), /validity/u);
  assert.throws(() => createAdminStudyInviteLink({ inviteId: ID, participantSlot: 1,
    env: env({ APP_URL: 'http://localhost/' }) }),
    /invalid_study_app_url/u);
});

test('owner inventory reveals only safe base ids and permanently reserves used slots', () => {
  const accounts = [{ subscription: { studyCohort: { inviteId: `${ID}__02` } } }, {
    subscription: { studyCohort: { inviteId: `${ID}__07` } },
  }, { email: 'must-not-leak@example.com', subscription: {} }];
  const inventory = adminStudyCohortInventory(accounts, { env: env() });
  assert.deepEqual(inventory, { configured: true, mode: 'beta', inviteIds: [{ id: ID, usedSlots: [2, 7] }] });
  assert.doesNotMatch(JSON.stringify(inventory), /must-not-leak|ssss/u);
  assert.equal(studyCohortSlotAvailable(accounts, `${ID}__02`), false);
  assert.equal(studyCohortSlotAvailable(accounts, `${ID}__03`), true);
});
