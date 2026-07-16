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
import { engagementRouter }  from './engagement.js';
import { pushRouter, maybeRunDaily } from './push.js';
import { assessmentRouter }  from './assessment.js';
import { trainingslagerRouter } from './trainingslager.js';
import { paymentsRouter }     from './payments.js';
import { beaconRouter }       from './funnelBeacon.js';
import { adminRouter }        from './admin.js';
import { shadowingRouter }    from './shadowing.js';
import { druckLeiterRouter }  from './druckLeiter.js';
import { fluencyRouter }       from './fluencyDrill.js';
import { listeningRouter }     from './listening.js';
import { satzbauRouter }       from './satzbauSchmiede.js';
import { spokenReviewRouter }  from './spokenReview.js';
import { guideRouter }         from './alhassan.js';
import { transcribeRouter }    from './transcribeRouter.js';
import { placementRouter }      from './placement.js';
import { elevenRouter }          from './elevenRouter.js';
import { vertexConfigured }     from './vertexToken.js';
import { dbEnabled, ensureDatabaseReady } from './db.js';
import { mailerConfigured } from './mailer.js';
import { vacancyTargetRouter } from './vacancyTarget.js';
import { missionControlRouter } from './missionControl.js';
import { salmaCoachRouter } from './salmaCoach.js';
import { studyCohortRouter } from './studyCohort.js';
import { firstSessionTraceRouter } from './firstSessionTrace.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
// CLIENT_ORIGIN may be a single URL or a comma-separated list (e.g. your Vercel URL
// plus http://localhost:5173 for local dev). Only these origins are allowed by CORS.
const configuredOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);
const CLIENT_ORIGINS = IS_PRODUCTION
  ? configuredOrigins.filter((origin) => /^https:\/\//i.test(origin) && !/localhost|127\.0\.0\.1/i.test(origin))
  : configuredOrigins;
if (IS_PRODUCTION && !CLIENT_ORIGINS.length) throw new Error('CLIENT_ORIGIN must include an explicit production HTTPS origin');
if (IS_PRODUCTION && !dbEnabled()) throw new Error('DATABASE_URL is required in production; refusing ephemeral account/payment storage');
if (IS_PRODUCTION && !mailerConfigured()) throw new Error('SMTP_USER and SMTP_PASS are required in production for account verification and recovery');
if (dbEnabled()) await ensureDatabaseReady();
if (IS_PRODUCTION && process.env.ENABLE_MOCK_BILLING === 'true') throw new Error('ENABLE_MOCK_BILLING must be disabled in production');
const paymentRailsEnabled = !!(process.env.VODAFONE_CASH_NUMBER || process.env.INSTAPAY_ADDRESS || process.env.BANK_ACCOUNT_INFO);
if (IS_PRODUCTION && paymentRailsEnabled && String(process.env.ADMIN_KEY || '').length < 32) {
  throw new Error('A high-entropy ADMIN_KEY (at least 32 characters) is required before accepting payments');
}

// The live interview runs on Groq (text LLM) by default.
// At least one back-end must be configured. If USE_GEMINI_LIVE=1, the Gemini Live path
// needs GEMINI_API_KEY; otherwise the Groq text path needs GROQ_API_KEY. Both can coexist.
const hasGroq = !!process.env.GROQ_API_KEY;
// Gemini Live creds = AI Studio key OR Vertex (GEMINI_USE_VERTEX=1 + service-account key,
// which bills the GCP project's $300 credit instead of the card).
const hasGeminiLive = !!process.env.GEMINI_API_KEY || vertexConfigured();
if (!hasGroq) throw new Error('GROQ_API_KEY is required for the default interview path');
// USE_GEMINI_LIVE=1 → route live interview through Gemini Live (native audio, native VAD).
// Falls back to Groq text path if the key lacks bidiGenerateContent access (graceful degradation).

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security headers — production hardening (Layer 13). Zero-dependency, deliberately WITHOUT a
// Content-Security-Policy: this backend serves an API + the ADMIN_KEY-gated HTML panel + WS, and a
// strict CSP would risk breaking the panel/websocket without a real attack surface to justify it.
// HSTS is safe (Render terminates TLS); X-Frame-Options SAMEORIGIN keeps the admin panel usable
// while blocking clickjacking embeds; nosniff + referrer-policy are universally safe.
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.includes('/admin/')) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', req.path.startsWith('/admin')
    ? "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"
    : "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  next();
});

