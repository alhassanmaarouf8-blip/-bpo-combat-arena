import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import { normalizeSalmaCoachState, salmaCoachEventId } from './salmaCoachCore.js';
import { spokenReviewRouter, targetedSpokenReviewQueue, usableSpokenReviewItem } from './spokenReview.js';

process.env.AUTH_SECRET ||= 'spoken-review-targeting-test-secret';
const auth = await import('./auth.js');
const { deleteUser, loadUser, saveUser } = await import('./store.js');

const ACCOUNT_ID = 'spoken-target-owner';
const PRESCRIPTION_ID = '0123456789abcdef';

function coachState(repetitions = 2) {
  const state = normalizeSalmaCoachState(null);
  state.activePrescription = {
    id: PRESCRIPTION_ID,
    evidenceIds: ['evidence-1'],
    skillId: 'konjunktiv-2',
    drillId: 'sag-es-richtig',
    blocks: 1,
    repetitions,
    durationSeconds: 600,
    timesPerDay: 1,
    minimumSpacingMinutes: 240,
    successGate: 'Zweimal korrekt.',
    assignedAt: 1_800_000_000_000,
    nextEligibleAt: null,
  };
  return state;
}

function grammarItem(id, content, due = 0, mastered = false) {
  return { id, type: 'grammar', content, prompt: 'Korrigiere den Satz.', answer: 'Ich würde Ihnen helfen.',
    example: { wrong: 'Ich werde Ihnen helfen.', right: 'Ich würde Ihnen helfen.',
      wrongWord: 'werde', rightWord: 'würde' },
    due, mastered, reps: 0, lapses: 0, stage: 0 };
}

test('grammar labels without an exact error and correction never become impossible spoken cards', () => {
  assert.equal(usableSpokenReviewItem({ id:'broken', type:'grammar', content:'Wortstellung',
    prompt:'Sag den Satz KORREKT laut.', answer:'Wortstellung' }), false);
  assert.equal(usableSpokenReviewItem(grammarItem('complete', 'Wortstellung')), true);
});

function voicedWav(milliseconds = 800) {
  const samples = Math.ceil(24_000 * milliseconds / 1000);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(24_000, 24); buffer.writeUInt32LE(48_000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 24 < 12 ? 5_000 : -5_000, 44 + index * 2);
  }
  return buffer;
}

async function withApi(run) {
  const app = express(); app.use('/api', spokenReviewRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('an exact prescription excludes unrelated cards and survives SRS due/mastery changes', () => {
  const profile = { srs: [
    grammarItem('unrelated', 'Dativ oder Akkusativ', 0),
    grammarItem('target', 'Konjunktiv fehlt', Number.MAX_SAFE_INTEGER, true),
  ] };
  const result = targetedSpokenReviewQueue(profile, coachState(2), ACCOUNT_ID);
  assert.equal(result.prescription.targeted, true);
  assert.equal(result.prescription.missingTarget, false);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.id), ['target', 'target']);
  assert.ok(result.items.every((item) => item.prescribed === true));
});

test('an exact prescription fails honestly when no matching verified error card exists', () => {
  const profile = { srs: [grammarItem('unrelated', 'Dativ oder Akkusativ')] };
  const result = targetedSpokenReviewQueue(profile, coachState(3), ACCOUNT_ID);
  assert.deepEqual(result.items, []);
  assert.equal(result.prescription.missingTarget, true);
  assert.equal(result.prescription.remainingRepetitions, 3);
});

test('a completed prescription returns no replacement queue', () => {
  const state = coachState(1);
  state.coachState.completedBlocks[PRESCRIPTION_ID] = 1;
  state.coachState.repeatedErrorCounts[PRESCRIPTION_ID] = { blockProgress: [{
    index: 0, attempts: 1, correct: 1, failures: 0, recentOutcomes: [], lastAt: 2,
    completedAt: 2, eventIds: [], repairDebt: {},
  }] };
  const result = targetedSpokenReviewQueue(
    { srs: [grammarItem('target', 'Konjunktiv fehlt')] }, state, ACCOUNT_ID);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.prescription, { targeted: true, missingTarget: false, completed: true,
    remainingRepetitions: 0, repairsRemaining: 0 });
});

