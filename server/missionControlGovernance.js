/**
 * Operational interlocks layered over the pure Mission Control entitlement
 * calculation. Keeping rollout validation here makes the router fail closed
 * without coupling market-validation state to the core data model.
 */
import { missionControlFlagsFor } from './missionControlCore.js';
import { trackedApplicationsFor } from './plans.config.js';

function enabledFlag(value) {
  return /^(?:1|true|on)$/iu.test(String(value || '').trim());
}

export function trackerLimitForMissionFlags(flags) {
  if (!flags || typeof flags !== 'object') return 0;
  if (flags.admin || flags.trial) return trackedApplicationsFor('elite');
  return trackedApplicationsFor(
    flags.plan === 'basic' || flags.plan === 'elite' ? flags.plan : 'free',
  );
}

export function applyMissionControlGovernance(flags, env = process.env) {
  const safeFlags = flags && typeof flags === 'object' ? flags : {};
  // The current JSON/KV profile store serializes writes only inside one Node
  // process. Until a database compare-and-swap migration lands, enabling a
  // second writer could silently lose a concurrent mutation. Production must
  // therefore explicitly attest that exactly one Mission Control writer is
  // running. Missing or malformed configuration fails every write-capable
  // feature closed; read-only legacy product behavior is unaffected.
  const singleWriterConfirmed = enabledFlag(env?.MISSION_CONTROL_SINGLE_WRITER_CONFIRMED);
  return {
    ...safeFlags,
    singleWriterConfirmed,
    interviewPassEnabled:safeFlags.interviewPassEnabled === true && singleWriterConfirmed,
    copilotEnabled:safeFlags.copilotEnabled === true && singleWriterConfirmed,
    targetedLive:safeFlags.targetedLive === true && singleWriterConfirmed,
    canTrackApplications:trackerLimitForMissionFlags(safeFlags),
    // Discovery is a post-validation feature. Neither the live switch nor the
    // concierge switch can enable it independently, and malformed values are off.
    jobDiscoveryLive:safeFlags.jobDiscoveryLive === true
      && singleWriterConfirmed
      && enabledFlag(env?.MISSION_CONTROL_CONCIERGE_VALIDATED),
  };
}

export function governedMissionControlFlagsFor(account, options = {}) {
  const env = options?.env || (Object.hasOwn(options || {}, 'INTERVIEW_PASS_MODE')
    ? options : process.env);
  return applyMissionControlGovernance(
    missionControlFlagsFor(account, { ...options, env }),
    env,
  );
}
