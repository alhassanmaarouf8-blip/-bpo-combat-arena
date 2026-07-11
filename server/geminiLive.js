/**
 * geminiLive.js — server-side proxy to Google Gemini Live (speech-to-speech).
 *
 * This is the ROOT fix for the "dumb machine" interview: instead of stitching
 * STT → text-LLM → TTS with a client-side silence-timer (four guessers that compound
 * errors and cut the user off), the interview runs on ONE native-audio model that hears,
 * understands, decides turn boundaries, handles interruptions, and speaks — natively.
 *
 * This module owns ONLY the server↔Gemini Live socket. The browser↔server side and the
 * scoring loop are wired separately, behind the USE_GEMINI_LIVE flag, so the existing
 * Groq text pipeline stays the default until the owner validates this live.
 *
 * Audio contract: input = PCM16 mono little-endian @16kHz (mimeType 'audio/pcm;rate=16000');
 * output = PCM16 @24kHz. Input/output transcription are enabled so the existing
 * scoring/coach/SRS pipeline can consume the same transcripts it does today.
 *
 * Outbound socket uses the `ws` library (already a dependency) rather than Node's global
 * WebSocket: the global exists only on Node 21+, but CI (Guardian) and `engines` pin Node 20,
 * where `new WebSocket()` throws ReferenceError. `ws` works identically on every supported Node.
 */

import { WebSocket } from 'ws';

const HOST = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest';

// Vertex AI transport (GEMINI_USE_VERTEX=1): same bidi protocol, but billed to the GCP
// project ($300 credit) via OAuth instead of the AI Studio key. Model ids differ — the
// native-audio live model on Vertex is the -preview-native-audio one (probe-verified
// 2026-07-11: setup + German audio out on this exact id; the AI Studio '-latest' alias 404s).
const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0719205380';
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
const VERTEX_HOST = `wss://${VERTEX_LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
const VERTEX_DEFAULT_MODEL = process.env.GEMINI_LIVE_MODEL_VERTEX || 'gemini-live-2.5-flash-preview-native-audio-09-2025';

// Vertex wants the fully-qualified publisher path; accept bare ids ('gemini-live-…') and
// AI-Studio-style ids ('models/gemini-…') and qualify them.
function vertexModelPath(model) {
  if (model.startsWith('projects/')) return model;
  const bare = model.replace(/^models\//, '');
  return `projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${bare}`;
}

// Decode whatever frame type the server sends (string | Buffer | ArrayBuffer | Blob) → object.
async function frameToJson(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (data && typeof data.arrayBuffer === 'function') {           // Blob
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'));
  }
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString('utf8'));
  if (Buffer.isBuffer(data))       return JSON.parse(data.toString('utf8'));
  return JSON.parse(Buffer.from(data).toString('utf8'));
}

/**
 * Open a Gemini Live session.
 * @param {object} opts
 * @param {string} [opts.apiKey]       GEMINI_API_KEY (AI Studio transport)
 * @param {string} [opts.accessToken]  OAuth token (Vertex AI transport — bills the GCP project)
 * @param {string} opts.systemInstruction  the interview brief (buildSessionScript().instructions)
 * @param {string} [opts.model]        Live model id
 * @param {string} [opts.voiceName]    prebuilt voice (e.g. 'Charon'); omit for model default
 * @param {object} opts.handlers       { onReady, onAudio(Buffer), onInputText(s), onOutputText(s),
 *                                        onTurnComplete, onInterrupted, onUsage(usageMetadata),
 *                                        onError(e), onClose(code,reason) }
 * @returns {Promise<{ sendAudioChunk, sendText, close, isOpen }>}
 */
export function openGeminiLive({ apiKey, accessToken, systemInstruction, model, voiceName, handlers = {} }) {
  const vertex = !!accessToken;   // Vertex mode = OAuth token supplied (see vertexToken.js)
  if (!apiKey && !accessToken) throw new Error('geminiLive: apiKey or accessToken required');
  if (!model) model = vertex ? VERTEX_DEFAULT_MODEL : DEFAULT_MODEL;
  const h = handlers;
  const ws = vertex
    ? new WebSocket(VERTEX_HOST, { headers: { Authorization: `Bearer ${accessToken}` } })
    : new WebSocket(`${HOST}?key=${apiKey}`);
  let ready = false;

  const setup = {
    setup: {
      model: vertex ? vertexModelPath(model) : model,
      generationConfig: {
        responseModalities: ['AUDIO'],
        // Thinking OFF: the -latest native-audio alias thinks before answering, which doubled
        // measured turn latency (first audio 2.05s → 1.10s with budget 0, same key/model/voice).
        thinkingConfig: { thinkingBudget: 0 },
        ...(voiceName ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } : {}),
      },
      // Faster end-of-turn: detect the candidate finishing sooner (interview turns are short);
      // 400ms silence + high end sensitivity measured setup-valid with no latency penalty.
      realtimeInputConfig: { automaticActivityDetection: { endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', silenceDurationMs: 400 } },
      systemInstruction: { parts: [{ text: systemInstruction }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };

  ws.on('open', () => { ws.send(JSON.stringify(setup)); });

  ws.on('message', async (data) => {
    let msg;
    try { msg = await frameToJson(data); }
    catch (e) { h.onError?.(new Error('geminiLive: bad frame: ' + e.message)); return; }

    if (msg.setupComplete) { ready = true; h.onReady?.(); return; }

    const sc = msg.serverContent;
    if (sc) {
      const parts = sc.modelTurn?.parts || [];
      for (const p of parts) {
        if (p.inlineData?.data && String(p.inlineData.mimeType || '').includes('audio')) {
          h.onAudio?.(Buffer.from(p.inlineData.data, 'base64'));        // PCM16 @24kHz
        }
      }
      if (sc.inputTranscription?.text)  h.onInputText?.(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) h.onOutputText?.(sc.outputTranscription.text);
      if (sc.interrupted)               h.onInterrupted?.();
      if (sc.turnComplete)              h.onTurnComplete?.();
    }
    // Token accounting: Gemini reports SESSION-CUMULATIVE usage per turn. Forward it so the
    // bridge can price it (audio/text in+out) and enforce the monthly spend cap.
    if (msg.usageMetadata) h.onUsage?.(msg.usageMetadata);
    if (msg.error) h.onError?.(new Error('geminiLive server error: ' + JSON.stringify(msg.error)));
  });

  ws.on('error', (e) => { h.onError?.(new Error('geminiLive ws error: ' + (e?.message || 'unknown'))); });
  ws.on('close', (code, reason) => { ready = false; h.onClose?.(code, reason?.toString?.() || ''); });

  return {
    isOpen: () => ready && ws.readyState === 1,
    // Stream one chunk of mic audio (base64 PCM16 @16kHz).
    sendAudioChunk(base64Pcm16k) {
      if (ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64Pcm16k }] } }));
      return true;
    },
    // Send a text user turn (used for testing + typed fallback).
    sendText(text) {
      if (ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
      return true;
    },
    close() { try { ws.close(); } catch {} },
  };
}

export default { openGeminiLive };
