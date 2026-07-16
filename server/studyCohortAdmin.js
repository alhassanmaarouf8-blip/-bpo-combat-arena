import { createStudyCohortInvite, studyCohortConfig } from './studyCohortInvite.js';

const MIN_HOURS = 1;
const MAX_HOURS = 24 * 45;

function safeAppUrl(value) {
  const url = new URL(String(value || 'https://omni-perform.vercel.app/'));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('invalid_study_app_url');
  }
  url.search = '';
  url.hash = '';
  return url;
}

export function createAdminStudyInviteLink({ inviteId, participantSlot, validHours = 72, env = process.env,
  now = Date.now() } = {}) {
  const config = studyCohortConfig(env);
  const baseId = String(inviteId || '').trim();
  const slot = Number(participantSlot);
  const hours = Number(validHours);
  if (!config.enabled) throw new Error('study_cohort_not_configured');
  if (!config.inviteIds.has(baseId)) throw new Error('invite_id_not_allowlisted');
  if (!Number.isInteger(slot) || slot < 1 || slot > 99) throw new Error('invalid_participant_slot');
  const id = `${baseId}__${String(slot).padStart(2, '0')}`;
  if (!Number.isInteger(hours) || hours < MIN_HOURS || hours > MAX_HOURS) {
    throw new Error('invalid_validity_hours');
  }
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_now');

  const expiresAt = now + hours * 60 * 60 * 1000;
  const token = createStudyCohortInvite({ inviteId: id, expiresAt, secret: config.secret });
  const url = safeAppUrl(env.STUDY_COHORT_APP_URL || env.APP_URL);
  url.hash = new URLSearchParams({ study: '21d', invite: token }).toString();
  return Object.freeze({ url: url.toString(), inviteId: id, expiresAt, days: 21 });
}

export default { createAdminStudyInviteLink };
