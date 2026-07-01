/**
 * realtimeClient.test.mjs — the mechanical thread-following backstop must stay bounded:
 * it fires ONLY on substantive answers that opened a NEW thread, only in Teil 1–2, at most
 * 3× per session, never back-to-back, and never when a rescue/correction owns the turn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { threadNudge } from './realtimeClient.js';

const base = { freshTerms: ['Reiseleiterin'], wordCount: 20, stageIdx: 0, used: 0, cooldown: 0, busy: false };

test('threadNudge: substantive answer with a fresh term → nudge names the term', () => {
  const n = threadNudge(base);
  assert.ok(n && n.includes('Reiseleiterin'), `got: ${n}`);
  assert.ok(n.includes('FADEN'), `got: ${n}`);
});

test('threadNudge: no fresh terms → no nudge (an answer that stays on known ground opens nothing)', () => {
  assert.equal(threadNudge({ ...base, freshTerms: [] }), null);
});

test('threadNudge: short answers never nudge (a 5-word reply is not an opened thread)', () => {
  assert.equal(threadNudge({ ...base, wordCount: 5 }), null);
});

test('threadNudge: roleplay stage stands down (the customer follows its own script)', () => {
  assert.equal(threadNudge({ ...base, stageIdx: 2 }), null);
});

test('threadNudge: session cap of 3 and cooldown block further nudges', () => {
  assert.equal(threadNudge({ ...base, used: 3 }), null);
  assert.equal(threadNudge({ ...base, cooldown: 1 }), null);
});

test('threadNudge: rescue/correction turns are never doubled up', () => {
  assert.equal(threadNudge({ ...base, busy: true }), null);
});

test('threadNudge: at most two terms are quoted', () => {
  const n = threadNudge({ ...base, freshTerms: ['Reiseleiterin', 'Stromanbieter', 'Kündigung'] });
  assert.ok(n.includes('Reiseleiterin') && n.includes('Stromanbieter') && !n.includes('Kündigung'), `got: ${n}`);
});
