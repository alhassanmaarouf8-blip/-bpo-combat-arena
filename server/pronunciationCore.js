import crypto from 'node:crypto';
import { PRONUNCIATION_PROTOCOL_VERSION, pronunciationDeviation, releasedPronunciationDeviation } from './pronunciationRegistry.js';

export const PRONUNCIATION_RESULT_VERSION = 1;
const MODES = new Set(['off', 'beta', 'on']);
const SURFACES = new Set(['shadowing', 'sag-es-richtig', 'flow', 'interview']);
const IMPACTS = new Set(['harmless', 'noticeable', 'clarity_risk', 'intelligibility_risk']);
const CONFIDENCE = new Set(['low', 'growing', 'high', 'very_high']);
const HASH = /^[a-f0-9]{64}$/u;

export function pronunciationFlags(env = process.env, accountId = '') {
  const mode = String(env.PRONUNCIATION_MODE || 'off').trim().toLowerCase();
  if (!MODES.has(mode)) return Object.freeze({ mode: 'off', enabled: false, prompted: false, spontaneous: false });
  const beta = new Set(String(env.PRONUNCIATION_BETA_ACCOUNT_IDS || '').split(',').map((v) => v.trim()).filter(Boolean));
  const enabled = mode === 'on' || (mode === 'beta' && beta.has(accountId));
  return Object.freeze({ mode, enabled,
    prompted: enabled && String(env.PRONUNCIATION_PROMPTED_ENABLED || '').toLowerCase() === 'true',
    spontaneous: enabled && String(env.PRONUNCIATION_SPONTANEOUS_ENABLED || '').toLowerCase() === 'true',
    modelVersion: String(env.PRONUNCIATION_MODEL_VERSION || '').trim().slice(0, 80),
    protocolVersion: String(env.PRONUNCIATION_PROTOCOL_VERSION || '').trim().slice(0, 80),
  });
}

function wavSamples(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 46 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  const channels = buffer.readUInt16LE(22); const rate = buffer.readUInt32LE(24); const bits = buffer.readUInt16LE(34);
  if (channels !== 1 || bits !== 16 || rate < 8_000 || rate > 48_000) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4); const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data' && offset + 8 + size <= buffer.length) {
      return { rate, offset: offset + 8, samples: Math.floor(size / 2) };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Recording quality is independent from language performance. It may only veto a diagnosis. */
export function measureRecordingQuality(buffer) {
  const wav = wavSamples(buffer);
  if (!wav || wav.samples < wav.rate / 5) return Object.freeze({ status: 'failed', reason: 'unsupported_or_short_audio' });
  let sum = 0, peak = 0, clipped = 0, nonZero = 0;
  for (let i = 0; i < wav.samples; i++) {
    const sample = buffer.readInt16LE(wav.offset + i * 2); const abs = Math.abs(sample);
    sum += sample * sample; peak = Math.max(peak, abs);
    if (abs >= 32_440) clipped += 1;
    if (abs >= 160) nonZero += 1;
  }
  const rms = Math.sqrt(sum / wav.samples) / 32768;
  const peakRatio = peak / 32768; const clippedShare = clipped / wav.samples; const activeShare = nonZero / wav.samples;
  let reason = null;
  if (activeShare < 0.02 || rms < 0.004) reason = 'silence_or_too_quiet';
  else if (clippedShare > 0.005 || peakRatio > 0.999) reason = 'clipped';
  const status = reason ? 'failed' : (rms < 0.012 || peakRatio > 0.97 ? 'marginal' : 'usable');
  return Object.freeze({ status, ...(reason ? { reason } : {}), sampleRate: wav.rate,
    durationMs: Math.round(wav.samples / wav.rate * 1000), rms: Math.round(rms * 10_000) / 10_000,
    peak: Math.round(peakRatio * 10_000) / 10_000, clippedShare: Math.round(clippedShare * 100_000) / 100_000,
    noiseStatus: 'unmeasured', echoStatus: 'unmeasured' });
}

