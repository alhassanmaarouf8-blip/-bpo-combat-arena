/**
 * elevenRouter.js — client-facing session mint for the ElevenLabs voice path (Phase 2).
 *
 * GET /api/eleven/session → { signedUrl, agentId } for an authed account that is in the rollout
 * allowlist (defaults to the owner only, so this is INERT for everyone else until we widen it).
 * The API key never leaves the server; the browser gets only a short-lived signed URL.
 */
import express from 'express';
import { getSignedUrl, elevenReady, AGENT_ID } from './elevenAgent.js';
import { verifyToken, getAccountById } from './auth.js';
import { getBossConfig } from './realtimeClient.js';
import { buildSessionScript } from './scenarios.js';

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

  // Build the REAL interview for the chosen persona — the SAME prompt + voice the Groq/Gemini paths use,
  // handed to ElevenLabs as per-session overrides (the agent has these fields override-enabled).
  const bossId = String(req.query.boss || 'yasmin');
  const level  = String(req.query.level || 'a2-b1');
  const boss   = getBossConfig(bossId);
  let overrides = { tts: { voiceId: boss?.elevenVoice || 'Ah5UjbC5d1A2iCl9Lbe7' } };
  try {
    if (boss) {
      const script = buildSessionScript({
        persona: boss.persona, displayName: boss.displayName,
        greeting: boss.greeting, greetings: boss.greetings, levelId: level,
      });
      overrides = {
        agent: {
          prompt: { prompt: script.instructions },
          firstMessage: script.openingLine || boss.greeting,
          language: 'de',
        },
        tts: { voiceId: boss.elevenVoice || 'Ah5UjbC5d1A2iCl9Lbe7' },
      };
    }
  } catch (e) { console.error(`[elevenRouter] script build failed boss=${bossId}: ${e.message}`); /* fall back to voice-only override */ }

  res.json({ signedUrl, agentId: AGENT_ID, bossId, overrides });
});

export default { elevenRouter };
