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
  constructor({ onPartial = () => {}, onFinal = () => {}, onError = () => {}, keyterms = [] } = {}) {
    this._onPartial = onPartial;
    this._onFinal   = onFinal;
    this._onError   = onError;
    this._keyterms  = Array.isArray(keyterms) ? keyterms.filter(Boolean) : [];   // words to bias the decoder toward (names, domain vocab)
    this._ws        = null;
    this._pending   = [];   // chunks buffered before WS opens
    this._done      = false;
    this._triedFallback = false;   // nova-3 → nova-2 handshake fallback fires at most once
  }

  start() {
    // Default to nova-3 (lower error rate on accented German + stronger keyterm boosting), but the connect
    // path below auto-falls-back to nova-2 if nova-3's stream can't open — so the model choice can NEVER
    // break a live interview. Override with DEEPGRAM_MODEL.
    this._connect(process.env.DEEPGRAM_MODEL || 'nova-3');
  }

  _connect(model) {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) { this._onError(new Error('DEEPGRAM_API_KEY not set')); return; }

    const params = new URLSearchParams({
      model,
      language:        'de',
      smart_format:    'true',
      punctuate:       'true',
      interim_results: 'true',
      endpointing:     '250',   // shorter trailing-silence window → speech_final arrives sooner (turn-commit is still the client VAD)
      encoding:        'linear16',
      sample_rate:     '24000',
      channels:        '1',
    });

    // ACCENT ACCURACY (general, not a one-word patch): bias the decoder toward the words we KNOW occur
    // this session — the interviewer's name, the candidate's name, core interview/BPO vocabulary — so
    // accented German ("Frau Yasmin", Y=/j/) stops being re-segmented into frequent words like "nicht".
    // Free + model-native. keyterm is the nova-3 param; keywords the nova-2/older one — pick by the active
    // model so the boost is never silently ignored.
    const boostParam = /nova-3/.test(model) ? 'keyterm' : 'keywords';
    for (const t of this._keyterms) {
      params.append(boostParam, boostParam === 'keywords' ? `${t}:2` : t);
    }

    let opened = false;
    const ws = new WebSocket(`${DG_STREAM_URL}?${params}`, { headers: { Authorization: `Token ${key}` } });
    this._ws = ws;

    // SAFE MODEL SWAP: if nova-3 is rejected at the handshake (never opens), transparently retry ONCE on
    // nova-2. No audio is sent before 'open', so the buffered _pending chunks replay cleanly on the
    // fallback connection and the candidate never notices. Guards every handler with `this._ws === ws` so
    // a stale (replaced) socket's late close/error can't tear down the new connection.
    const fallbackIfNeeded = () => {
      if (opened || this._done || this._triedFallback || !/nova-3/.test(model)) return false;
      this._triedFallback = true;
      console.warn('[dgStream] nova-3 stream did not open → falling back to nova-2');
      this._connect('nova-2');
      return true;
    };

    ws.on('open', () => {
      if (this._ws !== ws) return;
      opened = true;
      for (const c of this._pending) ws.send(c, { binary: true });
      this._pending = [];
    });

    ws.on('message', (raw) => {
      if (this._ws !== ws) return;
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

    ws.on('error', (err) => {
      if (this._ws !== ws) return;
      if (fallbackIfNeeded()) return;
      if (!this._done) this._onError(err);
    });
    ws.on('close', () => {
      if (this._ws !== ws) return;
      if (fallbackIfNeeded()) return;
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
