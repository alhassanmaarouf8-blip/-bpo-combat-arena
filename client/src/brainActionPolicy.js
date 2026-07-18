/**
 * The home may expose one primary action only. Once BrainGuide owns the returning-user
 * journey, its action is the only primary action. BrainGuide can still launch an interview,
 * but the legacy arena button must not duplicate or contradict it. Missing, loading, failed,
 * or unknown directives fail closed instead of silently turning into an interview.
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
    showGenericInterview: false,
  };
}

export default primaryActionPolicy;
