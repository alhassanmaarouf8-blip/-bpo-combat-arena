/**
 * streamingTranscribe.js — Deepgram LiveTranscription via streaming WebSocket.
 *
 * Compared to transcribeDeepgram.js (prerecorded), this achieves near-zero
 * post-speech latency: by the time the user stops talking, Deepgram has already
 * processed all but the final 50-100ms of audio and returns speech_final almost
 * immediately. Same DEEPGRAM_API_KEY, same per-minute billing — zero extra cost.
 *
 * Usage:
 *   const s = new DeepgramStreamer({ onPartial, onFinal, onError });
 *   s.start();
 *   s.sendChunk(pcm16Buffer);   // call as audio chunks arrive
 *   s.close();                  // after silence / turn ends
 */
import { WebSocket } from 'ws';

const DG_STREAM_URL = 'wss://api.deepgram.com/v1/listen';

export class DeepgramStreamer {
  constructor({ onPartial = () => {}, onFinal = () => {}, onError = () => {} } = {}) {
    this._onPartial = onPartial;
    this._onFinal   = onFinal;
    this._onError   = onError;
    this._ws        = null;
    this._pending   = [];   // chunks buffered before WS opens
    this._done      = false;
  }

  start() {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) { this._onError(new Error('DEEPGRAM_API_KEY not set')); return; }

    const params = new URLSearchParams({
      model:           process.env.DEEPGRAM_MODEL || 'nova-2',
      language:        'de',
      smart_format:    'true',
      punctuate:       'true',
      interim_results: 'true',
      endpointing:     '700',   // server-side end-of-speech at 700ms — matches our VAD target
      encoding:        'linear16',
      sample_rate:     '24000',
      channels:        '1',
    });

    this._ws = new WebSocket(`${DG_STREAM_URL}?${params}`, {
      headers: { Authorization: `Token ${key}` },
    });

    this._ws.on('open', () => {
      for (const c of this._pending) this._ws.send(c, { binary: true });
      this._pending = [];
    });

    this._ws.on('message', (raw) => {
      try {
        const msg   = JSON.parse(raw);
        const alt   = msg?.channel?.alternatives?.[0] ?? {};
        const text  = alt.transcript ?? '';
        const words = alt.words ?? [];   // [{word, confidence, start, end, punctuated_word}]
        if (msg.speech_final || msg.is_final) {
          // Always fire onFinal on speech_final — even with empty text (silence endpoint).
          // Caller (websocketManager) nulls ctx.dgStreamer on every onFinal, so the next
          // turn gets a fresh streamer instead of the now-stale one.
          this._onFinal(text, words);
        } else {
          if (!text.trim()) return;
          this._onPartial(text);
        }
      } catch {}
    });

    this._ws.on('error', (err) => { if (!this._done) this._onError(err); });
    this._ws.on('close', () => {
      // Deepgram closed the connection without a speech_final (keepalive timeout, network drop).
      // Fire an empty final so websocketManager nulls ctx.dgStreamer — prevents future audio
      // chunks from going to a dead streamer that silently drops everything.
      if (!this._done) this._onFinal('', []);
      this._done = true;
    });
  }

  sendChunk(buf) {
    if (this._done) return;
    if (this._ws?.readyState === 1 /* OPEN */) {
      this._ws.send(buf, { binary: true });
    } else {
      this._pending.push(buf);
    }
  }

  close() {
    this._done = true;
    if (this._ws && this._ws.readyState <= 1) {
      try { this._ws.send(JSON.stringify({ type: 'CloseStream' })); } catch {}
      setTimeout(() => { try { this._ws.terminate(); } catch {} }, 300);
    }
    this._pending = [];
  }
}