test('a failed sentence is queued for its own two repairs before other matching cards', () => {
  const profile = { srs: [
    grammarItem('other-target', 'Konjunktiv II fehlt', 0),
    grammarItem('failed-target', 'Konjunktiv fehlt', 10),
  ] };
  const state = coachState(4);
  const taskHash = salmaCoachEventId({ accountId: ACCOUNT_ID, itemId: 'failed-target',
    itemType: 'grammar', skillId: 'konjunktiv-2' });
  state.coachState.repeatedErrorCounts[PRESCRIPTION_ID] = { blockProgress: [{
    index: 0, attempts: 1, correct: 0, failures: 1, recentOutcomes: [], lastAt: 1,
    completedAt: null, eventIds: [], repairDebt: { [taskHash]: { remaining: 2, lastAt: 1 } },
  }] };
  const result = targetedSpokenReviewQueue(profile, state, ACCOUNT_ID);
  assert.deepEqual(result.items.slice(0, 2).map((item) => item.id), ['failed-target', 'failed-target']);
  assert.equal(result.prescription.repairsRemaining, 2);
});

test('GET prioritizes the exact prescribed card and grade returns authoritative completion', async () => {
  const previousMode = process.env.SALMA_COACH_MODE;
  const previousKey = process.env.GROQ_API_KEY;
  const account = await auth.createAccount(
    `spoken-target-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`, 'password1234');
  account.emailVerifiedAt = Date.now(); account.subscription.plan = 'basic';
  const token = auth.signToken(account);
  try {
    process.env.SALMA_COACH_MODE = 'on'; process.env.GROQ_API_KEY = 'route-test-key';
    const profile = await loadUser(account.id);
    profile.srs = Array.from({ length: 10 }, (_, index) =>
      grammarItem(`unrelated-${index}`, 'Dativ oder Akkusativ', index));
    profile.srs.push(grammarItem('exact-target', 'Konjunktiv fehlt', Number.MAX_SAFE_INTEGER, true));
    const state = coachState(1); const old = Date.now() - 24 * 60 * 60 * 1000;
    state.activePrescription.blocks = 2; state.activePrescription.assignedAt = old;
    state.coachState.completedBlocks[PRESCRIPTION_ID] = 1;
    state.coachState.repeatedErrorCounts[PRESCRIPTION_ID] = { blockProgress: [
      { index: 0, attempts: 1, correct: 1, failures: 0, recentOutcomes: [], lastAt: old,
        completedAt: old, eventIds: [], repairDebt: {} },
      { index: 1, attempts: 0, correct: 0, failures: 0, recentOutcomes: [], lastAt: null,
        completedAt: null, eventIds: [], repairDebt: {} },
    ] };
    profile.salmaCoach = state; await saveUser(profile);

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => String(input).startsWith('https://api.groq.com/openai/v1/audio/transcriptions')
      ? Promise.resolve(new Response('Ich würde Ihnen helfen.', { status: 200 })) : nativeFetch(input, init);
    try {
      await withApi(async (base) => {
        const queueResponse = await nativeFetch(`${base}/api/spoken-review`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(queueResponse.status, 200);
        const queue = await queueResponse.json();
        assert.deepEqual(queue.items.map((item) => item.id), ['exact-target']);
        assert.equal(queue.prescription.remainingRepetitions, 1);

        const gradeResponse = await nativeFetch(`${base}/api/spoken-review/grade?id=exact-target`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' },
          body: voicedWav(),
        });
        assert.equal(gradeResponse.status, 200);
        const gradeResult = await gradeResponse.json();
        assert.equal(gradeResult.correct, true);
        assert.deepEqual(gradeResult.prescriptionProgress, { targeted: true, credited: true,
          completed: true, remainingRepetitions: 0, repairsRemaining: 0 });
      });
    } finally { globalThis.fetch = nativeFetch; }
  } finally {
    if (previousMode === undefined) delete process.env.SALMA_COACH_MODE;
    else process.env.SALMA_COACH_MODE = previousMode;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    await deleteUser(account.id); await auth.deleteAccount(account);
  }
});

test('the client ends a targeted session only from authoritative server completion', async () => {
  const source = await readFile(new URL('../client/src/SpokenReview.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(progress\?\.targeted && progress\.completed\) setPhase\('done'\)/u);
  assert.match(source, /if \(progress\) setPrescription\(progress\)/u);
  assert.match(source, /prescription\?\.targeted && prescription\?\.completed/u);
  assert.match(source, /role="status" aria-live="polite"/u);
  assert.match(source, /drill: 'sag-es-richtig'/u);
});
