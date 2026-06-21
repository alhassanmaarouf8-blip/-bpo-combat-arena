/**
 * transcribeRouter.js — spoken-answer speech-to-text for the live interview.
 *
 * The interview is turn-based and text-driven: the candidate may TYPE an answer
 * (sent straight over the WebSocket) or SPEAK it. A spoken clip is POSTed here as
 * the raw audio body and converted to German text, which the client then sends as a
 * normal `answer` turn. Audio travels over HTTP — never the WebSocket (64 KB frames).
 *
 * 100% OpenAI-free and zero extra dependencies: no `openai` SDK, no `multer`. The raw
 * body is read with express.raw(); Groq Whisper is called over plain fetch. Default
 * engine is Groq Whisper (whisper-large-v3); set TRANSCRIBER=deepgram to use Deepgram.
 */

import express from 'express';
import { verifyToken, getAccountById, dailyMinutesFor } from './auth.js';

const router = express.Router();

const GROQ_BASE             = 'https://api.groq.com/openai/v1';
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';
const TRANSCRIBER           = (process.env.TRANSCRIBER || 'deepgram').toLowerCase();

// ── Boss voice: Deepgram Aura-2 German TTS (uses the existing DEEPGRAM_API_KEY) ──
// Neural, natural German; no OpenAI, no new key. The client falls back to the free
// browser voice if this is unavailable. Audio is returned as MP3 for easy playback.
const DG_SPEAK_URL  = 'https://api.deepgram.com/v1/speak';
const AURA_DE_VOICES = new Set([
  'aura-2-julius-de', 'aura-2-fabian-de',                       // masculine
  'aura-2-lara-de', 'aura-2-elara-de', 'aura-2-aurelia-de',     // feminine
  'aura-2-kara-de', 'aura-2-viktoria-de',
]);
const DEFAULT_VOICE = 'aura-2-julius-de';

async function groqTranscribe(buffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  // Native FormData/Blob (Node 20) → multipart, sent over fetch. No SDK needed.
  const ext = (mimeType.split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mimeType }), `answer.${ext}`);
  fd.append('model', GROQ_TRANSCRIBE_MODEL);
  fd.append('language', 'de');
  fd.append('response_format', 'text');

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq STT ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.text()).trim();   // response_format 'text' → plain transcript
}

async function transcribe(buffer, mimeType) {
  // Default engine: Deepgram nova-3 (de) — markedly better on Arabic-accented German
  // than Whisper (which mangled "bereit"→"traurig" etc.). If Deepgram errors (outage/
  // key) or returns nothing, fall back to Groq Whisper so an answer is NEVER silently
  // lost. Override the default with TRANSCRIBER=groq.
  if (TRANSCRIBER !== 'groq') {
    try {
      const { transcribeDeepgram } = await import('./transcribeDeepgram.js');
      const text = await transcribeDeepgram(buffer, { language: 'de', model: 'nova-3', contentType: mimeType });
      if (text && text.trim()) return text.trim();
      throw new Error('deepgram returned empty transcript');
    } catch (err) {
      console.error(`[transcribeRouter] Deepgram nova-3 failed → Groq Whisper fallback: ${err.message}`);
      return groqTranscribe(buffer, mimeType);
    }
  }
  return groqTranscribe(buffer, mimeType);
}

// Raw audio body (no multer): the client POSTs the clip bytes with an audio/* type.
router.post('/transcribe',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');

    // Same auth + plan gate as a live fight: only paying users with daily minutes.
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const payload = token ? verifyToken(token) : null;
    if (!payload) return res.status(401).json({ error: 'auth_required' });
    const account = await getAccountById(payload.uid);
    if (!account) return res.status(401).json({ error: 'invalid_account' });
    if (dailyMinutesFor(account) <= 0) return res.status(402).json({ error: 'daily_limit' });

    const buffer = req.body;
    if (!buffer || !buffer.length) return res.status(400).json({ error: 'missing_audio' });
    const mimeType = (req.headers['content-type'] || 'audio/wav').toString();

    try {
      const text = await transcribe(buffer, mimeType);
      return res.json({ text: text || '' });
    } catch (err) {
      console.error(`[transcribeRouter] failed user=${account.id}: ${err.message}`);
      return res.status(502).json({ error: 'transcribe_failed', message: err.message });
    }
  }
);

// ── Boss voice: POST /api/tts { text, voice? } → German MP3 (Deepgram Aura-2) ─────
// Returns audio/mpeg on success. On any failure (no key, Deepgram error) returns a
// non-2xx JSON so the client cleanly falls back to the free browser voice.
router.post('/tts', express.json({ limit: '16kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'auth_required' });
  const account = await getAccountById(payload.uid);
  if (!account) return res.status(401).json({ error: 'invalid_account' });
  if (dailyMinutesFor(account) <= 0) return res.status(402).json({ error: 'daily_limit' });

  const text = (req.body?.text ?? '').toString().slice(0, 1500).trim();
  if (!text) return res.status(400).json({ error: 'missing_text' });
  const voice = AURA_DE_VOICES.has(req.body?.voice) ? req.body.voice : DEFAULT_VOICE;

  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return res.status(503).json({ error: 'tts_unavailable' });   // client → browser voice

  try {
    const r = await fetch(`${DG_SPEAK_URL}?model=${voice}&encoding=mp3`, {
      method:  'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[tts] Deepgram ${r.status}: ${body.slice(0, 200)}`);
      return res.status(502).json({ error: 'tts_failed' });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    return res.send(buf);
  } catch (err) {
    console.error(`[tts] failed user=${account.id}: ${err.message}`);
    return res.status(502).json({ error: 'tts_failed' });
  }
});

export { router as transcribeRouter };
