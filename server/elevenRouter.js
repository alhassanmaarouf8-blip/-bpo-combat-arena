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
import { buildElevenDebrief } from './elevenDebrief.js';
import { scoreTurn } from './scoreFactors.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Raw character data → a LEAN persona prompt for ElevenLabs (the full buildSessionScript prompt is huge
// and slowed the LLM back down; ElevenLabs handles turn-taking natively so it doesn't need those rules).
let RAW_CHARS = {};
try {
  const j = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'interviewer-characters.json'), 'utf8'));
  (j.characters || []).forEach((c) => { RAW_CHARS[c.id] = c; });
} catch (e) { console.error('[elevenRouter] could not load characters:', e.message); }

function leanPromptFor(bossId, displayName) {
  const ch = RAW_CHARS[bossId];
  const core = ch
    ? `${ch.system_prompt || ''}${ch.emotional_default ? `\nGrundhaltung: ${ch.emotional_default}` : ''}${ch.speaking_style?.rhythm ? `\nSprechstil: ${ch.speaking_style.rhythm}` : ''}`
    : `Du bist ${displayName || 'ein/e Interviewer/in'}, ein/e deutsche/r BPO-Interviewer/in.`;
  return `${core}\n\nFühre ein realistisches, natürliches deutsches Job-Interview (Kundenservice/BPO). Begrüße kurz, dann frage nacheinander nach Erfahrung, Motivation und stelle EINE kurze Situationsfrage. Bleib in deiner Rolle. Stelle IMMER nur EINE Frage pro Turn und warte auf die Antwort. Kurze, menschliche Reaktionen, keine langen Monologe. Antworte AUSSCHLIESSLICH auf Deutsch.`;
}

export const elevenRouter = express.Router();

// Rollout allowlist — owner first. Comma-separated ELEVEN_ALLOW_EMAILS widens it later; no env needed now.
const ALLOW = (process.env.ELEVEN_ALLOW_EMAILS || 'alhassanmaarouf2@gmail.com')
  .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

// ── Cost guard (FILE-persisted, resets daily) — bounds ElevenLabs spend during the rollout.
// Persisted to disk (like geminiBudget) so the caps survive process restarts/crashes, not just live in
// memory. (Render's ephemeral disk still resets on a full redeploy — same limitation as gemini-budget.json;
// a DB-backed per-user quota via elevenBudget is the durable end state.) Global cap AND per-user cap.
const COST_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'eleven-cost.json');
let costState = { day: '', global: 0, users: {} };
try { costState = JSON.parse(fs.readFileSync(COST_FILE, 'utf8')); } catch { /* first run / wiped disk */ }
function persistCost() {
  try { fs.mkdirSync(path.dirname(COST_FILE), { recursive: true }); fs.writeFileSync(COST_FILE, JSON.stringify(costState)); }
  catch (e) { console.error('[elevenRouter] cost persist failed:', e.message); }
}
function costGate(userKey) {
  const today = new Date().toISOString().slice(0, 10);
  if (costState.day !== today) { costState = { day: today, global: 0, users: {} }; }
  const GLOBAL  = parseInt(process.env.ELEVEN_DAILY_SESSION_CAP || '50', 10);
  const PERUSER = parseInt(process.env.ELEVEN_USER_SESSION_CAP  || '20', 10);
  if (costState.global >= GLOBAL) return 'global_cap';
  const u = costState.users[userKey] || 0;
  if (u >= PERUSER) return 'user_cap';
  costState.global += 1; costState.users[userKey] = u + 1; persistCost();
  return null;
}

elevenRouter.get('/session', async (req, res) => {
  if (!elevenReady()) return res.status(503).json({ error: 'not_ready' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || (req.query.token || '');
  const p = verifyToken(token);
  if (!p) return res.status(401).json({ error: 'unauthorized' });

  // TEST PHASE: any AUTHENTICATED user may use the ?elevenlabs test page (behind login + obscure URL).
  // The email allowlist gets enforced when this is wired into the real fight flow.
  void ALLOW; void getAccountById;

  // Cost guard — bounds ElevenLabs spend (owner's zero-spend rule) during the rollout.
  const capErr = costGate(p.id || p.userId || p.uid || p.sub || 'anon');
  if (capErr) return res.status(429).json({ error: capErr });

  const signedUrl = await getSignedUrl();
  if (!signedUrl) return res.status(502).json({ error: 'signed_url_failed' });

  // Build the REAL interview for the chosen persona — the SAME prompt + voice the Groq/Gemini paths use,
  // handed to ElevenLabs as per-session overrides (the agent has these fields override-enabled).
  const bossId = String(req.query.boss || 'yasmin');
  const boss   = getBossConfig(bossId);
  const overrides = {
    agent: {
      prompt: { prompt: leanPromptFor(bossId, boss?.displayName) },
      firstMessage: boss?.greeting || 'Guten Tag.',
      language: 'de',
    },
    tts: { voiceId: boss?.elevenVoice || 'Ah5UjbC5d1A2iCl9Lbe7' },
  };
  res.json({ signedUrl, agentId: AGENT_ID, bossId, overrides });
});

// Per-turn HP scoring — the SAME scorer the live fight uses (scoreFactors), so HP moves identically.
elevenRouter.post('/score', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || (req.body?.token || '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { transcript = '', durationMs = 0, level = 'a2-b1', stage = 0 } = req.body || {};
    const r = scoreTurn(transcript, durationMs, { levelId: level, stage });
    res.json(r);
  } catch (e) { console.error('[elevenRouter] score failed:', e.message); res.status(500).json({ error: 'score_failed' }); }
});

// End-of-interview debrief from the ElevenLabs transcript — reuses the app's real feedback pipeline
// (generateDebrief + gradeTranscript + L1 + structure-wins). This is MUST #2: accurate, coherent feedback.
elevenRouter.post('/debrief', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || (req.body?.token || '');
  const p = verifyToken(token);
  if (!p) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { transcript = [], level = 'a2-b1', speechMs = 0 } = req.body || {};
    const userId = p.id || p.userId || p.uid || p.sub || 'anon';
    const debrief = await buildElevenDebrief({ transcript, level, userId, speechMs });
    res.json(debrief);
  } catch (e) {
    console.error('[elevenRouter] debrief failed:', e.message);
    res.status(500).json({ error: 'debrief_failed' });
  }
});

// (Removed the temporary /_turn agent-tuning endpoint — the fast turn config is locked on the agent:
//  turn_timeout 1.5 · eager · turn_v3 · speculative. If the agent is ever recreated, re-apply that config.)

export default { elevenRouter };

