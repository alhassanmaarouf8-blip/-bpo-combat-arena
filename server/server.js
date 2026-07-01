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
import { druckLeiterRouter }  from './druckLeiter.js';
import { fluencyRouter }       from './fluencyDrill.js';
import { listeningRouter }     from './listening.js';
import { spokenReviewRouter }  from './spokenReview.js';
import { guideRouter }         from './alhassan.js';
import { transcribeRouter }    from './transcribeRouter.js';
import { placementRouter }      from './placement.js';
import { dbEnabled }            from './db.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
// CLIENT_ORIGIN may be a single URL or a comma-separated list (e.g. your Vercel URL
// plus http://localhost:5173 for local dev). Only these origins are allowed by CORS.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

// The live interview runs on Groq (text LLM) by default.
// At least one back-end must be configured. If USE_GEMINI_LIVE=1, the Gemini Live path
// needs GEMINI_API_KEY; otherwise the Groq text path needs GROQ_API_KEY. Both can coexist.
const hasGroq = !!process.env.GROQ_API_KEY;
const hasGeminiLive = !!process.env.GEMINI_API_KEY;
if (!hasGroq && !hasGeminiLive) {
  console.error('[server] FATAL: set at least one of GROQ_API_KEY or GEMINI_API_KEY in .env');
  process.exit(1);
}
// USE_GEMINI_LIVE=1 → route live interview through Gemini Live (native audio, native VAD).
// Falls back to Groq text path if the key lacks bidiGenerateContent access (graceful degradation).
const USE_GEMINI_LIVE = process.env.USE_GEMINI_LIVE === '1';

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
    // Existing boss provider chain (failover order) — mirrors PROVIDERS in realtimeClient.js:
    // a provider is listed only if its key env is set. "groq+cerebras" => failover armed.
    // Names only; never exposes a key.
    interview: [
      (process.env.INTERVIEW_API_KEY || process.env.GROQ_API_KEY) ? 'groq' : null,
      process.env.CEREBRAS_API_KEY ? 'cerebras' : null,
    ].filter(Boolean).join('+') || 'none',
    openai: false,
    // Gemini Live proxy: USE_GEMINI_LIVE=1 → active; else groq text path (fallback). Boolean
    // only. To enable: get a GEMINI_API_KEY from a billing-enabled GCP project, set
    // USE_GEMINI_LIVE=1 in server/.env (bidiGenerateContent is NOT on the free tier).
    geminiLive: USE_GEMINI_LIVE && !!process.env.GEMINI_API_KEY,
    // If geminiLive is claimed but the key was rejected at session start, this will be
    // "degraded" until a failed session proves it. Client reads this in /health on mount.
    // Is the Deepgram key actually loaded on this instance? Drives neural voice (TTS)
    // AND nova-3 STT — if false, voice goes robotic and STT falls back. (Boolean only;
    // never exposes the key.)
    deepgram: !!process.env.DEEPGRAM_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    // Durable storage: true once DATABASE_URL is set (e.g. a free Neon Postgres). false = data
    // lives on Render's ephemeral disk and is wiped on restart. One-curl verification of durability.
    db: dbEnabled(),
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
app.use('/api', druckLeiterRouter);  // POST /api/druck-leiter/score — honest de-escalation QUALITY read on the pressure clip
app.use('/api', fluencyRouter);   // GET /api/fluency + POST /api/fluency/score — 4-3-2 spoken-fluency drill
app.use('/api', listeningRouter); // GET /api/listening + POST /api/listening/grade — listening & data-capture drill
app.use('/api', spokenReviewRouter); // GET /api/spoken-review + POST /api/spoken-review/grade — spoken-production SRS
app.use('/api', guideRouter);
app.use('/api', paymentsRouter);
app.use('/api', transcribeRouter);  // POST /api/transcribe — spoken-answer STT (Groq Whisper / Deepgram)
app.use(placementRouter);   // /api/placement (user) + /admin/placements (founder KPI) — paths are absolute
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
