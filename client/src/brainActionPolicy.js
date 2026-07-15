const GENERIC_INTERVIEW_ACTIONS = new Set(['interview', 'measure']);

/**
 * The home may expose one primary action only. Once BrainGuide owns the returning-user
 * journey, the legacy arena button is allowed only when it is the exact action selected
 * by the authoritative server directive. Missing, loading, failed, or unknown directives
 * fail closed instead of silently turning into an interview.
 */
export function primaryActionPolicy({ brainGuideEnabled = false, missionContinuation = false,
  status = 'idle', directive = null } = {}) {
  if (!brainGuideEnabled || !missionContinuation) {
    return { owner: 'legacy', action: 'interview', showGenericInterview: true };
  }
  const action = typeof directive?.prescription?.action === 'string'
    ? directive.prescription.action : null;
  if (status !== 'ready' || !action) {
    return { owner: 'brain', action: null, showGenericInterview: false };
  }
  return {
    owner: 'brain',
    action,
    showGenericInterview: GENERIC_INTERVIEW_ACTIONS.has(action),
  };
}

export default primaryActionPolicy;
