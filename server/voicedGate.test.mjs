/**
 * voicedGate.test.mjs — pins F-2 (owner order 2026-07-20): a live turn's MEASUREMENT trust must
 * come from RMS-voiced audio, not byte-duration. Contract under test:
 *   - gate OFF (default) → exact legacy behavior, byte for byte;
 *   - gate ON → silence/noise byte-duration no longer buys trustedAudio; real voiced audio does;
 *   - the voiced counter itself measures energy, not length (silence → 0, tone → ≈ length);
 *   - the flag changes evidence trust ONLY — turn flow is untouched by design (no assertions on
 *     commit timing exist because no commit-timing code was touched).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { voicedMsInPcm16 } from './audioGuard.js';
import { serverStreamEvidence, isTrustedSpokenEvidence, SPOKEN_EVIDENCE_V2 } from './spokenEvidence.js';

function pcmSilence(ms, rate) {
  return Buffer.alloc(Math.round((ms / 1000) * rate) * 2);
}
function pcmTone(ms, rate, amplitude = 8000) {
  const n = Math.round((ms / 1000) * rate);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  return buf;
}

test('voicedMsInPcm16: silence is 0, a real tone is ≈ its length, at BOTH stream rates', () => {
  for (const rate of [16000, 24000]) {
    assert.equal(voicedMsInPcm16(pcmSilence(1000, rate), rate), 0, `silence@${rate} must count 0`);
    const toneMs = voicedMsInPcm16(pcmTone(1000, rate), rate);
    assert.ok(toneMs >= 900 && toneMs <= 1000, `tone@${rate} ≈ 1000ms, got ${toneMs}`);
  }
  assert.equal(voicedMsInPcm16(Buffer.alloc(0), 16000), 0);
  assert.equal(voicedMsInPcm16(null, 16000), 0);
});

test('gate OFF (default): byte-duration alone still buys trust — the exact legacy behavior, pinned', () => {
  const ev = serverStreamEvidence({ source: 'deepgram_stream', serverAudioMs: 1000, scoringDurationMs: 900 });
  assert.equal(ev.trustedAudio, true);
  assert.equal(ev.voicedMs, null, 'unmeasured is an honest null, never a fabricated 0');
  assert.equal(isTrustedSpokenEvidence(ev), true);
});

test('gate ON: a silent/noisy turn (bytes without voice) is NO LONGER trusted evidence — F-2 closed', () => {
  const ev = serverStreamEvidence({ source: 'deepgram_stream', serverAudioMs: 5000, voicedMs: 0, enforceVoiced: true });
  assert.equal(ev.trustedAudio, false);
  assert.equal(isTrustedSpokenEvidence(ev), false);
});

test('gate ON: real voiced audio above the floor is trusted, on both stream sources', () => {
  for (const source of ['deepgram_stream', 'gemini_live_stt']) {
    const ev = serverStreamEvidence({ source, serverAudioMs: 2000, voicedMs: 1200, enforceVoiced: true });
    assert.equal(ev.trustedAudio, true, source);
    assert.equal(ev.voicedMs, 1200);
    assert.equal(isTrustedSpokenEvidence(ev), true, source);
  }
});

test('gate ON: the voiced floor is the documented constant, and just-below fails while at-floor passes', () => {
  const floor = SPOKEN_EVIDENCE_V2.minTrustedVoicedMs;
  assert.equal(floor, 400);
  const below = serverStreamEvidence({ source: 'deepgram_stream', serverAudioMs: 2000, voicedMs: floor - 1, enforceVoiced: true });
  const at = serverStreamEvidence({ source: 'deepgram_stream', serverAudioMs: 2000, voicedMs: floor, enforceVoiced: true });
  assert.equal(below.trustedAudio, false);
  assert.equal(at.trustedAudio, true);
});

test('gate ON: voiced energy can never RESCUE a turn below the byte floor (both floors must hold)', () => {
  const ev = serverStreamEvidence({ source: 'deepgram_stream', serverAudioMs: 300, voicedMs: 300, enforceVoiced: true });
  assert.equal(ev.trustedAudio, false, 'short bursts stay untrusted regardless of voicing');
});