app.use(cors({
  origin(origin, cb) {
    // No Origin header = same-origin / health checks / curl → allow.
    // Allowed origin → allow with CORS headers. Anything else → no CORS headers
    // (the browser then blocks it) without throwing a 500 or spamming the log.
    cb(null, !origin || CLIENT_ORIGINS.includes(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '64kb' }));

// Opportunistic daily push reminder: fire-and-forget on ordinary traffic (throttled inside).
// It never keeps a free service awake or creates traffic by itself. Never blocks the request.
app.use((req, _res, next) => { try { maybeRunDaily(); } catch {} next(); });

app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    build: (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7),
  });
});

// Diagnostic: the browser reports runtime crashes here so they show up in THIS log.
const clientErrorRate = new Map();
app.post('/api/clienterror', (req, res) => {
  const ip = String(req.ip || 'unknown');
  const now = Date.now();
  const hits = (clientErrorRate.get(ip) || []).filter((at) => now - at < 10 * 60 * 1000);
  if (hits.length >= 10) return res.status(429).json({ error: 'rate_limited' });
  hits.push(now); clientErrorRate.set(ip, hits);
  const title = String(req.body?.title || 'client_error').replace(/[\r\n]/g, ' ').slice(0, 80);
  const detail = String(req.body?.detail || '').replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  const path = String(req.body?.path || '').split(/[?#]/)[0].slice(0, 160);
  console.error(`[client-error] title=${JSON.stringify(title)} path=${JSON.stringify(path)} detail=${JSON.stringify(detail)}`);
  res.json({ ok: true });
});

app.use('/api/eleven', elevenRouter);   // ElevenLabs voice session mint (owner-allowlisted)
app.use('/api/auth', authRouter);
app.use('/api/billing', billingRouter);
app.use('/api', progressRouter);
app.use('/api', beaconRouter);   // PII-free funnel counters (see funnelBeacon.js)
app.use('/api', planRouter);
app.use('/api', dailyRouter);
app.use('/api', feedbackRouter);
app.use('/api', assessmentRouter);
app.use('/api', trainingslagerRouter);
app.use('/api', shadowingRouter);
app.use('/api', druckLeiterRouter);  // POST /api/druck-leiter/score — honest de-escalation QUALITY read on the pressure clip
app.use('/api', fluencyRouter);   // GET /api/fluency + POST /api/fluency/score — 4-3-2 spoken-fluency drill
app.use('/api', listeningRouter); // GET /api/listening + POST /api/listening/grade — listening & data-capture drill
app.use('/api', satzbauRouter);   // GET /api/satzbau + POST /api/satzbau/grade — verb-final word-order builder drill
app.use('/api', spokenReviewRouter); // GET /api/spoken-review + POST /api/spoken-review/grade — spoken-production SRS
app.use('/api', guideRouter);
app.use('/api', paymentsRouter);
app.use('/api', transcribeRouter);  // POST /api/transcribe — spoken-answer STT (Groq Whisper / Deepgram)
app.use('/api', vacancyTargetRouter); // Vacancy Target v1 (authenticated, independently kill-switched)
app.use('/api', missionControlRouter); // Job-to-Offer Mission Control (off by default; encrypted, candidate-controlled)
app.use('/api', salmaCoachRouter); // Salma Personal Tutor (off by default; deterministic diagnosis)
app.use('/api', studyCohortRouter); // Signed, allowlisted 21-day research cohort (off by default)
app.use('/api', firstSessionTraceRouter); // First-interview activation trace (owner-only read)
app.use(engagementRouter);  // /admin/engagement — ADMIN_KEY-gated per-user engagement analytics (paths absolute)
app.use(pushRouter);        // /api/push/* (opt-in) + /admin/push/daily (cron) — web-push reminders; paths absolute
app.use(placementRouter);   // /api/placement (user) + /admin/placements (founder KPI) — paths are absolute
app.use(adminRouter);   // /admin (HTML panel + actions), gated by ADMIN_KEY — not under /api

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
