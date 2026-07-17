import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createPronunciationRouter } from './pronunciation.js';
import { PRONUNCIATION_PROTOCOL_VERSION } from './pronunciationRegistry.js';

function wav() {
  const rate = 24000, samples = rate, out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples * 2, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(Math.sin(i / 8) * 4000), 44 + i * 2);
  return out;
}

async function withApi(router, fn) {
  const app = express();
  app.use('/api', router); const server = app.listen(0); await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

const TARGET = async (_account, surface, targetId) => surface === 'shadowing' && targetId === 'shadowing:7'
  ? { targetId, targetText: 'Wir bieten Ihnen eine passende Lösung an.' } : null;
const AUTH = (req, _res, next) => { req.account = { id: 'owner-1', plan: 'elite', verified: true }; next(); };

test('disabled endpoint is undiscoverable while capabilities remain honestly disabled', async () => {
  await withApi(createPronunciationRouter({ env: {}, targetResolver: TARGET, auth: AUTH }), async (base) => {
    const caps = await fetch(`${base}/api/pronunciation/capabilities`).then((r) => r.json());
    assert.equal(caps.feature.enabled, false); assert.deepEqual(caps.releasedCategories, []);
    const res = await fetch(`${base}/api/pronunciation/attempt?attemptId=attempt_123&surface=shadowing&targetId=shadowing:7`,
      { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav() });
    assert.equal(res.status, 404);
  });
});

test('enabled route resolves target server-side and abstains without a validated detector', async () => {
  const env = { PRONUNCIATION_MODE: 'on', PRONUNCIATION_PROMPTED_ENABLED: 'true',
    PRONUNCIATION_MODEL_VERSION: 'model-v1', PRONUNCIATION_PROTOCOL_VERSION };
  await withApi(createPronunciationRouter({ env, targetResolver: TARGET, auth: AUTH }), async (base) => {
    const bad = await fetch(`${base}/api/pronunciation/attempt?attemptId=attempt_123&surface=shadowing&targetId=shadowing:8`,
      { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav() });
    assert.equal(bad.status, 400);
    const res = await fetch(`${base}/api/pronunciation/attempt?attemptId=attempt_123&surface=shadowing&targetId=shadowing:7`,
      { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav() });
    assert.equal(res.status, 200); const body = await res.json();
    assert.equal(body.status, 'abstained'); assert.equal(body.abstentionReason, 'detector_unvalidated');
    assert.equal(JSON.stringify(body).includes('Wir bieten'), false);
  });
});

test('released-category result is possible only through injected detector and exact release version', async () => {
  const env = { PRONUNCIATION_MODE: 'on', PRONUNCIATION_PROMPTED_ENABLED: 'true',
    PRONUNCIATION_MODEL_VERSION: 'model-v1', PRONUNCIATION_PROTOCOL_VERSION };
  const detector = async () => ({ protocolVersion: PRONUNCIATION_PROTOCOL_VERSION, modelVersion: 'model-v1',
    wordObservations: [{ categoryId: 'vowel_length', word: 'bieten', expectedClass: 'iː', observedClass: 'ɪ',
      impact: 'clarity_risk', confidence: 'very_high', detectorId: 'gold-v1' }] });
  const releases = { vowel_length: { passed: true, protocolVersion: PRONUNCIATION_PROTOCOL_VERSION } };
  await withApi(createPronunciationRouter({ env, detector, releases, targetResolver: TARGET, auth: AUTH }), async (base) => {
    const caps = await fetch(`${base}/api/pronunciation/capabilities`).then((r) => r.json());
    assert.deepEqual(caps.releasedCategories, ['vowel_length']);
    const body = await fetch(`${base}/api/pronunciation/attempt?attemptId=attempt_123&surface=shadowing&targetId=shadowing:7`,
      { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav() }).then((r) => r.json());
    assert.equal(body.status, 'measured'); assert.equal(body.wordObservations[0].categoryId, 'vowel_length');
  });
});
