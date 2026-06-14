/**
 * shadowing.js — "Shadowing" pronunciation practice (PAID feature; mic + cheap text models,
 * NEVER a Realtime session).
 *
 * Per item: the BROWSER speaks the model German sentence via its built-in speechSynthesis
 * (zero cost, no API), the learner records themselves repeating it, and the server:
 *   1) transcribes the clip with gpt-4o-mini-transcribe   (transcribeAudio — already in use)
 *   2) returns a short Arabic pronunciation note via gpt-4o-mini (speakingFeedback — the SAME
 *      Arabic-feedback path the Zielplan speaking step uses)
 * It adds NO new paid API and opens NO Realtime session — only the cheap calls already used.
 *
 *   GET  /api/shadowing            → { sentences:[{id,de,en}] }  (3–5 per session, paid only)
 *   POST /api/shadowing/score      → raw audio + ?id=&ms=&level= → { transcript, target, match, note_de, note_ar }
 *
 * Gated exactly like other paid features: requireAuth + active plan (planOf !== 'free',
 * which already reverts an expired plan to free). Sessions are unlimited.
 */
import express from 'express';
import { requireAuth, planOf }                from './auth.js';
import { BPO_PHRASES }                         from './scenarios.js';
import { transcribeAudio, speakingFeedback }   from './planGuide.js';

export const shadowingRouter = express.Router();

const PER_SESSION_MIN = 3;
const PER_SESSION_MAX = 5;

// Active-paid gate (basic/elite/admin). planOf() already reverts an expired plan to 'free',
// so an expired subscriber is blocked here automatically. Sends 402 and returns false on block.
function paidOnly(req, res) {
  if (planOf(req.account) === 'free') {
    res.status(402).json({ error: 'plan_required', reason: 'shadowing_is_paid' });
    return false;
  }
  return true;
}

// Random subset of sentence indices → [{ id, de, en }]. id is the stable BPO_PHRASES index,
// so /score can look the target up server-side (never trusts a client-sent sentence).
function pickSentences(n) {
  const idx = BPO_PHRASES.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => ({ id: i, de: BPO_PHRASES[i].de, en: BPO_PHRASES[i].en }));
}

// Deterministic word-overlap closeness 0–100 (transcript vs target) — zero cost, no model.
function matchScore(transcript, target) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFC')
    .replace(/[^a-zäöüß0-9\s]/gi, ' ').split(/\s+/).filter(Boolean);
  const said = new Set(norm(transcript));
  const want = norm(target);
  if (!said.size || !want.length) return 0;
  const wantSet = new Set(want);
  let hit = 0;
  for (const w of wantSet) if (said.has(w)) hit++;
  return Math.round((hit / wantSet.size) * 100);
}

// ── GET a fresh session of 3–5 sentences (paid only, unlimited sessions) ──
shadowingRouter.get('/shadowing', requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  const span = PER_SESSION_MAX - PER_SESSION_MIN + 1;
  const n    = Math.min(PER_SESSION_MIN + Math.floor(Math.random() * span), BPO_PHRASES.length);
  res.json({ sentences: pickSentences(n) });
});

// ── POST one recording → transcript + Arabic pronunciation note ──
shadowingRouter.post('/shadowing/score',
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '15mb' }),
  requireAuth,
  async (req, res) => {
    if (!paidOnly(req, res)) return;
    try {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id) || id < 0 || id >= BPO_PHRASES.length) {
        return res.status(400).json({ error: 'bad_sentence' });
      }
      const target = BPO_PHRASES[id].de;

      // Edge case: empty / failed recording.
      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length < 1000) {
        return res.status(400).json({ error: 'empty_audio' });
      }
      const durationMs = Math.max(0, parseInt(req.query.ms, 10) || 0);
      const level      = req.query.level === 'b2' ? 'b2' : 'a2-b1';

      // 1) transcribe (cheap STT).
      const transcript = (await transcribeAudio(audio, { mime: req.headers['content-type'] || 'audio/wav' })).trim();

      // Edge case: transcription returned nothing → ask to retry, skip the feedback call (no waste).
      if (!transcript) return res.json({ transcript: '', target, retry: true });

      // 2) deterministic closeness (free) + 3) short Arabic note via the existing feedback path.
      const match = matchScore(transcript, target);
      let note_de = '', note_ar = '';
      try {
        const fb = await speakingFeedback({
          transcript, wpm: 0, fillers: 0,
          topic: `Nachsprechen (Shadowing) des Modellsatzes: „${target}". Bewerte NUR Aussprache und Genauigkeit beim Nachsprechen — kurz.`,
          level,
        });
        note_de = fb.de; note_ar = fb.ar;
      } catch (e) {
        console.error('[shadowing] feedback failed:', e.message);   // transcript+match still returned
      }

      console.log(`[shadowing] user=${req.account.id} id=${id} match=${match}% words="${transcript.slice(0, 60)}"`);
      res.json({ transcript, target, match, note_de, note_ar });
    } catch (err) {
      console.error('[shadowing] score error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'shadowing_failed' });
    }
  });
