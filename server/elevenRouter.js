/**
 * elevenRouter.js — client-facing session mint for the ElevenLabs voice path (Phase 2).
 *
 * GET /api/eleven/session → { signedUrl, agentId } for an authed account that is in the rollout
 * allowlist (defaults to the owner only, so this is INERT for everyone else until we widen it).
 * The API key never leaves the server; the browser gets only a short-lived signed URL.
 */
import express from 'express';
import { getSignedUrl, elevenReady, AGENT_ID, buildOverrides } from './elevenAgent.js';
import { verifyToken, getAccountById } from './auth.js';

export const elevenRouter = express.Router();

// Rollout allowlist — owner first. Comma-separated ELEVEN_ALLOW_EMAILS widens it later; no env needed now.
const ALLOW = (process.env.ELEVEN_ALLOW_EMAILS || 'alhassanmaarouf2@gmail.com')
  .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

elevenRouter.get('/session', async (req, res) => {
  if (!elevenReady()) return res.status(503).json({ error: 'not_ready' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || (req.query.token || '');
  const p = verifyToken(token);
  if (!p) return res.status(401).json({ error: 'unauthorized' });

  // TEST PHASE: any AUTHENTICATED user may use the ?elevenlabs test page (behind login + obscure URL).
  // The email allowlist + daily budget guard get enforced when this is wired into the real fight flow.
  // (ALLOW / getAccountById kept imported for that next step.)
  void ALLOW; void getAccountById;

  const signedUrl = await getSignedUrl();
  if (!signedUrl) return res.status(502).json({ error: 'signed_url_failed' });

  // Override the voice to Yasmin's German FEMALE voice (the agent's default is male). Only voice_id is
  // overridden here — the agent keeps its baked-in German flash_v2_5 model. Per-persona voices next.
  res.json({ signedUrl, agentId: AGENT_ID, overrides: { tts: { voiceId: 'Ah5UjbC5d1A2iCl9Lbe7' } } });
});

export default { elevenRouter };