/** Raw prosody observations only. Thresholded learner claims require a released category. */
export function measureProfessionalClarity({ words, durationMs } = {}) {
  const rows = Array.isArray(words) ? words.filter((row) => row && typeof row.word === 'string'
    && Number.isFinite(row.start) && Number.isFinite(row.end) && row.start >= 0 && row.end >= row.start) : [];
  const duration = Number(durationMs);
  if (rows.length < 3 || !Number.isFinite(duration) || duration < 1_000) {
    return Object.freeze({ status: 'abstained', reason: 'too_little_timed_speech' });
  }
  const ordered = [...rows].sort((a, b) => a.start - b.start);
  let pauseCount = 0, longestPauseMs = 0;
  for (let i = 1; i < ordered.length; i++) {
    const pause = Math.max(0, (ordered[i].start - ordered[i - 1].end) * 1000);
    if (pause >= 500) pauseCount += 1;
    longestPauseMs = Math.max(longestPauseMs, pause);
  }
  const speechSpanSeconds = Math.max(duration / 1000, ordered.at(-1).end - ordered[0].start);
  return Object.freeze({ status: 'measured', wordCount: ordered.length,
    wordsPerMinute: Math.round(ordered.length / speechSpanSeconds * 600), pauseCount,
    longestPauseMs: Math.round(longestPauseMs), claimStatus: 'raw_measurement_only' });
}

function abstained(reason, recordingQuality, extra = {}) {
  return Object.freeze({ version: PRONUNCIATION_RESULT_VERSION, status: 'abstained', abstentionReason: reason,
    recordingQuality, wordObservations: Object.freeze([]), recurringPatternIds: Object.freeze([]),
    professionalClarityObservations: Object.freeze([]), ...extra });
}

function boundedObservation(value, releases) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const category = releasedPronunciationDeviation(value.categoryId, releases);
  if (!category || !IMPACTS.has(value.impact) || !CONFIDENCE.has(value.confidence)) return null;
  if (!category.acceptedImpact.includes(value.impact)) return null;
  const word = String(value.word || '').normalize('NFC').trim();
  if (!word || word.length > 80 || /[\r\n<>]/u.test(word)) return null;
  const expectedClass = String(value.expectedClass || '').trim(); const observedClass = String(value.observedClass || '').trim();
  if (!expectedClass || !observedClass || expectedClass.length > 40 || observedClass.length > 40) return null;
  return Object.freeze({ categoryId: value.categoryId, word, expectedClass, observedClass,
    impact: value.impact, confidence: value.confidence, detectorId: String(value.detectorId || '').slice(0, 80) });
}

/**
 * Detector boundary. The detector is injected and must already have a passed category release.
 * No detector, invalid output, poor audio, or version mismatch => abstention.
 */
