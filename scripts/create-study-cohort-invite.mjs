import { createStudyCohortInvite, studyCohortConfig, studyInviteIdAllowed } from '../server/studyCohortInvite.js';

const inviteId = String(process.argv[2] || '').trim();
const validHours = Number(process.argv[3] || 72);
const config = studyCohortConfig(process.env);

if (!config.enabled) throw new Error('study_cohort_not_configured');
if (!studyInviteIdAllowed(inviteId)) throw new Error('invite_id_not_allowlisted');
if (!Number.isInteger(validHours) || validHours < 1 || validHours > 24 * 45) throw new Error('invalid_validity_hours');

const token = createStudyCohortInvite({
  inviteId,
  expiresAt:Date.now() + validHours * 60 * 60 * 1000,
  secret:config.secret,
});
const appUrl = new URL(process.env.STUDY_COHORT_APP_URL || 'https://omni-perform.vercel.app/');
appUrl.hash = new URLSearchParams({ study:'21d', invite:token }).toString();
process.stdout.write(`${appUrl}\n`);
