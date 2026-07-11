/**
 * geminiLiveProxy.js — manages a single Gemini Live WebSocket session per fight.
 *
 * Owns the browser↔wsManager callbacks, the Gemini Live WebSocket, and the half-duplex
 * state machine. Falls back gracefully (logs + signals the caller) if the key has no
 * bidiGenerateContent access (free tier → model not enabled).
 */

import { openGeminiLive } from './geminiLive.js';
import { vertexConfigured, getVertexAccessToken } from './vertexToken.js';

export class GeminiLiveProxy {
  constructor(opts) {
    this._h = opts.handlers;   // { onReady, onBossAudio, onBossText, onUserText, onInterrupted,
                               //   onClose, onError, onTurnComplete }
    this._session = null;
    this._ready = false;
    this._bossSpeaking = false;
  }

  get isReady()   { return this._ready; }
  get bossSpeaking() { return this._bossSpeaking; }

  async start({ apiKey, model, voiceName, systemInstruction }) {
    try {
      // Vertex first when configured (bills the $300 GCP credit, not the card); the AI Studio
      // key path stays as-is otherwise. Token minting is the only await — fails loud into
      // the same catch → onError → graceful Groq fallback.
      const accessToken = vertexConfigured() ? await getVertexAccessToken() : null;
      this._session = openGeminiLive({
        apiKey,
        accessToken,
        // Native-audio model = the whole point (most human voice + native turn-taking/interruption).
        // Plain gemini-2.5-flash is NOT a live-audio model; never let it be the default here.
        // Vertex mode: leave model undefined unless explicitly overridden — Vertex model ids
        // differ (geminiLive.js owns the per-transport default).
        model: accessToken ? (process.env.GEMINI_LIVE_MODEL_VERTEX || undefined)
                           : (model || process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest'),
        voiceName: voiceName || 'Charon',
        systemInstruction,
        handlers: {
          onReady: () => {
            this._ready = true;
            console.log('[geminiLive] setupComplete — ready for audio');
            this._h.onReady?.();
          },
          onAudio: (buf) => {
            // boss's voice: PCM16 @ 24 kHz mono — relay to browser chunk by chunk
            if (!this._bossSpeaking) {
              this._bossSpeaking = true;
              this._h.onBossText?.('[INTERVIEWER SPRICHT]');
            }
            this._h.onBossAudio?.(buf);
          },
          onOutputText: (t) => {
            this._h.onBossText?.(t);
          },
          onInputText: (t) => {
            this._h.onUserText?.(t);
          },
          onTurnComplete: () => {
            this._bossSpeaking = false;
            this._h.onBossText?.('__TURN_COMPLETE__');   // sentinel
            this._h.onTurnComplete?.();
          },
          onInterrupted: () => {
            this._bossSpeaking = false;
            this._h.onInterrupted?.();
          },
          onUsage: (u) => {
            this._h.onUsage?.(u);   // session-cumulative token usage → wsManager prices + caps it
          },
          onError: (e) => {
            console.error('[geminiLive] error:', e.message);
            this._h.onError?.(e);
          },
          onClose: (code, reason) => {
            this._ready = false;
            this._bossSpeaking = false;
            console.log(`[geminiLive] closed code=${code} reason=${reason || '(none)'}`);
            this._h.onClose?.(code, reason);
          },
        },
      });
    } catch (e) {
      console.error('[geminiLive] start failed:', e.message);
      this._h.onError?.(e);
    }
  }

  sendAudioChunk(b64Pcm16k) {
    if (!this._session?.isOpen?.()) return false;
    try { this._session.sendAudioChunk(b64Pcm16k); return true; }
    catch { return false; }
  }

  sendText(text) {
    if (!this._session?.isOpen?.()) return false;
    try { this._session.sendText(text); return true; }
    catch { return false; }
  }

  close() {
    try { this._session?.close?.(); } catch {}
    this._ready = false;
    this._bossSpeaking = false;
  }
}

export default { GeminiLiveProxy };
