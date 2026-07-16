import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpokenGoldProfileSnapshot } from './spokenGoldSnapshot.js';

test('spoken gold snapshot contains only evidence required by the frozen study', () => {
  const profile = {
    userId: 'account_001',
    email: 'must-not-leak@example.com',
    whatsapp: '+201000000000',
    pushSub: { endpoint: 'private' },
    missionControlEncrypted: 'private-envelope',
    sessions: [{
      date: 1,
      sessionId: 'session_001',
      level: 'a2-b1',
      bossId: 'yasmin',
      targetRoleType: 'customer_service',
      scenarioId: 'telecom_clear_request',
      speakingTaskContract: { version: 1 },
      evidenceQuality: { version: 2, prescriptionEligible: true },
      entryInteractionEvidence: { binding: 'safe-binding' },
      priorityFix: 'free-form learner text must not leave the profile',
      transcript: 'raw transcript must not leak',
    }],
    salmaCoach: { version: 3, coachState: { improvementHistory: [{ id: 'proof' }] } },
  };

  const snapshot = buildSpokenGoldProfileSnapshot(profile);
  assert.deepEqual(Object.keys(snapshot), ['userId', 'sessions', 'salmaCoach']);
  assert.equal(snapshot.userId, 'account_001');
  assert.equal(snapshot.sessions[0].sessionId, 'session_001');
  assert.equal(snapshot.sessions[0].priorityFix, undefined);
  assert.equal(snapshot.sessions[0].transcript, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /must-not-leak|201000|private-envelope|raw transcript/u);
});

test('spoken gold snapshot is detached from mutable production state and fails closed without identity', () => {
  const profile = {
    userId: 'account_002',
    sessions: [{ sessionId: 'session_002', targetRoleType: 'customer_service' }],
    salmaCoach: { version: 3, coachState: { improvementHistory: [] } },
  };
  const snapshot = buildSpokenGoldProfileSnapshot(profile);
  profile.sessions[0].sessionId = 'mutated';
  profile.salmaCoach.coachState.improvementHistory.push({ id: 'late' });
  assert.equal(snapshot.sessions[0].sessionId, 'session_002');
  assert.deepEqual(snapshot.salmaCoach.coachState.improvementHistory, []);
  assert.throws(() => buildSpokenGoldProfileSnapshot({ sessions: [] }), /immutable account id/u);
});
