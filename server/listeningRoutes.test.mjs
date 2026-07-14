import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.AUTH_SECRET ||= 'listening-route-test-secret';
const auth = await import('./auth.js');
const { listeningRouter } = await import('./listening.js');
const { deleteUser, loadUser, saveUser } = await import('./store.js');

async function withApi(run) {
  const app = express();
  app.use('/api', listeningRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function api(base, path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('listening routes require completed audio and make a double grade single-use', async () => {
  const account = await auth.createAccount(
    `listening-route-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
    'test-password-1234',
  );
  account.emailVerifiedAt = Date.now();
  account.subscription = { ...(account.subscription || {}), plan: 'basic' };
  const token = auth.signToken(account);
  const itemId = 'verified-detail';
  const attemptId = 'abcdefabcdefabcdefabcdef';
  try {
    const profile = await loadUser(account.id);
    profile.listeningActive = {
      [itemId]: {
        attemptId, issuedAt: Date.now(), maxPlays: 2, playCount: 0,
        playStartedAt: null, playCompletedAt: null, playbackRate: 1.1, gradeResult: null,
        type: 'nummer', answer: '4317',
      },
    };
    await saveUser(profile);

    await withApi(async (base) => {
      const started = await api(base, '/api/listening/play', token, { id: itemId });
      assert.equal(started.status, 200);
      assert.equal(started.body.playNumber, 1);

      const premature = await api(base, '/api/listening/grade', token, { id: itemId, response: '4317' });
      assert.equal(premature.status, 409);
      assert.equal(premature.body.error, 'listening_playback_required');

      const completed = await api(base, '/api/listening/play/complete', token, {
        id: itemId, playNumber: 1, completed: true,
      });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.completed, true);

      const [first, duplicate] = await Promise.all([
        api(base, '/api/listening/grade', token, { id: itemId, response: '4317' }),
        api(base, '/api/listening/grade', token, { id: itemId, response: 'wrong-private-answer' }),
      ]);
      assert.deepEqual([first.status, duplicate.status], [200, 200]);
      assert.equal([first.body, duplicate.body].filter((body) => body.replayed === false).length, 1);
      assert.equal([first.body, duplicate.body].filter((body) => body.replayed === true).length, 1);

      const stored = await loadUser(account.id);
      assert.equal(stored.listeningAttempts.length, 1);
      assert.equal(stored.listeningAttempts[0].attemptId, attemptId);
      assert.equal(stored.listeningStats.nummer.seen, 1);
      assert.equal(JSON.stringify(stored).includes('wrong-private-answer'), false);
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});
