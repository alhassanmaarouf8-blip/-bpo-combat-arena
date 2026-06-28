/**
 * spokenReview.js — "SAG ES RICHTIG": spoken-production spaced repetition (PAID).
 *
 * THE highest-evidence lever for spoken German: take the learner's OWN real errors (already
 * captured in their SRS by the interview debrief) and make them SAY the correction OUT LOUD,
 * spaced over time, until it's automatic. This is pushed spoken output of their personal
 * weaknesses — what an elite tutor does, but at unlimited volume and zero social cost. Every
 * rep compounds in one direction: their mouth producing correct German under light pressure.
 *
 * HOW (zero new service): the learner speaks; Groq Whisper transcribes; grading is
 * DETERMINISTIC and TARGETED — for a grammar item we only check that the SPECIFIC corrected
 * token (example.rightWord) is present in what they said, so STT noise elsewhere can't
 * false-fail them. Bias is toward NOT wrongly telling a learner they're wrong (the doctrine).
 * Each result advances the existing SRS schedule (srs.grade). No LLM judgement anywhere.
 *
 *   GET  /api/spoken-review            → { items:[{id, type, prompt, wrong, rule}] }  (due items, paid)
 *   POST /api/spoken-review/grade      → raw audio + ?id= → { correct, expected, heard }
 */
import express from 'express';
import { requireAuth, planOf } from './auth.js';
import { loadUser, saveUser }  from './store.js';
import { dueItems, grade, normalize } from './srs.js';
import { voicedDurationMs }            from './audioGuard.js';

export const spokenReviewRouter = express.Router();

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const STT_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';

function paidOnly(req, res) {
  if (planOf(req.account) === 'free') { res.status(402).json({ error: 'plan_required', reason: 'spoken_review_is_paid' }); return false; }
  return true;
}

// Lowercased, letters/digits-only token stream — used for all spoken comparisons.
function tokenize(s) {
  return normalize(s).toLowerCase().replace(/[^a-z0-9äöüß\s]/gi, ' ').split(/\s+/).filter(Boolean);
}

// Deterministic spoken grading. Targeted + lenient-positive.
//  - grammar (has example.rightWord): correct if the corrected token/phrase is present.
//  - phrase/vocab: correct if ≥70% of the answer's content words were produced.
function gradeSpoken(item, transcript) {
  const saidTokens = tokenize(transcript);
  if (!saidTokens.length) return { correct: false, expected: item.example?.right || item.answer };
  const saidPadded = ` ${saidTokens.join(' ')} `;

  const ex = item.example;
  if (item.type === 'grammar' && ex && ex.rightWord) {
    const targetTokens = tokenize(ex.rightWord);
    const expected = ex.right || item.answer;
    if (!targetTokens.length) return { correct: false, expected };
    const correct = saidPadded.includes(` ${targetTokens.join(' ')} `);
    return { correct, expected };
  }

  // phrase / vocab / anything else: content-word overlap against the target German.
  const want = tokenize(item.answer).filter((w) => w.length > 2);
  const expected = item.answer;
  if (!want.length) return { correct: saidPadded.includes(` ${tokenize(item.answer).join(' ')} `), expected };
  const saidSet = new Set(saidTokens);
  const hit = want.filter((w) => saidSet.has(w)).length;
  return { correct: hit / want.length >= 0.7, expected };
}

async function transcribeGroq(buffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('no_api_key');
  const ext = (String(mimeType).split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mimeType }), `rep.${ext}`);
  fd.append('model', STT_MODEL);
  fd.append('language', 'de');
  fd.append('response_format', 'text');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Groq STT ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return (await res.text()).trim();
  } finally { clearTimeout(timer); }
}

// GET due items as SPOKEN tasks. Answers stay server-side; the learner sees the task + (for
// grammar) their own wrong sentence to fix out loud.
spokenReviewRouter.get('/spoken-review', requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  res.set('Cache-Control', 'no-store');   // fresh due items every open
  try {
    const p = await loadUser(req.account.id);
    const due = dueItems(p, Date.now(), 8);
    const items = due.map((i) => ({
      id:     i.id,
      type:   i.type,
      rule:   i.content,
      prompt: i.type === 'grammar' ? 'Sag den Satz KORREKT laut.' : (i.prompt || 'Sag es auf Deutsch.'),
      wrong:  i.type === 'grammar' ? (i.example?.wrong || '') : '',   // their own sentence to fix
    }));
    res.json({ items });
  } catch (e) {
    console.error('[spokenReview] load error:', e.message);
    res.json({ items: [] });
  }
});

// POST a spoken attempt → deterministic grade → advance the SRS schedule.
spokenReviewRouter.post('/spoken-review/grade',
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '15mb' }),
  requireAuth,
  async (req, res) => {
    if (!paidOnly(req, res)) return;
    res.set('Cache-Control', 'no-store');
    try {
      const id = String(req.query.id || '');
      const audio = req.body;
      if (!id) return res.status(400).json({ error: 'missing_id' });
      if (!Buffer.isBuffer(audio) || audio.length < 1000) return res.status(400).json({ error: 'empty_audio' });

      const p = await loadUser(req.account.id);
      const item = (p.srs || []).find((i) => i.id === id);
      if (!item) return res.status(404).json({ error: 'item_not_found' });

      // HONEST GATE: no real voiced speech → retry, never score a Whisper hallucination of silence.
      if (voicedDurationMs(audio) < 600) return res.json({ retry: true, noSpeech: true });

      const transcript = (await transcribeGroq(audio, req.headers['content-type'] || 'audio/wav')).trim();
      if (!transcript) return res.json({ retry: true, noSpeech: true });

      const { correct, expected } = gradeSpoken(item, transcript);
      grade(p, id, correct);                  // advance/reset the spaced schedule
      // Permanent no-return: a correct answer in SAG ES RICHTIG is mastered forever.
      if (correct) {
        const it = (p.srs || []).find((i) => i.id === id);
        if (it) { it.mastered = true; it.due = Number.MAX_SAFE_INTEGER; }
      }
      await saveUser(p);

      console.log(`[spokenReview] user=${req.account.id} id=${id} type=${item.type} correct=${correct} heard="${transcript.slice(0, 50)}"`);
      res.json({ correct, expected, heard: transcript });
    } catch (err) {
      console.error('[spokenReview] grade error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'spoken_review_failed' });
    }
  });
