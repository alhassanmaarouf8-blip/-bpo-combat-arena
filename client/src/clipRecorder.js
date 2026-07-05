/**
 * clipRecorder.js — record a short spoken clip and return it as a WAV blob.
 *
 * REUSES the app's existing AudioRecorder (same getUserMedia + AudioWorklet mic capture)
 * to collect PCM16 chunks, then assembles a 24 kHz mono WAV file for transcription.
 * It does NOT open a Realtime session — the bytes stay local until the user submits.
 */
import { AudioRecorder } from './audioRecorder.js';

const SAMPLE_RATE = 24_000;

export class ClipRecorder {
  constructor({ onVolume, onChunk, sharedContext = null } = {}) {
    this._chunks = [];
    this._rec = new AudioRecorder({
      onChunk:  (b64) => {
        this._chunks.push(b64ToInt16(b64));
        onChunk?.(b64);   // forward raw b64 PCM for streaming path
      },
      onVolume: onVolume || (() => {}),
      onError:  () => {},
      sharedContext,   // a gesture-unlocked 24kHz context reused across turns → mobile auto-listen
    });
    this._startedAt = 0;
  }
  get isRecording() { return this._rec.isRecording; }
  async start() {
    this._chunks = [];
    this._startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    await this._rec.start();
  }
  async stop() {
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this._startedAt;
    await this._rec.stop();
    return { blob: pcm16ToWav(this._chunks, SAMPLE_RATE), durationMs: Math.round(ms) };
  }
}

function b64ToInt16(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer, 0, Math.floor(u8.length / 2));
}

function pcm16ToWav(chunks, rate) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const pcm = new Int16Array(total);
  let off = 0;
  for (const c of chunks) { pcm.set(c, off); off += c.length; }

  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');  v.setUint32(4, 36 + dataBytes, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  writeStr(36, 'data'); v.setUint32(40, dataBytes, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}
