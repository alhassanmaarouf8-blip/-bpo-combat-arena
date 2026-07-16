import assert from 'node:assert/strict';
import test from 'node:test';
import { repairExplicitlyUntrustedSessionXp } from './store.js';

test('removes only XP explicitly awarded to untrusted sessions and is idempotent', () => {
  const profile = {
    xp: 190,
    level: 2,
    sessions: [
      { id: 'trusted', xpGained: 40, evidenceQuality: { eligible: true } },
      { id: 'typed', xpGained: 35, evidenceQuality: { eligible: false } },
      { id: 'legacy', xpGained: 20 },
    ],
  };
  assert.equal(repairExplicitlyUntrustedSessionXp(profile), true);
  assert.equal(profile.xp, 155);
  assert.equal(profile.level, 2);
  assert.equal(profile.sessions[0].xpGained, 40);
  assert.equal(profile.sessions[1].xpGained, 0);
  assert.equal(profile.sessions[1].progressExcludedReason, 'untrusted_speech_evidence');
  assert.equal(profile.sessions[2].xpGained, 20);
  assert.equal(repairExplicitlyUntrustedSessionXp(profile), false);
  assert.equal(profile.xp, 155);
});

test('records the migration without changing profiles that have no explicit invalid evidence', () => {
  const profile = { xp: 80, level: 1, sessions: [{ xpGained: 20 }] };
  assert.equal(repairExplicitlyUntrustedSessionXp(profile), true);
  assert.equal(profile.xp, 80);
  assert.equal(profile.sessions[0].xpGained, 20);
  assert.equal(profile.integrityMigrations.untrustedSessionXp, 1);
});
