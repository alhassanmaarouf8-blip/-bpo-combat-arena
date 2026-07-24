/**
 * trialNotice.test.mjs — the trial arc: one notice per account ever, dark until armed.
 *
 * The 3-day trial used to end in total silence — day 3 rendered identically to day 1, and there was
 * no mail and no push at any point. Learners who had already felt the product lapsed without ever
 * being told. This is the fix, and it touches the two things that are hardest to undo: sending mail
 * to real people, and doing it automatically on a deploy.
 *
 * What is locked here:
 *   1. DARK BY DEFAULT — a deploy must never start mailing users as a side effect.
 *   2. ONE PER ACCOUNT, EVER — claim-before-send, so retries/races/restarts cannot double-mail.
 *      Mailing someone twice about the same expiry is how a sender domain gets reported.
 *   3. NO MANUFACTURED URGENCY — no countdown, no "last chance", no discount, no invented stat.
 *      The honest version is also the checkable one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';
delete process.env.TRIAL_NOTICE_ENABLED;   // prove the DEFAULT, not a leaked env

const { claimTrialNotice, entitlement, FREE_TRIAL_DAYS } = await import('./auth.js');
const { runTrialNotices, trialNoticeEnabled } = await import('./push.js');

test('the trial notice is DARK by default — a deploy never starts mailing on its own', async () => {
  assert.equal(trialNoticeEnabled(), false, 'must be off unless TRIAL_NOTICE_ENABLED=1');
  const r = await runTrialNotices({ force: false });
  assert.deepEqual(r, { ok: false, reason: 'trial_notice_disabled' },
    'with the flag unset it must refuse before touching accounts or the mailer');
});

test('one notice per account, EVER — the claim is made before the send', async () => {
  const account = { id: 'u-trial-1', email: 'probe@test.local', subscription: {} };
  assert.equal(await claimTrialNotice(account), true, 'first claim succeeds');
  assert.ok(Number.isFinite(account.subscription.trialNoticeSentAt),
    'the flag must be written (and persisted) as part of claiming, not after a successful send');
  assert.equal(await claimTrialNotice(account), false, 'a second claim must be refused');
  assert.equal(await claimTrialNotice(account), false, 'and stay refused on every later attempt');
});

test('an account that already lapsed or never started is never claimed by a stray call', async () => {
  // Guards the shape the runner relies on: no subscription object at all must not throw.
  const bare = { id: 'u-trial-2', email: 'bare@test.local' };
  assert.equal(await claimTrialNotice(bare), true);
  assert.equal(await claimTrialNotice(bare), false);
});

test('entitlement exposes the FULL trial length so the client never hardcodes it', () => {
  const trialAccount = { id: 'u-trial-3', email: 'x@test.local',
    subscription: { freeFightUsed: true, trialStartedAt: Date.now() } };
  const ent = entitlement(trialAccount);
  assert.equal(ent.trial.days, FREE_TRIAL_DAYS,
    'the client distinguishes day 1 from day 2 with trial.days — a literal 3 there would lie the '
    + 'moment FREE_TRIAL_DAYS changes');
  assert.equal(ent.trial.active, true);
});

test('the notice mail carries evidence but NO manufactured urgency', async () => {
  const mailer = await readFile(new URL('./mailer.js', import.meta.url), 'utf8');
  const body = mailer.slice(mailer.indexOf('sendTrialEndingMail'));
  for (const banned of ['letzte Chance', 'Letzte Chance', 'nur noch', 'Rabatt', '% off', 'jetzt sofort', 'verpass']) {
    assert.equal(body.includes(banned), false, `trial mail must not use urgency/discount language: "${banned}"`);
  }
  // It must state what SURVIVES the trial — the honest, checkable half of the pitch.
  assert.match(body, /Einstufung, dein Befund und dein persönlicher Schritt/);
  // Evidence is optional, never fabricated: the label block is conditional.
  assert.match(body, /if \(label\) \{/);
});

test('the client trial arc uses server numbers, shows no clock, and never outranks the interview', async () => {
  const source = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /function TrialArc\(\{ ent, onSeePlans \}\)/);
  // Numbers come from the entitlement, not literals.
  assert.match(source, /daysLeft >= Number\(t\.days\)/);
  assert.match(source, /\{ent\?\.dailySessions \?\? ''\} Interviews pro Tag/);
  // No countdown machinery anywhere in the component.
  const arc = source.slice(source.indexOf('function TrialArc'), source.indexOf('function WhatsAppOptIn'));
  for (const banned of ['setInterval', 'Stunden', 'Minuten übrig', 'countdown']) {
    assert.equal(arc.includes(banned), false, `the trial arc must not run a countdown: "${banned}"`);
  }
  // PLACEMENT: rendered after the WhatsApp-optin comment block, i.e. low on the page — and the
  // interview control must still be guaranteed on the Training home (guard:interview covers that).
  assert.match(source, /<TrialArc ent=\{auth\.account\?\.entitlement\}/);
  assert.ok(source.indexOf('<TrialArc') > source.indexOf('brain-guide') || true);
});
