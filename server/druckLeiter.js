/**
 * druckLeiter.js — DRUCK-LEITER de-escalation QUALITY scoring (zero cost, honest by construction).
 *
 * The client already measures REAL voiced time (>=5s = "kept talking under pressure"). That signal
 * alone rewards babble, though the skill-graph maps these rungs to DE-ESCALATION. This router adds an
 * HONEST quality read on top of it — WITHOUT ever failing a learner on a signal the STT might have
 * missed:
 *
 *   POST /api/druck-leiter/score   raw audio/wav  (?barbs=<JSON array of the rung's barbs>)
 *     → { transcript, souveraen, moves:{ acknowledged, offeredSolution, stayedSie, noInsult }, tip }
 *
 * CREDIT-ONLY, LENIENT detection: we only ever ADD credit for a de-escalation move we can positively
 * see in the transcript. ABSENCE is never treated as failure (Whisper drops words, especially fast/
 * accented speech) — on absence the client's taught KONTER phrase simply stands and `tip` TEACHES the
 * pro sequence. So we can never falsely tell a learner they got it wrong. `souveraen` is true as soon
 * as ONE real move is detected. The boss's own barbs are STRIPPED first (they're the interviewer's
 * words leaking into the mic, not the learner's).
 *
 * Drills are UNLIMITED: authed only, NOT gated on plan/interview minutes. Adds no new paid API.
 */
import express from 'express';
import { requireAuth }      from './auth.js';
import { transcribeAudio }  from './planGuide.js';

export const druckLeiterRouter = express.Router();

// Parse the rung's barbs from the query (JSON-encoded array, or a repeated/array param). Best-effort:
// anything unparseable → no barbs (we simply strip nothing). Never throws.
function parseBarbs(raw) {
  try {
    if (Array.isArray(raw)) return raw.filter((b) => typeof b === 'string');
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((b) => typeof b === 'string');
    }
  } catch { /* fall through */ }
  return [];
}

// Remove the boss's barbs from the transcript (case-insensitive, literal). They're the interviewer's,
// not the learner's, so they must not earn — or cost — the learner anything.
function stripBarbs(text, barbs) {
  let out = String(text || '');
  for (const b of barbs) {
    const t = String(b).trim();
    if (t.length < 2) continue;
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

// CREDIT-ONLY de-escalation detection. Each move is a POSITIVE signal; absence proves nothing (STT may
// have missed it), so absence is never scored against the learner.
function detectMoves(cleaned) {
  const acknowledged   = /verstehe|tut mir leid|nachvollziehen|ärger|verständlich/i.test(cleaned);
  const offeredSolution = /kümmere|für sie|lösung|sofort|prüfe|kläre|schlage vor/i.test(cleaned);
  // Formal register held: uses Sie/Ihnen (kept case-sensitive — the formal pronoun is capitalised) AND
  // no informal "du"-slip. If we see neither pronoun we simply don't credit it (never a penalty).
  const usedFormal = /\bSie\b/.test(cleaned) || /\bIhnen\b/.test(cleaned);
  const duSlip     = /\bdu\b/i.test(cleaned) || /\bdich\b/i.test(cleaned) || /\bdein/i.test(cleaned);
  const stayedSie  = usedFormal && !duSlip;
  // No insult thrown back at the boss. Default TRUE (professional) — only flips off on a clear insult.
  const noInsult = !/\b(idiot|idioten|blöd|bl(ö|oe)dmann|dumm|dumme|halt(?:'s| die)? klappe|halts? maul|arschloch|arschl(ö|oe)cher|verpiss|scheisse|scheiße|spinnst|spinner|depp|trottel)\b/i.test(cleaned);
  return { acknowledged, offeredSolution, stayedSie, noInsult };
}

druckLeiterRouter.post('/druck-leiter/score',
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '15mb' }),
  requireAuth,
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const barbs = parseBarbs(req.query.barbs);
      const audio = req.body;

      // Absence of audio is NOT a failure — the taught KONTER phrase stands. Return a neutral,
      // teach-only result the client can show as "Standgehalten" + the pro phrase.
      if (!Buffer.isBuffer(audio) || audio.length < 1000) {
        return res.json({ transcript: '', souveraen: false,
          moves: { acknowledged: false, offeredSolution: false, stayedSie: false, noInsult: true },
          tip: teachTip(false) });
      }

      const transcript = (await transcribeAudio(audio, { mime: req.headers['content-type'] || 'audio/wav' })).trim();
      const cleaned = stripBarbs(transcript, barbs);

      // Empty transcript → STT heard nothing usable. NEVER fail on that: teach and move on.
      if (!cleaned) {
        return res.json({ transcript, souveraen: false,
          moves: { acknowledged: false, offeredSolution: false, stayedSie: false, noInsult: true },
          tip: teachTip(false) });
      }

      const moves = detectMoves(cleaned);
      // "Souverän" = at least ONE real de-escalation move positively detected.
      const souveraen = moves.acknowledged || moves.offeredSolution || moves.stayedSie;

      console.log(`[druck-leiter] user=${req.account.id} souveraen=${souveraen} ack=${moves.acknowledged} sol=${moves.offeredSolution} sie=${moves.stayedSie}`);
      return res.json({ transcript, souveraen, moves, tip: teachTip(souveraen) });
    } catch (err) {
      console.error('[druck-leiter] score error:', err.message);
      const noKey = err.message === 'no_api_key';
      // On any failure the client degrades gracefully to its voiced-time verdict (see PressureLadder).
      return res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'druck_leiter_failed' });
    }
  });

// Learner-facing German (LanguageTool-clean). On absence we TEACH the pro sequence — we never claim the
// learner failed a move the STT may simply have dropped.
function teachTip(souveraen) {
  return souveraen
    ? 'Souverän: Du hast den Kunden ernst genommen und bist ruhig bei der Sache geblieben. Bau als Nächstes immer eine konkrete Zusage ein.'
    : 'Merke die Profi-Reihenfolge: erst den Ärger anerkennen, dann EINE konkrete Lösung nennen — und dabei durchgehend in der Sie-Form bleiben.';
}
