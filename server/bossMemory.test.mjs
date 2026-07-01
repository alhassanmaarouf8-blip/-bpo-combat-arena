/**
 * bossMemory.test.mjs — the boss AKTE string must stay deterministic and honest:
 * every clause backed by stored data, no clause for a true first-timer, and the
 * new CONTENT memory (lastTopics — what he talked about) only with a real past session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBossMemory } from './bossMemory.js';

const NOW = Date.parse('2026-07-02T00:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();

test('bossMemory: true first-timer → null (no invented memory)', () => {
  assert.equal(buildBossMemory({ sessions: [], lastTopics: [] }, null, NOW), null);
  assert.equal(buildBossMemory({}, null, NOW), null);
});

test('bossMemory: lastTopics surface as a content clause when a past session exists', () => {
  const prof = { sessions: [{ date: day(1) }], lastTopics: ['Reiseleiterin', 'Stromanbieter'] };
  const m = buildBossMemory(prof, null, NOW);
  assert.ok(m && m.includes('Reiseleiterin') && m.includes('Stromanbieter'), `got: ${m}`);
  assert.ok(m.includes('sprach beim letzten Mal über'), `got: ${m}`);
});

test('bossMemory: lastTopics WITHOUT any past session are never mentioned', () => {
  const m = buildBossMemory({ sessions: [], lastTopics: ['Reiseleiterin'] }, null, NOW);
  assert.equal(m, null);
});

test('bossMemory: short/garbage topics are filtered out', () => {
  const prof = { sessions: [{ date: day(1) }], lastTopics: ['Ja', 'Ab', ''] };
  const m = buildBossMemory(prof, null, NOW);
  assert.ok(!m || !m.includes('sprach beim letzten Mal über'), `got: ${m}`);
});

test('bossMemory: at most two topics are quoted', () => {
  const prof = { sessions: [{ date: day(1) }], lastTopics: ['Reiseleiterin', 'Stromanbieter', 'Kündigung'] };
  const m = buildBossMemory(prof, null, NOW);
  assert.ok(m.includes('Reiseleiterin') && m.includes('Stromanbieter') && !m.includes('Kündigung'), `got: ${m}`);
});

test('bossMemory: trajectory clause (fluency up beyond noise) still works and composes with topics', () => {
  const prof = {
    sessions: [
      { date: day(3), fluency: 50, errorTags: ['dativ-akkusativ'] },
      { date: day(1), fluency: 58, errorTags: ['dativ-akkusativ'] },
    ],
    lastTopics: ['Reiseleiterin'],
  };
  const m = buildBossMemory(prof, null, NOW);
  assert.ok(m.includes('Flüssigkeit'), `got: ${m}`);
  assert.ok(m.includes('dativ-akkusativ'), `got: ${m}`);
  assert.ok(m.includes('Reiseleiterin'), `got: ${m}`);
});
