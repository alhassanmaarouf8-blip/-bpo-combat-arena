import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INTERVIEW_PASS_CLAIM_KEY,
  bindPendingInterviewPassClaimToEmail,
  clearPendingInterviewPassClaim,
  markInterviewPassClaimed,
  readPendingInterviewPassClaim,
  wasInterviewPassClaimed,
  writePendingInterviewPassClaim,
} from './interviewPassClaimStore.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const pending = { previewToken:'signed.one-use.token', expiresAt:'2026-07-13T12:20:00.000Z' };

test('pending claim uses cross-tab local storage and clears both stores', () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  assert.equal(writePendingInterviewPassClaim(pending, { localStorage, sessionStorage, now:NOW }), true);
  assert.ok(localStorage.getItem(INTERVIEW_PASS_CLAIM_KEY));
  assert.equal(sessionStorage.getItem(INTERVIEW_PASS_CLAIM_KEY), null);
  assert.deepEqual(readPendingInterviewPassClaim({ localStorage, sessionStorage, now:NOW }), pending);
  clearPendingInterviewPassClaim({ localStorage, sessionStorage });
  assert.equal(localStorage.getItem(INTERVIEW_PASS_CLAIM_KEY), null);
  assert.equal(sessionStorage.getItem(INTERVIEW_PASS_CLAIM_KEY), null);
});

test('a valid legacy session claim migrates to cross-tab storage', () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  sessionStorage.setItem(INTERVIEW_PASS_CLAIM_KEY, JSON.stringify(pending));
  assert.deepEqual(readPendingInterviewPassClaim({ localStorage, sessionStorage, now:NOW }), pending);
  assert.ok(localStorage.getItem(INTERVIEW_PASS_CLAIM_KEY));
  assert.equal(sessionStorage.getItem(INTERVIEW_PASS_CLAIM_KEY), null);
});

test('expired or malformed claims fail closed and are removed', () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  localStorage.setItem(INTERVIEW_PASS_CLAIM_KEY, JSON.stringify({ ...pending, expiresAt:'2026-07-13T11:59:59.000Z' }));
  assert.equal(readPendingInterviewPassClaim({ localStorage, sessionStorage, now:NOW }), null);
  assert.equal(localStorage.getItem(INTERVIEW_PASS_CLAIM_KEY), null);
});

test('claimed-pass continuity marker is isolated by account id', () => {
  const localStorage = new MemoryStorage();
  assert.equal(markInterviewPassClaimed('acct_one', { localStorage }), true);
  assert.equal(wasInterviewPassClaimed('acct_one', { localStorage }), true);
  assert.equal(wasInterviewPassClaimed('acct_two', { localStorage }), false);
  assert.equal(markInterviewPassClaimed('bad account id', { localStorage }), false);
});

test('pending pass is consumed only by the account email bound after signup', () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const options = { localStorage, sessionStorage, now:NOW };
  assert.equal(writePendingInterviewPassClaim(pending, options), true);
  assert.equal(readPendingInterviewPassClaim({ ...options, accountEmail:'owner@example.com' }), null);
  assert.equal(bindPendingInterviewPassClaimToEmail('Owner@Example.com', options), true);
  assert.deepEqual(readPendingInterviewPassClaim({ ...options, accountEmail:'owner@example.com' }), {
    ...pending, intendedEmail:'owner@example.com',
  });
  assert.equal(bindPendingInterviewPassClaimToEmail('other@example.com', options), false);
  assert.equal(readPendingInterviewPassClaim({ ...options, accountEmail:'other@example.com' }), null);
  assert.ok(localStorage.getItem(INTERVIEW_PASS_CLAIM_KEY), 'a mismatched read must not consume the valid handoff');
});

test('invalid intended email fails closed without destroying a pending preview', () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const options = { localStorage, sessionStorage, now:NOW };
  writePendingInterviewPassClaim(pending, options);
  assert.equal(bindPendingInterviewPassClaimToEmail('not-an-email', options), false);
  assert.deepEqual(readPendingInterviewPassClaim(options), pending);
});
