/**
 * shadowing.js — "Shadowing" repeat-after-me practice (PAID feature; mic only, never streaming).
 *
 * Per item: the BROWSER speaks the model German sentence via its built-in speechSynthesis
 * (zero cost, no API), the learner records themselves repeating it, and the server transcribes
 * the clip and returns a DETERMINISTIC word-accuracy score + the exact target words that were
 * not recognised. There is NO model-written "pronunciation" note: the server cannot hear the
 * sound (the transcript erases accent), so it never claims to judge pronunciation. Honest by
 * construction. Adds no new paid API.
 *
 *   GET  /api/shadowing            → { sentences:[{id,de,en}] }  (3–5 per session, paid only)
 *   POST /api/shadowing/score      → raw audio + ?id=&ms= → { transcript, target, match, missed }
 *
 * Gated exactly like other paid features: requireAuth + active plan (planOf !== 'free',
 * which already reverts an expired plan to free). Sessions are unlimited.
 */
import express from 'express';
import { requireAuth, planOf }                from './auth.js';
import { BPO_PHRASES }                         from './scenarios.js';
import { transcribeAudio }                     from './planGuide.js';

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

// DETERMINISTIC word accuracy (transcript vs target) — zero cost, no model, no audio analysis.
// HONEST BY CONSTRUCTION: this measures which TARGET WORDS came back in the transcript, i.e.
// WORD ACCURACY — NOT pronunciation/accent. The server never hears the sound, so it never
// claims to judge it. Returns the score plus the exact target words that were not recognised.
function wordAccuracy(transcript, target) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFC')
    .replace(/[^a-zäöüß0-9\s]/gi, ' ').split(/\s+/).filter(Boolean);
  const said = new Set(norm(transcript));
  const want = norm(target);
  if (!said.size || !want.length) return { match: 0, missed: [...new Set(want)] };
  const wantSet = [...new Set(want)];
  let hit = 0; const missed = [];
  for (const w of wantSet) { if (said.has(w)) hit++; else missed.push(w); }
  return { match: Math.round((hit / wantSet.size) * 100), missed };
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
      // 1) transcribe (cheap STT).
      const transcript = (await transcribeAudio(audio, { mime: req.headers['content-type'] || 'audio/wav' })).trim();

      // Edge case: transcription returned nothing → ask to retry.
      if (!transcript) return res.json({ transcript: '', target, retry: true });

      // DETERMINISTIC word accuracy only — NO model, NO pronunciation claim. We report which
      // target words were recognised and which were missed. We deliberately DROPPED the old
      // LLM "Aussprache" note: it judged a sound the server never heard (the transcript erases
      // accent), so any pronunciation verdict it produced was invented. Honest > impressive.
      const { match, missed } = wordAccuracy(transcript, target);

      console.log(`[shadowing] user=${req.account.id} id=${id} accuracy=${match}% missed=${missed.length}`);
      res.json({ transcript, target, match, missed });
    } catch (err) {
      console.error('[shadowing] score error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'shadowing_failed' });
    }
  });
