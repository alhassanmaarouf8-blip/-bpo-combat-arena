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

/**
 * Return the smallest owner-only view needed to issue a new slot safely.
 * Invite ids are not secrets; the HMAC bearer is never included here. A slot stays used forever
 * once it has been handed to an account, so an old link can never be silently reassigned.
 */
export function adminStudyCohortInventory(accounts, { env = process.env } = {}) {
  const config = studyCohortConfig(env);
  const rows = Array.isArray(accounts) ? accounts : [];
  const inviteIds = [...config.inviteIds].sort().map((baseId) => {
    const prefix = `${baseId}__`;
    const usedSlots = rows.flatMap((account) => {
      const id = account?.subscription?.studyCohort?.inviteId;
      if (typeof id !== 'string' || !id.startsWith(prefix)) return [];
      const slot = Number(id.slice(prefix.length));
      return Number.isInteger(slot) && slot >= 1 && slot <= 99 ? [slot] : [];
    }).sort((left, right) => left - right);
    return Object.freeze({ id: baseId, usedSlots: Object.freeze([...new Set(usedSlots)]) });
  });
  return Object.freeze({ configured: config.enabled, mode: config.mode, inviteIds: Object.freeze(inviteIds) });
}

export function studyCohortSlotAvailable(accounts, inviteId) {
  const id = String(inviteId || '').trim();
  if (!id) return false;
  return !(Array.isArray(accounts) ? accounts : []).some((account) =>
    account?.subscription?.studyCohort?.inviteId === id);
}

export default { createAdminStudyInviteLink, adminStudyCohortInventory, studyCohortSlotAvailable };
