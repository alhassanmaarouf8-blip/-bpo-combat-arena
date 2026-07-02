/**
 * geminiAudio.test.mjs — the 24 kHz → 16 kHz resample. If this is wrong (or absent, the original
 * bug), Gemini hears the candidate ~1.5× too fast / wrong-pitch and the whole interview is garbage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downsamplePcm24to16 } from './geminiAudio.js';

// Build a PCM16 LE buffer from an array of samples.
function pcm(samples) {
  const b = Buffer.allocUnsafe(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
}
const toArray = (buf) => Array.from({ length: buf.length >> 1 }, (_, i) => buf.readInt16LE(i * 2));

test('output length is the 16/24 (=2/3) ratio of the input', () => {
  assert.equal(downsamplePcm24to16(pcm(new Array(24).fill(0))).length >> 1, 16);
  assert.equal(downsamplePcm24to16(pcm(new Array(30).fill(0))).length >> 1, 20);
  assert.equal(downsamplePcm24to16(pcm(new Array(3).fill(0))).length >> 1, 2);
});

test('a constant (DC) signal is preserved exactly', () => {
  const out = toArray(downsamplePcm24to16(pcm(new Array(24).fill(1000))));
  assert.equal(out.length, 16);
  for (const v of out) assert.equal(v, 1000);
});

test('interpolates between neighbouring samples (a ramp stays monotonic, within range)', () => {
  const ramp = Array.from({ length: 24 }, (_, i) => i * 100);   // 0,100,…,2300
  const out = toArray(downsamplePcm24to16(pcm(ramp)));
  assert.equal(out[0], 0);                     // first sample maps to source 0
  for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1], 'monotonic non-decreasing');
  for (const v of out) assert.ok(v >= 0 && v <= 2300, 'stays within the source range');
});

test('clamps to Int16 range and never NaNs', () => {
  const out = toArray(downsamplePcm24to16(pcm([32767, -32768, 32767, -32768, 32767, -32768])));
  for (const v of out) assert.ok(v >= -32768 && v <= 32767 && Number.isFinite(v));
});

test('empty / sub-sample input returns an empty buffer (no crash)', () => {
  assert.equal(downsamplePcm24to16(Buffer.alloc(0)).length, 0);
  assert.equal(downsamplePcm24to16(Buffer.alloc(1)).length, 0);
  assert.equal(downsamplePcm24to16(null).length, 0);
});
