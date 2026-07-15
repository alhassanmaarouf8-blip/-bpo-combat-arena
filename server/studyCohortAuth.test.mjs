import test from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'cohort-auth-test-' + 'y'.repeat(32);
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const IDS = [`auth_${RUN}_01`, `auth_${RUN}_02`, `auth_${RUN}_03`];
process.env.AUTH_SECRET ||= 'test-secret-not-prod';
process.env.STUDY_COHORT_MODE = 'beta';
process.env.STUDY_COHORT_INVITE_SECRET = SECRET;
process.env.STUDY_COHORT_INVITE_IDS = IDS.join(',');

const auth = await import('./auth.js');
const { createStudyCohortInvite } = await import('./studyCohortInvite.js');
const uniq = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
const invite = (id) => createStudyCohortInvite({
  inviteId:id, expiresAt:Date.now() + 60 * 60 * 1000, secret:SECRET,
});

test('generic accounts retain the exact three-day trial and expose no study state', async (t) => {
  const account = await auth.createAccount(uniq('generic-study-control'), 'password1234', null);
  t.after(() => auth.deleteAccount(account));
  const view = auth.publicAccount(account);
  assert.equal(auth.FREE_TRIAL_DAYS, 3);
  assert.equal(Object.hasOwn(view, 'studyAccess'), false);
  assert.equal(Object.hasOwn(view.subscription, 'studyCohort'), false);
});

test('verified invite activates exactly 21 days without exposing token internals', async (t) => {
  const rawInvite = invite(IDS[0]);
  const account = await auth.createAccount(uniq('study-active'), 'password1234', null, null, rawInvite);
  t.after(() => auth.deleteAccount(account));

  const pending = auth.publicAccount(account);
  assert.deepEqual(pending.studyAccess, { pending:true, active:false, days:21, daysLeft:0 });
  assert.equal(Object.hasOwn(pending.subscription, 'studyCohort'), false);
  const pendingJson = JSON.stringify(pending);
  assert.equal(pendingJson.includes(IDS[0]), false);
  assert.equal(pendingJson.includes(rawInvite), false);
  assert.equal(pendingJson.includes('inviteExpiresAt'), false);

  const verification = await auth.issueEmailVerificationToken(account);
  const verified = await auth.verifyEmailToken(verification);
  const view = auth.publicAccount(verified);
  assert.deepEqual(view.studyAccess, { pending:false, active:true, days:21, daysLeft:21 });
  assert.equal(auth.trialDaysLeft(verified), 21);
  assert.equal(view.entitlement.trial.active, true);
  assert.equal(Object.hasOwn(view.subscription, 'studyCohort'), false);

  const previousIds = process.env.STUDY_COHORT_INVITE_IDS;
  process.env.STUDY_COHORT_INVITE_IDS = 'future_invite_99';
  try {
    const afterRotation = auth.publicAccount(verified);
    assert.equal(afterRotation.studyAccess.active, true);
    assert.equal(afterRotation.studyAccess.daysLeft, 21);
  } finally {
    process.env.STUDY_COHORT_INVITE_IDS = previousIds;
  }
});

test('an active invite is single-use while an expired unverified reservation is reusable', async (t) => {
  const usedToken = invite(IDS[1]);
  const first = await auth.createAccount(uniq('study-used-first'), 'password1234', null, null, usedToken);
  t.after(() => auth.deleteAccount(first));
  const verification = await auth.issueEmailVerificationToken(first);
  await auth.verifyEmailToken(verification);
  await assert.rejects(
    auth.createAccount(uniq('study-used-second'), 'password1234', null, null, usedToken),
    (error) => error?.message === 'study_invite_used' && error?.code === 409,
  );

  const reusableToken = invite(IDS[2]);
  const abandoned = await auth.createAccount(uniq('study-abandoned'), 'password1234', null, null, reusableToken);
  t.after(() => auth.deleteAccount(abandoned));
  abandoned.subscription.studyCohort.inviteExpiresAt = Date.now() - 1;
  const replacement = await auth.createAccount(uniq('study-replacement'), 'password1234', null, null, reusableToken);
  t.after(() => auth.deleteAccount(replacement));
  assert.equal(Object.hasOwn(auth.publicAccount(abandoned), 'studyAccess'), false);
  assert.deepEqual(auth.publicAccount(replacement).studyAccess, { pending:true, active:false, days:21, daysLeft:0 });
});

test('kill switch makes reserved access fail closed without changing generic entitlement', async (t) => {
  const account = await auth.createAccount(uniq('study-kill-switch'), 'password1234', null, null, invite(IDS[2]));
  t.after(() => auth.deleteAccount(account));
  const previous = process.env.STUDY_COHORT_MODE;
  process.env.STUDY_COHORT_MODE = 'off';
  try {
    assert.equal(Object.hasOwn(auth.publicAccount(account), 'studyAccess'), false);
    assert.equal(auth.FREE_TRIAL_DAYS, 3);
    assert.equal(auth.trialDaysLeft(account), 0);
  } finally {
    process.env.STUDY_COHORT_MODE = previous;
  }
});
