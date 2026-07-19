import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSpeechReceipts,
  consumeClassicSpeechReceipt,
  isTrustedSpokenEvidence,
  issueClassicSpeechReceipt,
  resolveClientAnswerEvidence,
  serverStreamEvidence,
  SPOKEN_EVIDENCE_V2,
  typedAnswerEvidence,
} from './spokenEvidence.js';

test.afterEach(() => clearSpeechReceipts({ accountId: 'acct_one' }));

test('classic STT receipt binds exact account, session, transcript, and server audio duration', () => {
  const receiptId = issueClassicSpeechReceipt({
    accountId: 'acct_one',
    sessionId: 'fight_one',
    transcript: 'Ich habe drei Jahre Erfahrung.',
    serverAudioMs: 1_847,
    now: 1_000,
  });
  assert.match(receiptId, /^[a-f0-9]{24}$/u);

  assert.equal(consumeClassicSpeechReceipt({
    accountId: 'acct_other', sessionId: 'fight_one',
    transcript: 'Ich habe drei Jahre Erfahrung.', now: 1_001,
  }), null);
  assert.equal(consumeClassicSpeechReceipt({
    accountId: 'acct_one', sessionId: 'fight_other',
    transcript: 'Ich habe drei Jahre Erfahrung.', now: 1_001,
  }), null);
  assert.equal(consumeClassicSpeechReceipt({
    accountId: 'acct_one', sessionId: 'fight_one',
    transcript: 'Ich habe vier Jahre Erfahrung.', now: 1_001,
  }), null);

  const evidence = consumeClassicSpeechReceipt({
    accountId: 'acct_one', sessionId: 'fight_one',
    transcript: 'Ich habe drei Jahre Erfahrung.', now: 1_001,
  });
  assert.equal(isTrustedSpokenEvidence(evidence), true);
  assert.deepEqual(evidence, {
    version: 2,
    source: 'classic_server_stt',
    trustedAudio: true,
    receiptId,
    serverAudioMs: 1_847,
    scoringDurationMs: 1_847,
    // F-2: classic receipts don't measure voiced energy — an honest null, never a fabricated 0.
    voicedMs: null,
  });
  assert.equal(consumeClassicSpeechReceipt({
    accountId: 'acct_one', sessionId: 'fight_one',
    transcript: 'Ich habe drei Jahre Erfahrung.', now: 1_002,
  }), null, 'one spoken clip cannot authorize multiple answers');
});

test('forged browser provenance and duration are ignored when no server receipt exists', () => {
  const evidence = resolveClientAnswerEvidence({
    accountId: 'acct_one',
    sessionId: 'fight_one',
    transcript: 'Eine nur getippte Antwort.',
    durationMs: 120_000,
    serverAudioMs: 120_000,
    source: 'deepgram_stream',
    trustedAudio: true,
    receiptId: 'a'.repeat(24),
  });
  assert.deepEqual(evidence, typedAnswerEvidence());
  assert.equal(isTrustedSpokenEvidence(evidence), false);
});

test('expired, absent, and sub-600ms classic audio never authorize spoken evidence', () => {
  assert.equal(issueClassicSpeechReceipt({
    accountId: 'acct_one', sessionId: 'fight_one', transcript: 'Zu kurz.', serverAudioMs: 599,
  }), null);
  assert.deepEqual(resolveClientAnswerEvidence({
    accountId: 'acct_one', sessionId: 'fight_one', transcript: 'Zu kurz.',
  }), typedAnswerEvidence());

  issueClassicSpeechReceipt({
    accountId: 'acct_one', sessionId: 'fight_one', transcript: 'Rechtzeitig gesprochen.',
    serverAudioMs: 1_000, now: 10_000,
  });
  assert.equal(consumeClassicSpeechReceipt({
    accountId: 'acct_one', sessionId: 'fight_one', transcript: 'Rechtzeitig gesprochen.',
    now: 10_000 + SPOKEN_EVIDENCE_V2.receiptTtlMs,
  }), null);
});

test('only server stream sources with enough observed audio create trusted v2 evidence', () => {
  const low = serverStreamEvidence({
    source: 'deepgram_stream', serverAudioMs: 599, scoringDurationMs: 50_000,
  });
  assert.equal(isTrustedSpokenEvidence(low), false);
  assert.equal(low.trustedAudio, false);

  const deepgram = serverStreamEvidence({
    source: 'deepgram_stream', serverAudioMs: 600, scoringDurationMs: 500,
  });
  const gemini = serverStreamEvidence({ source: 'gemini_live_stt', serverAudioMs: 900 });
  assert.equal(isTrustedSpokenEvidence(deepgram), true);
  assert.equal(isTrustedSpokenEvidence(gemini), true);
  assert.deepEqual(serverStreamEvidence({
    source: 'classic_server_stt', serverAudioMs: 4_000,
  }), typedAnswerEvidence(), 'classic evidence must use the exact HTTP STT receipt path');
  assert.deepEqual(serverStreamEvidence({ source: 'browser_claim', serverAudioMs: 4_000 }), typedAnswerEvidence());
});

test('legacy v1 evidence is excluded even when its fields look otherwise valid', () => {
  assert.equal(isTrustedSpokenEvidence({
    version: 1,
    source: 'deepgram_stream',
    trustedAudio: true,
    receiptId: 'a'.repeat(24),
    serverAudioMs: 2_000,
    scoringDurationMs: 2_000,
  }), false);
});
