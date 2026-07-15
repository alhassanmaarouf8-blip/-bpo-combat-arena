import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.AUTH_SECRET ||= 'listening-route-test-secret';
const auth = await import('./auth.js');
const { listeningRouter } = await import('./listening.js');
const { transcribeRouter } = await import('./transcribeRouter.js');
const { listeningBaselineSnapshot, listeningMasteryEvidence } = await import('./listeningEvidence.js');
const { deleteUser, loadUser, saveUser } = await import('./store.js');

async function withApi(run) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', listeningRouter);
  app.use('/api', transcribeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('listening GET exposes no transcript and opaque media tickets resolve only an active play', async () => {
  const account = await auth.createAccount(
    `listening-opaque-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
    'test-password-1234',
  );
  account.emailVerifiedAt = Date.now();
  account.subscription = { ...(account.subscription || {}), plan: 'basic' };
  const token = auth.signToken(account);
  try {
    await withApi(async (base) => {
      const response = await fetch(`${base}/api/listening`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Listening-Media-Version': '2' },
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.items.length, 5);
      assert.equal(payload.mediaMode, 'opaque_v2');
      assert.equal(payload.items.some((item) => Object.hasOwn(item, 'audioText') || Object.hasOwn(item, 'voice')), false);
      const stored = await loadUser(account.id);
      const first = payload.items[0];
      assert.ok(stored.listeningActive[String(first.id)].ttsText.length > 12);
      assert.match(stored.listeningActive[String(first.id)].accountBinding, /^[a-f0-9]{64}$/u);
      assert.equal(stored.listeningActive[String(first.id)].mediaProofRequired, true);
      const opaqueAttemptId = stored.listeningActive[String(first.id)].attemptId;

      const started = await api(base, '/api/listening/play', token, { id: first.id });
      assert.equal(started.status, 200);
      const ticket = await api(base, '/api/media-ticket', token, {
        listeningRef: { id: first.id, playNumber: started.body.playNumber },
      });
      assert.equal(ticket.status, 200);
      assert.equal(typeof ticket.body.ticket, 'string');
      const mixed = await api(base, '/api/media-ticket', token, {
        listeningRef: { id: first.id, playNumber: started.body.playNumber }, text: 'forged transcript',
      });
      assert.equal(mixed.status, 400);
      assert.equal(mixed.body.error, 'invalid_listening_media_request');

      const legacyResponse = await fetch(`${base}/api/listening`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(legacyResponse.status, 200);
      const legacyPayload = await legacyResponse.json();
      assert.equal(legacyPayload.items.length, 5);
      assert.equal(legacyPayload.items.every((item) => typeof item.audioText === 'string' && typeof item.voice === 'string'), true,
        'stale clients keep their exact existing audio payload during a rolling deployment');
      const legacyStored = await loadUser(account.id);
      assert.equal(Object.values(legacyStored.listeningActive).every((item) => item.mediaProofRequired === false), true,
        'legacy clients are never forced through an opaque-media receipt they cannot produce');
      assert.equal(Object.values(legacyStored.listeningActive).every((item) => item.evidenceVersion == null
        && item.accountBinding == null && item.phase == null), true,
      'legacy compatibility attempts remain v1 and can never become v2 baseline/retest evidence');
      assert.equal(Object.values(legacyStored.listeningActive).some((item) => item.attemptId === opaqueAttemptId), false,
        'opaque and legacy cache entries cannot cross modes');

      const legacyFirst = legacyPayload.items[0];
      const legacyStarted = await api(base, '/api/listening/play', token, { id: legacyFirst.id });
      assert.equal(legacyStarted.status, 200);
      const legacyAfterStart = await loadUser(account.id);
      const legacyActive = legacyAfterStart.listeningActive[String(legacyFirst.id)];
      legacyActive.playStartedAt = Date.now() - legacyActive.minimumPlaybackMs - 10;
      await saveUser(legacyAfterStart);
      const legacyCompleted = await api(base, '/api/listening/play/complete', token, {
        id: legacyFirst.id, playNumber: legacyStarted.body.playNumber, completed: true,
      });
      assert.equal(legacyCompleted.status, 200, 'stale clients remain able to complete direct-audio attempts');
      const correctResponse = legacyActive.kind === 'verstehen' ? String(legacyActive.correct) : legacyActive.answer;
      const legacyGrade = await api(base, '/api/listening/grade', token, { id: legacyFirst.id, response: correctResponse });
      assert.equal(legacyGrade.status, 200);
      const legacyGraded = await loadUser(account.id);
      const legacyAttempt = legacyGraded.listeningAttempts.find((row) => row.attemptId === legacyActive.attemptId);
      assert.equal(legacyAttempt.evidenceVersion, 1);
      assert.equal(legacyAttempt.accountBinding, null);
      const legacySkill = legacyActive.kind === 'verstehen' ? 'listen-clear' : 'listen-phone';
      assert.equal(listeningBaselineSnapshot(legacyGraded, legacySkill), null);
      assert.equal(listeningMasteryEvidence(legacyGraded)[legacySkill === 'listen-clear' ? 'clear' : 'phone'], null);
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});

async function api(base, path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('listening routes reject forged early completion and make a verified double grade single-use', async () => {
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
        type: 'nummer', answer: '4317', minimumPlaybackMs: 600, mediaProofRequired: true,
        ttsText: 'Die Kundennummer lautet vier drei eins sieben.', voice: 'aura-2-lara-de',
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

      const forgedEarly = await api(base, '/api/listening/play/complete', token, {
        id: itemId, playNumber: 1, completed: true, durationMs: 999_999, playedMs: 999_999,
      });
      assert.equal(forgedEarly.status, 409);
      assert.equal(forgedEarly.body.error, 'listening_playback_too_short');
      const gradeAfterForgery = await api(base, '/api/listening/grade', token, { id: itemId, response: '4317' });
      assert.equal(gradeAfterForgery.status, 409);
      assert.equal(gradeAfterForgery.body.error, 'listening_playback_required');
      assert.equal(Object.hasOwn(gradeAfterForgery.body, 'evidenceReceipt'), false);
      const afterForgery = await loadUser(account.id);
      assert.equal(afterForgery.listeningActive[itemId].playCompletedAt, null);
      assert.equal((afterForgery.listeningAttempts || []).length, 0);

      await new Promise((resolve) => setTimeout(resolve, 625));
      const elapsedWithoutMedia = await api(base, '/api/listening/play/complete', token, {
        id: itemId, playNumber: 1, completed: true,
      });
      assert.equal(elapsedWithoutMedia.status, 409);
      assert.equal(elapsedWithoutMedia.body.error, 'listening_media_required');
      const gradeWithoutMedia = await api(base, '/api/listening/grade', token, { id: itemId, response: '4317' });
      assert.equal(gradeWithoutMedia.status, 409);
      assert.equal(gradeWithoutMedia.body.error, 'listening_playback_required');

      const mediaTicket = await api(base, '/api/media-ticket', token, {
        listeningRef: { id: itemId, playNumber: 1 },
      });
      assert.equal(mediaTicket.status, 200);
      const originalFetch = globalThis.fetch;
      const priorKey = process.env.DEEPGRAM_API_KEY;
      process.env.DEEPGRAM_API_KEY = 'route-test-key';
      let releaseMedia;
      const mediaGate = new Promise((resolve) => { releaseMedia = resolve; });
      globalThis.fetch = (input, init) => String(input).startsWith('https://api.deepgram.com/v1/speak')
        ? Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.from([0x49, 0x44]));
            mediaGate.then(() => {
              controller.enqueue(Uint8Array.from([0x33, 0x04]));
              controller.close();
            });
          },
        }), {
          status: 200, headers: { 'Content-Type': 'audio/mpeg' },
        }))
        : originalFetch(input, init);
      try {
        const media = await originalFetch(`${base}/api/tts-stream?ticket=${encodeURIComponent(mediaTicket.body.ticket)}`);
        assert.equal(media.status, 200);
        const beforeCompleteDelivery = await loadUser(account.id);
        assert.equal(beforeCompleteDelivery.listeningActive[itemId].mediaDeliveredAt, null,
          'starting a valid media response is not completed-listening evidence');
        const forgedWhileStreaming = await api(base, '/api/listening/play/complete', token, {
          id: itemId, playNumber: 1, completed: true,
        });
        assert.equal(forgedWhileStreaming.status, 409);
        assert.equal(forgedWhileStreaming.body.error, 'listening_media_required');
        releaseMedia();
        assert.ok((await media.arrayBuffer()).byteLength > 0);
      } finally {
        releaseMedia?.();
        globalThis.fetch = originalFetch;
        if (priorKey === undefined) delete process.env.DEEPGRAM_API_KEY;
        else process.env.DEEPGRAM_API_KEY = priorKey;
      }
      let afterRedemption = await loadUser(account.id);
      for (let attempt = 0; attempt < 20 && !afterRedemption.listeningActive[itemId].mediaDeliveredAt; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        afterRedemption = await loadUser(account.id);
      }
      assert.equal(afterRedemption.listeningActive[itemId].mediaDeliveredPlayInstanceId,
        afterRedemption.listeningActive[itemId].playInstanceId);
      assert.ok(Number.isFinite(afterRedemption.listeningActive[itemId].mediaDeliveredAt));
      assert.equal(JSON.stringify(afterRedemption.listeningActive[itemId]).includes(mediaTicket.body.ticket), false);

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

test('an aborted listening-media response can never mint completed-playback evidence', async () => {
  const account = await auth.createAccount(
    `listening-abort-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
    'test-password-1234',
  );
  account.emailVerifiedAt = Date.now();
  account.subscription = { ...(account.subscription || {}), plan: 'basic' };
  const token = auth.signToken(account);
  const itemId = 'aborted-detail';
  try {
    const profile = await loadUser(account.id);
    profile.listeningActive = {
      [itemId]: {
        attemptId: 'feedfacefeedfacefeedface', issuedAt: Date.now(), maxPlays: 2, playCount: 0,
        playStartedAt: null, playCompletedAt: null, playbackRate: 1.1, gradeResult: null,
        type: 'nummer', answer: '8421', minimumPlaybackMs: 600, mediaProofRequired: true,
        ttsText: 'Die Kundennummer lautet acht vier zwei eins.', voice: 'aura-2-lara-de',
      },
    };
    await saveUser(profile);

    await withApi(async (base) => {
      const started = await api(base, '/api/listening/play', token, { id: itemId });
      const ticket = await api(base, '/api/media-ticket', token, {
        listeningRef: { id: itemId, playNumber: started.body.playNumber },
      });
      assert.equal(ticket.status, 200);

      const originalFetch = globalThis.fetch;
      const priorKey = process.env.DEEPGRAM_API_KEY;
      process.env.DEEPGRAM_API_KEY = 'route-test-key';
      let releaseProvider;
      const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
      globalThis.fetch = (input, init) => String(input).startsWith('https://api.deepgram.com/v1/speak')
        ? Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.from([0x49, 0x44]));
            providerGate.then(() => controller.close());
          },
        }), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
        : originalFetch(input, init);
      try {
        await new Promise((resolve, reject) => {
          const request = http.get(
            `${base}/api/tts-stream?ticket=${encodeURIComponent(ticket.body.ticket)}`,
            (response) => {
              assert.equal(response.statusCode, 200);
              response.once('data', () => {
                response.destroy();
                request.destroy();
                resolve();
              });
              response.once('error', (error) => {
                if (error.code === 'ECONNRESET' || error.code === 'ABORT_ERR') resolve();
                else reject(error);
              });
            },
          );
          request.once('error', (error) => {
            if (error.code === 'ECONNRESET' || error.code === 'ABORT_ERR') resolve();
            else reject(error);
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        releaseProvider();
        await new Promise((resolve) => setTimeout(resolve, 30));
      } finally {
        releaseProvider?.();
        globalThis.fetch = originalFetch;
        if (priorKey === undefined) delete process.env.DEEPGRAM_API_KEY;
        else process.env.DEEPGRAM_API_KEY = priorKey;
      }

      const afterAbort = await loadUser(account.id);
      assert.equal(afterAbort.listeningActive[itemId].mediaDeliveredAt, null);
      afterAbort.listeningActive[itemId].playStartedAt = Date.now()
        - afterAbort.listeningActive[itemId].minimumPlaybackMs - 10;
      await saveUser(afterAbort);
      const forgedCompletion = await api(base, '/api/listening/play/complete', token, {
        id: itemId, playNumber: 1, completed: true,
      });
      assert.equal(forgedCompletion.status, 409);
      assert.equal(forgedCompletion.body.error, 'listening_media_required');
      const grade = await api(base, '/api/listening/grade', token, { id: itemId, response: '8421' });
      assert.equal(grade.status, 409);
      assert.equal(grade.body.error, 'listening_playback_required');
    });
  } finally {
    await deleteUser(account.id);
    await auth.deleteAccount(account);
  }
});
