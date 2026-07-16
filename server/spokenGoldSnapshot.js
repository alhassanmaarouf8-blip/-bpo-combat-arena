/**
 * Build the smallest private server snapshot needed by the frozen spoken gold study.
 *
 * This deliberately excludes account/contact data, push subscriptions, free-form feedback,
 * vacancy data, payment state and every unrelated profile field. The study derivation reads only
 * immutable account identity, bounded server-recorded session evidence and Salma's bounded
 * transfer-proof state.
 */

const SESSION_KEYS = Object.freeze([
  'date',
  'sessionId',
  'level',
  'bossId',
  'targetRoleType',
  'scenarioId',
  'targetIndustry',
  'vacancyTargetId',
  'speakingTaskContract',
  'evidenceQuality',
  'wpm',
  'giveUpRate',
  'intelligibility',
  'deescalationEvidence',
  'entryInteractionEvidence',
  'grammarMeasured',
  'grammarRules',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedAccountId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 120) throw new Error('Profile lacks a bounded immutable account id');
  return id;
}

function projectSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const projected = {};
  for (const key of SESSION_KEYS) {
    if (Object.hasOwn(value, key)) projected[key] = value[key];
  }
  return projected;
}

export function buildSpokenGoldProfileSnapshot(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('Profile must be an object');
  }
  const sessions = Array.isArray(profile.sessions)
    ? profile.sessions.map(projectSession).filter(Boolean)
    : [];
  const salmaCoach = profile.salmaCoach && typeof profile.salmaCoach === 'object'
    && !Array.isArray(profile.salmaCoach)
    ? profile.salmaCoach
    : { version: 3, coachState: { improvementHistory: [] } };
  return cloneJson({
    userId: boundedAccountId(profile.userId),
    sessions,
    salmaCoach,
  });
}

export default { buildSpokenGoldProfileSnapshot };