export async function analyzePronunciationAttempt({ accountId, attemptId, targetId, targetText, surface, audio,
  detector = null, releases = {}, env = process.env }) {
  const flags = pronunciationFlags(env, accountId);
  const quality = measureRecordingQuality(audio);
  if (!flags.enabled) return abstained('feature_disabled', quality);
  if (!SURFACES.has(surface)) return abstained('unsupported_surface', quality);
  const prompted = surface === 'shadowing' || surface === 'sag-es-richtig';
  if ((prompted && !flags.prompted) || (!prompted && !flags.spontaneous)) return abstained('surface_disabled', quality);
  if (flags.protocolVersion !== PRONUNCIATION_PROTOCOL_VERSION || !flags.modelVersion) return abstained('version_unavailable', quality);
  if (quality.status !== 'usable') return abstained(`recording_${quality.status}`, quality);
  if (!/^[a-zA-Z0-9_-]{8,100}$/u.test(String(attemptId || '')) || !/^[a-zA-Z0-9:_-]{1,120}$/u.test(String(targetId || ''))
    || typeof targetText !== 'string' || targetText.length < 2 || targetText.length > 500) return abstained('invalid_target_binding', quality);
  if (typeof detector !== 'function') return abstained('detector_unvalidated', quality);
  let detected;
  try { detected = await detector({ audio, targetText, surface, modelVersion: flags.modelVersion }); }
  catch { return abstained('detector_failed', quality); }
  if (!detected || detected.protocolVersion !== flags.protocolVersion || detected.modelVersion !== flags.modelVersion
    || !Array.isArray(detected.wordObservations)) return abstained('detector_output_invalid', quality);
  const observations = detected.wordObservations.map((v) => boundedObservation(v, releases));
  if (observations.some((v) => !v)) return abstained('detector_output_invalid', quality);
  if (!observations.length) return abstained('no_released_deviation_measured', quality);
  const patternIds = [...new Set(observations.map((v) => v.categoryId))].sort();
  const audioHash = crypto.createHash('sha256').update(audio).digest('hex');
  const evidenceReceipt = crypto.createHash('sha256').update(JSON.stringify({ accountId, attemptId, targetId,
    audioHash, modelVersion: flags.modelVersion, protocolVersion: flags.protocolVersion, patternIds })).digest('hex');
  return Object.freeze({ version: PRONUNCIATION_RESULT_VERSION, status: 'measured', recordingQuality: quality,
    wordObservations: Object.freeze(observations), recurringPatternIds: Object.freeze(patternIds),
    professionalClarityObservations: Object.freeze([]), evidenceReceipt });
}

export function actionablePronunciationPatterns(observations) {
  const byCategory = new Map();
  for (const row of Array.isArray(observations) ? observations : []) {
    if (!row || !pronunciationDeviation(row.categoryId) || !HASH.test(row.evidenceReceipt || '')) continue;
    const key = row.categoryId; const state = byCategory.get(key) || { words: new Set(), veryHighImpact: false, evidence: new Set() };
    if (typeof row.word === 'string') state.words.add(row.word.toLowerCase());
    if (row.confidence === 'very_high' && row.impact === 'intelligibility_risk') state.veryHighImpact = true;
    state.evidence.add(row.evidenceReceipt); byCategory.set(key, state);
  }
  return Object.freeze([...byCategory.entries()].filter(([, state]) => state.veryHighImpact
    || (state.words.size >= 2 && state.evidence.size >= 2)).map(([categoryId]) => categoryId).sort());
}

export function wilsonLower(successes, total, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) return null;
  const p = successes / total; const z2 = z * z; const denominator = 1 + z2 / total;
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
}

export function evaluatePronunciationRelease(metrics) {
  const required = ['expertKappa', 'correctionTruePositive', 'correctionTotal', 'abstentionCorrect', 'abstentionTotal',
    'highImpactDetected', 'highImpactTotal', 'harmfulAcceptedVariantCorrections'];
  if (!metrics || required.some((key) => !Number.isFinite(metrics[key]))) return Object.freeze({ passed: false, reason: 'missing_denominator' });
  const precision = metrics.correctionTotal > 0 ? metrics.correctionTruePositive / metrics.correctionTotal : null;
  const abstention = metrics.abstentionTotal > 0 ? metrics.abstentionCorrect / metrics.abstentionTotal : null;
  const recall = metrics.highImpactTotal > 0 ? metrics.highImpactDetected / metrics.highImpactTotal : null;
  const lower = wilsonLower(metrics.correctionTruePositive, metrics.correctionTotal);
  if ([precision, abstention, recall, lower].some((v) => v === null)) return Object.freeze({ passed: false, reason: 'missing_denominator' });
  const passed = metrics.expertKappa >= 0.70 && precision >= 0.95 && lower >= 0.90 && abstention >= 0.95
    && recall >= 0.85 && metrics.harmfulAcceptedVariantCorrections === 0;
  return Object.freeze({ passed, expertKappa: metrics.expertKappa, precision, precisionWilsonLower: lower,
    correctAbstention: abstention, highImpactRecall: recall,
    harmfulAcceptedVariantCorrections: metrics.harmfulAcceptedVariantCorrections });
}
