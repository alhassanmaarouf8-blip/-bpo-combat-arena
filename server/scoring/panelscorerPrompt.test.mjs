import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoringPrompt } from './panelscorer.mjs';

test('post-session scorer stays role-neutral and never claims an employer decision', () => {
  const generic = buildScoringPrompt({ level: 'a2-b1', scenarioId: 'general', transcript: 'Ich bin bereit.' });
  const system = generic.messages[0].content;
  assert.equal(system.includes('internal training simulation only'), true);
  assert.equal(system.includes('not an employer decision'), true);
  assert.equal(system.includes('would be SEATED'), false);
  assert.equal(system.includes('would clear the HR phone-screen'), false);
});
