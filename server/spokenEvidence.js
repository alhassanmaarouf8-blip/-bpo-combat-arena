import { createHash, randomBytes } from 'crypto';

const RECEIPT_TTL_MS = 2 * 60 * 1000;
const RECEIPT_LIMIT_PER_ACCOUNT = 8;
const MIN_TRUSTED_AUDIO_MS = 600;
// F-2: when the voiced gate is enforced, trust additionally requires this much RMS-voiced audio
// in the turn — byte-duration alone can be silence/noise (the exact hole F-2 names).
const MIN_TRUSTED_VOICED_MS = 400;
const TRUSTED_SOURCES = new Set(['classic_server_stt', 'deepgram_stream', 'gemini_live_stt']);
const pendingReceipts = new Map();

function boundedId(value, max = 100) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function transcriptHash(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? createHash('sha256').update(text).digest('hex') : null;
}

function boundedMs(value) {
  return Number.isFinite(Number(value))
    ? Math.max(0, Math.min(120_000, Math.round(Number(value)))) : 0;
}

function prune(accountId, now) {
  const rows = pendingReceipts.get(accountId) || [];
  const fresh = rows.filter((row) => row.expiresAt > now).slice(-RECEIPT_LIMIT_PER_ACCOUNT);
  if (fresh.length) pendingReceipts.set(accountId, fresh);
  else pendingReceipts.delete(accountId);
  return fresh;
}

function publicEvidence(row) {
  return Object.freeze({
    version: 2,
    source: row.source,
    trustedAudio: row.trustedAudio === true,
    receiptId: row.receiptId,
    serverAudioMs: boundedMs(row.serverAudioMs),
    scoringDurationMs: boundedMs(row.scoringDurationMs),
    // null = voiced energy was not measured for this row (classic receipts, gate off) — an honest
    // unknown, never a fabricated 0.
    voicedMs: row.voicedMs == null ? null : boundedMs(row.voicedMs),
  });
}

/**
 * Register one HTTP STT result without returning a new field to the browser. The existing WebSocket
 * answer format remains unchanged: the next exact transcript for the same account + live session
 * consumes this short-lived receipt. Only hashes and bounded timing metadata are retained.
 */
export function issueClassicSpeechReceipt({
  accountId, sessionId, transcript, serverAudioMs, now = Date.now(),
} = {}) {
  const account = boundedId(accountId, 64);
  const session = boundedId(sessionId, 100);
  const hash = transcriptHash(transcript);
  const audioMs = boundedMs(serverAudioMs);
  if (!account || !session || !hash || audioMs < MIN_TRUSTED_AUDIO_MS) return null;
  const row = {
    receiptId: randomBytes(12).toString('hex'),
    accountId: account,
    sessionId: session,
    transcriptHash: hash,
    source: 'classic_server_stt',
    trustedAudio: true,
    serverAudioMs: audioMs,
    scoringDurationMs: audioMs,
    issuedAt: now,
    expiresAt: now + RECEIPT_TTL_MS,
  };
  const rows = prune(account, now);
  rows.push(row);
  pendingReceipts.set(account, rows.slice(-RECEIPT_LIMIT_PER_ACCOUNT));
  return row.receiptId;
}

export function consumeClassicSpeechReceipt({ accountId, sessionId, transcript, now = Date.now() } = {}) {
  const account = boundedId(accountId, 64);
  const session = boundedId(sessionId, 100);
  const hash = transcriptHash(transcript);
  if (!account || !session || !hash) return null;
  const rows = prune(account, now);
  const index = rows.findIndex((row) => row.sessionId === session && row.transcriptHash === hash);
  if (index < 0) return null;
  const [row] = rows.splice(index, 1);
  if (rows.length) pendingReceipts.set(account, rows);
  else pendingReceipts.delete(account);
  return publicEvidence(row);
}

export function serverStreamEvidence({ source, serverAudioMs, scoringDurationMs = 0, voicedMs = null, enforceVoiced = false } = {}) {
  if (!TRUSTED_SOURCES.has(source) || source === 'classic_server_stt') return typedAnswerEvidence();
  const audioMs = boundedMs(serverAudioMs);
  // F-2: with the voiced gate enforced, byte-duration alone no longer buys trust — the turn must
  // also contain real RMS-voiced audio. Gate off (default) → exact legacy behavior.
  const voicedOk = !enforceVoiced || (voicedMs != null && boundedMs(voicedMs) >= MIN_TRUSTED_VOICED_MS);
  return publicEvidence({
    version: 2,
    source,
    trustedAudio: audioMs >= MIN_TRUSTED_AUDIO_MS && voicedOk,
    receiptId: randomBytes(12).toString('hex'),
    serverAudioMs: audioMs,
    scoringDurationMs: boundedMs(scoringDurationMs),
    voicedMs,
  });
}

export function typedAnswerEvidence() {
  return Object.freeze({
    version: 2,
    source: 'typed',
    trustedAudio: false,
    receiptId: null,
    serverAudioMs: 0,
    scoringDurationMs: 0,
  });
}

/** Resolve a browser `answer` without trusting any browser timing or provenance field. */
export function resolveClientAnswerEvidence({ accountId, sessionId, transcript, now = Date.now() } = {}) {
  return consumeClassicSpeechReceipt({ accountId, sessionId, transcript, now }) || typedAnswerEvidence();
}

export function isTrustedSpokenEvidence(value) {
  return !!value && value.version === 2 && TRUSTED_SOURCES.has(value.source)
    && value.trustedAudio === true && /^[a-f0-9]{24}$/u.test(value.receiptId || '')
    && boundedMs(value.serverAudioMs) >= MIN_TRUSTED_AUDIO_MS;
}

export function clearSpeechReceipts({ accountId, sessionId } = {}) {
  const account = boundedId(accountId, 64);
  const session = boundedId(sessionId, 100);
  if (!account) return;
  if (!session) { pendingReceipts.delete(account); return; }
  const rows = (pendingReceipts.get(account) || []).filter((row) => row.sessionId !== session);
  if (rows.length) pendingReceipts.set(account, rows);
  else pendingReceipts.delete(account);
}

export const SPOKEN_EVIDENCE_V2 = Object.freeze({
  minTrustedAudioMs: MIN_TRUSTED_AUDIO_MS,
  minTrustedVoicedMs: MIN_TRUSTED_VOICED_MS,
  receiptTtlMs: RECEIPT_TTL_MS,
  trustedSources: Object.freeze([...TRUSTED_SOURCES]),
});

