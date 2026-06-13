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

const PORT = parseInt(process.env.PORT ?? '3001', 10);
// CLIENT_ORIGIN may be a single URL or a comma-separated list (e.g. your Vercel URL
// plus http://localhost:5173 for local dev). Only these origins are allowed by CORS.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!process.env.OPENAI_API_KEY) {
  console.error('[server] FATAL: OPENAI_API_KEY is not set in .env');
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
  res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
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

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

const httpServer = http.createServer(app);
const wsManager  = new WebSocketManager(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket endpoint ws://localhost:${PORT}`);
  console.log(`[server] Accepting connections from ${CLIENT_ORIGINS.join(', ')}`);
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
