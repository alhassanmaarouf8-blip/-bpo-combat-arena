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
const TRANSCRIBER           = (process.env.TRANSCRIBER || 'groq').toLowerCase();

async function transcribe(buffer, mimeType) {
  if (TRANSCRIBER === 'deepgram') {
    const { transcribeDeepgram } = await import('./transcribeDeepgram.js');
    return transcribeDeepgram(buffer, { language: 'de' });
  }
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

export { router as transcribeRouter };
