import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketManager } from './websocketManager.js';
import { progressRouter }   from './progress.js';
import { authRouter, billingRouter } from './auth.js';
import { planRouter }        from './plans.js';
import { dailyRouter }       from './daily.js';
import { feedbackRouter }    from './feedback.js';
import { assessmentRouter }  from './assessment.js';
import { trainingslagerRouter } from './trainingslager.js';
import { paymentsRouter }     from './payments.js';
import { adminRouter }        from './admin.js';
import { shadowingRouter }    from './shadowing.js';
import { guideRouter }         from './alhassan.js';
import { transcribeRouter }    from './transcribeRouter.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
// CLIENT_ORIGIN may be a single URL or a comma-separated list (e.g. your Vercel URL
// plus http://localhost:5173 for local dev). Only these origins are allowed by CORS.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

// The live interview is now 100% OpenAI-free: the boss brain runs on Groq
// (llama-3.3-70b), spoken answers transcribe on Groq Whisper / Deepgram, the
// debrief runs on Groq. GROQ_API_KEY is therefore the one hard requirement to
// boot. OPENAI_API_KEY is intentionally never read anywhere in the interview path.
if (!process.env.GROQ_API_KEY) {
  console.error('[server] FATAL: GROQ_API_KEY is not set in .env');
  process.exit(1);
}

const app = express();

app.use(cors({
  origin(origin, cb) {
    // No Origin header = same-origin / health checks / curl → allow.
    // Allowed origin → allow with CORS headers. Anything else → no CORS headers
    // (the browser then blocks it) without throwing a 500 or spamming the log.
    cb(null, !origin || CLIENT_ORIGINS.includes(origin));
  },
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    ts: new Date().toISOString(),
    // Provider markers — lets a deploy be verified as the OpenAI-free build.
    interview: 'groq',
    openai: false,
    // Is the Deepgram key actually loaded on this instance? Drives neural voice (TTS)
    // AND nova-3 STT — if false, voice goes robotic and STT falls back. (Boolean only;
    // never exposes the key.)
    deepgram: !!process.env.DEEPGRAM_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    stt: (process.env.TRANSCRIBER || 'deepgram').toLowerCase(),
    // Is the keep-alive self-ping armed? (warms the free dyno so "begin" isn't a cold start)
    keepAlive: !!(process.env.RENDER_EXTERNAL_URL || process.env.RENDER),
    // Deploy marker: the live git commit (Render sets RENDER_GIT_COMMIT). Lets us
    // confirm which build is ACTUALLY serving instead of guessing from uptime.
    build: (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7),
  });
});

// Diagnostic: the browser reports runtime crashes here so they show up in THIS log.
app.post('/api/clienterror', (req, res) => {
  console.error('═══════════ [CLIENT ERROR] ═══════════\n' +
    JSON.stringify(req.body, null, 2).slice(0, 4000) +
    '\n══════════════════════════════════════');
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/billing', billingRouter);
app.use('/api', progressRouter);
app.use('/api', planRouter);
app.use('/api', dailyRouter);
app.use('/api', feedbackRouter);
app.use('/api', assessmentRouter);
app.use('/api', trainingslagerRouter);
app.use('/api', shadowingRouter);
app.use('/api', guideRouter);
app.use('/api', paymentsRouter);
app.use('/api', transcribeRouter);  // POST /api/transcribe — spoken-answer STT (Groq Whisper / Deepgram)
app.use(adminRouter);   // /admin (HTML panel + actions), gated by ADMIN_KEY — not under /api

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

const httpServer = http.createServer(app);
const wsManager  = new WebSocketManager(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket endpoint ws://localhost:${PORT}`);
  console.log(`[server] Accepting connections from ${CLIENT_ORIGINS.join(', ')}`);

  // ── Keep-alive: ping our own public URL every 10 min so Render's free tier never
  // reaches the 15-min idle spin-down. This removes the multi-second cold-start the
  // user hits when clicking "Interview starten" on a slept dyno. Free; no new service.
  const SELF_URL = process.env.RENDER_EXTERNAL_URL
    || (process.env.RENDER ? 'https://bpo-combat-arena.onrender.com' : null);
  if (SELF_URL) {
    const ping = () => fetch(`${SELF_URL}/health`).catch(() => {});
    setInterval(ping, 4 * 60 * 1000).unref?.();
    console.log(`[server] keep-alive self-ping armed → ${SELF_URL}/health every 4 min`);
  } else {
    console.log('[server] keep-alive NOT armed (no RENDER env) — local/dev only');
  }
});

httpServer.on('error', (err) => {
  console.error('[server] HTTP server error:', err.message);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`[server] ${signal} received – shutting down`);
  await wsManager.shutdown();
  httpServer.close(() => {
    console.log('[server] Closed. Goodbye.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',   (err) => { console.error('[server] uncaughtException:', err); process.exit(1); });
process.on('unhandledRejection',  (reason) => { console.error('[server] unhandledRejection:', reason); });
