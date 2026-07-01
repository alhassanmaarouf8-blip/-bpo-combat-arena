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
import { requireAuth, planOf, drillsUnlocked } from './auth.js';
import { loadUser, saveUser }  from './store.js';
import { dueItems, grade, normalize } from './srs.js';
import { voicedDurationMs }            from './audioGuard.js';

export const spokenReviewRouter = express.Router();

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const STT_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';

function paidOnly(req, res) {
  if (!drillsUnlocked(req.account)) { res.status(402).json({ error: 'plan_required', reason: 'spoken_review_is_paid' }); return false; }
  return true;
}

// Lowercased, letters/digits-only token stream — used for all spoken comparisons.
function tokenize(s) {
  return normalize(s).toLowerCase().replace(/[^a-z0-9äöüß\s]/gi, ' ').split(/\s+/).filter(Boolean);
}

// Generic Levenshtein — works on strings (char-level) OR token arrays (word-level), since both
// index with [] and compare with ===. (srs.js has one too, but it isn't exported; this is local.)
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur  = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Does the contiguous target token sequence appear in what was said, tolerating a SINGLE STT edit
// per token (dem/den, Jahre/Jahren are exactly what Whisper mis-hears)? Order + adjacency are kept
// (so a word-order fix must still be produced in the right order); 1–2 char tokens must match
// exactly. CRUCIAL honesty guard: the 1-edit tolerance never accepts a token that IS the stored
// WRONG word — otherwise, when the correction itself is a 1-char ending (Jahr→Jahre, den→dem),
// re-uttering the original error would be mis-credited as a fix. We only absorb STT noise, not the mistake.
function fuzzyTokenMatch(saidTokens, targetTokens, wrongSet) {
  const n = targetTokens.length;
  if (!n || saidTokens.length < n) return false;
  for (let i = 0; i + n <= saidTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const said = saidTokens[i + j], want = targetTokens[j];
      if (said === want) continue;
      if (want.length >= 3 && editDistance(said, want) <= 1 && !wrongSet.has(said)) continue;
      ok = false; break;
    }
    if (ok) return true;
  }
  return false;
}

// Near-duplicate of the learner's OWN wrong sentence: they reproduced the error (e.g. slipped the
// right word INTO the old wrong sentence) instead of genuinely repairing it. Word-level distance:
// if the utterance is at least as close to the WRONG sentence as to the CORRECT one, it hasn't moved
// toward the fix. A genuine correct answer is distance-0 from the correct sentence and ≥1 from the
// wrong one, so it is never flagged — this only ever catches a false-pass, never a real fix.
function isNearDuplicateOfWrong(saidTokens, wrong, right) {
  const wrongTokens = tokenize(wrong || '');
  const rightTokens = tokenize(right || '');
  if (!wrongTokens.length || !rightTokens.length) return false;
  if (editDistance(wrongTokens, rightTokens) === 0) return false;   // wrong≡right (shouldn't happen) → don't punish
  return editDistance(saidTokens, rightTokens) >= editDistance(saidTokens, wrongTokens);
}

// GRAVITY-FIRST ORDERING. A learner must fix the sentence's SKELETON before its polish: GLOBAL
// errors (word/verb order, a dropped copula/verb, a missing article/determiner) distort meaning and
// are drilled BEFORE LOCAL ones (article-gender / adjective case endings). The weight is derived
// from the item's own LanguageTool-authored rule name / error tag (item.content) plus its fragments
// — no model guessing. Unknown → middle, so it never jumps ahead of a clearly global item.
const GRAVITY_GLOBAL = /wortstellung|verbstellung|satzstellung|wortreihenfolge|verbposition|verbzweit|verb.?second|inversion|word.?order|satzbau|nebensatz|fehlend|fehlt|missing|kopula|hilfsverb/i;
const GRAVITY_LOCAL  = /endung|deklination|kongruenz|agreement|adjektiv|kasus|\bgenus\b|artikelform|flexion/i;

function gravityRank(item) {
  if (item?.type !== 'grammar') return 2;   // phrases/vocab: neutral middle, keep their due order
  const ex  = item.example || {};
  const tag = `${item.content || ''} ${ex.wrongFragment || ''} ${ex.rightFragment || ''}`.toLowerCase();
  if (GRAVITY_GLOBAL.test(tag)) return 3;   // skeleton first
  if (GRAVITY_LOCAL.test(tag))  return 1;   // polish last
  return 2;                                 // unknown → middle
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

    // ERROR-REPAIR-AWARE GRADING (deterministic; grammar itself stays LanguageTool-authored):
    // (a) EXACT corrected token present → it's a fix ONLY if the utterance isn't a near-duplicate of
    //     their stored WRONG sentence (slipping the right word into the old wrong sentence
    //     doesn't false-pass). (b) Otherwise tolerate a 1-edit STT variant of the target token
    //     (dem/den, Jahre/Jahren) — and since the token itself is then STT-uncertain, we do NOT
    //     apply the near-duplicate guard, so Whisper noise can never FALSE-FAIL a real rep.
    if (saidPadded.includes(` ${targetTokens.join(' ')} `)) {
      if (isNearDuplicateOfWrong(saidTokens, ex.wrong, expected)) return { correct: false, expected };
      return { correct: true, expected };
    }
    const wrongSet = new Set(tokenize(ex.wrongWord || ''));   // never let STT-tolerance credit the actual error token
    if (fuzzyTokenMatch(saidTokens, targetTokens, wrongSet)) return { correct: true, expected };
    return { correct: false, expected };
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
    // GRAVITY-FIRST: pull the full due set, re-order so GLOBAL (skeleton) errors come before LOCAL
    // (polish) ones, then take the session's 8. Stable sort keeps dueItems' due-ascending order
    // within each gravity tier, so the existing "oldest-due first" behavior is preserved as the tiebreak.
    const due = dueItems(p, Date.now(), 50)
      .sort((a, b) => gravityRank(b) - gravityRank(a) || (a.due - b.due))
      .slice(0, 8);
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
      await saveUser(p);

      console.log(`[spokenReview] user=${req.account.id} id=${id} type=${item.type} correct=${correct} heard="${transcript.slice(0, 50)}"`);
      res.json({ correct, expected, heard: transcript });
    } catch (err) {
      console.error('[spokenReview] grade error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'spoken_review_failed' });
    }
  });
