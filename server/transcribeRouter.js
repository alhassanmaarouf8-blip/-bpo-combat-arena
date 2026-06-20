/**
 * transcribeRouter.js — spoken-answer speech-to-text for the live interview.
 *
 * The interview is turn-based and text-driven: the candidate may TYPE an answer
 * (sent straight over the WebSocket) or SPEAK it. A spoken clip is POSTed here as
 * multipart audio and converted to German text, which the client then sends as a
 * normal `answer` turn. Audio travels over HTTP (multer) — never the WebSocket,
 * whose frames are capped at 64 KB.
 *
 * 100% OpenAI-free. Default engine is Groq Whisper (whisper-large-v3) via the
 * OpenAI-compatible Groq endpoint; set TRANSCRIBER=deepgram to use Deepgram nova.
 */

import express from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import { verifyToken, getAccountById, dailyMinutesFor } from './auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const GROQ_BASE             = 'https://api.groq.com/openai/v1';
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';
const TRANSCRIBER           = (process.env.TRANSCRIBER || 'groq').toLowerCase();

let _groq = null;
function groqClient() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  _groq = new OpenAI({ apiKey, baseURL: GROQ_BASE });
  return _groq;
}

async function transcribe(buffer, mimeType) {
  if (TRANSCRIBER === 'deepgram') {
    const { transcribeDeepgram } = await import('./transcribeDeepgram.js');
    return transcribeDeepgram(buffer, { language: 'de' });
  }
  // Groq Whisper. The filename extension is derived from the real mime so browser
  // webm/opus ("audio/webm;codecs=opus") is accepted, not just clean wav.
  const ext = (mimeType.split('/')[1] || 'webm').split(';')[0].trim() || 'webm';
  const file = await toFile(buffer, `answer.${ext}`, { type: mimeType });
  const out = await groqClient().audio.transcriptions.create({
    model:           GROQ_TRANSCRIBE_MODEL,
    file,
    language:        'de',
    response_format: 'text',
  });
  return (typeof out === 'string' ? out : out?.text || '').trim();
}

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  res.set('Cache-Control', 'no-store');

  // Same auth + plan gate as a live fight: only paying users with daily minutes.
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'auth_required' });
  const account = await getAccountById(payload.uid);
  if (!account) return res.status(401).json({ error: 'invalid_account' });
  if (dailyMinutesFor(account) <= 0) return res.status(402).json({ error: 'daily_limit' });

  if (!req.file || !req.file.buffer?.length) return res.status(400).json({ error: 'missing_audio' });
  const mimeType = (req.file.mimetype || 'audio/webm').toString();

  try {
    const text = await transcribe(req.file.buffer, mimeType);
    return res.json({ text: text || '' });
  } catch (err) {
    console.error(`[transcribeRouter] failed user=${account.id}: ${err.message}`);
    return res.status(502).json({ error: 'transcribe_failed', message: err.message });
  }
});

export { router as transcribeRouter };
