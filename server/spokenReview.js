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
import { requireAuth, planOf, drillsUnlocked, rateLimit } from './auth.js';
import { loadUser, saveUser }  from './store.js';
import { dueItems, grade, normalize } from './srs.js';
import { voicedDurationMs }            from './audioGuard.js';
import { classifyGrammar }             from './errorTags.js';
import { coachCueForDrill, prescriptionDoseProgress, recordDrillOutcome, salmaCoachEventId,
  salmaCoachFlags, syncSalmaCoach } from './salmaCoachCore.js';

export const spokenReviewRouter = express.Router();

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const STT_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';

// Stage variants of the drill-prescription doctrine (docs/drill-prescription-doctrine.md):
// 'find' = Stage A NOTICE (finde-den-fehler): the rule chip is withheld so the learner must FIND
// the error in their own sentence before repairing it aloud (K3 elicit, Schmidt noticing).
// 'tempo' = Stage C AUTOMATIZE (sag-es-richtig-tempo): the client enforces a short countdown, so
// a pass is structurally a within-time production; the grading gate itself is unchanged.
// The mode names the drill id recorded on the weakLog spine, which is exactly how the series
// state machine (brain/drillSeries.mjs) counts stage completions.
const MODE_DRILL = Object.freeze({ find: 'finde-den-fehler', tempo: 'sag-es-richtig-tempo' });
const modeOf = (req) => (Object.hasOwn(MODE_DRILL, String(req.query.mode || '')) ? String(req.query.mode) : null);

function canonicalSkillForItem(item) {
  if (item?.type !== 'grammar' || !item.content) return null;
  return classifyGrammar([{ rule: item.content, count: 1 }])[0] ?? null;
}

function hasUsableSpokenRepair(item) {
  if (item?.type !== 'grammar' || typeof item.id !== 'string' || !item.id.trim()) return false;
  const wrong = typeof item.example?.wrong === 'string' ? item.example.wrong.trim() : '';
  const right = typeof item.example?.right === 'string' ? item.example.right.trim()
    : (typeof item.answer === 'string' ? item.answer.trim() : '');
  return !!wrong && !!right;
}

function publicSpokenItem(item, prescribed = false) {
  const grammar = item.type === 'grammar';
  return { id: item.id, type: item.type, prescribed,
    rule: grammar ? item.content : '',
    prompt: grammar ? 'Sag den Satz KORREKT laut.' : (item.prompt || ''),
    wrong: grammar ? (item.example?.wrong || '') : '' };
}

// A rule label is not a speakable exercise. Without both the exact error and a trustworthy
// correction, "Wortstellung — say it correctly" is impossible to execute. Fail closed.
export function usableSpokenReviewItem(item) {
  if (item?.type === 'grammar') return hasUsableSpokenRepair(item);
  return typeof item?.answer === 'string' && item.answer.trim().length > 0
    && typeof item?.prompt === 'string' && item.prompt.trim().length > 0;
}

export function targetedSpokenReviewQueue(profile, coachState, accountId) {
  const active = coachState?.activePrescription?.drillId === 'sag-es-richtig'
    ? coachState.activePrescription : null;
  if (!active) return null;
  const progress = prescriptionDoseProgress(coachState);
  if (progress?.completed) return { items: [], prescription: { targeted: true,
    missingTarget: false, completed: true, remainingRepetitions: 0, repairsRemaining: 0 } };
  // Once a dose starts, its exact cards remain available until the dose is complete even when
  // the first correct production advances or masters the separate long-term SRS schedule.
  const matching = (profile?.srs || []).filter((item) => hasUsableSpokenRepair(item)
    && canonicalSkillForItem(item) === active.skillId)
    .sort((a, b) => (a.due || 0) - (b.due || 0));
  if (!matching.length) return { items: [], prescription: { targeted: true, missingTarget: true,
    completed: false, remainingRepetitions: progress?.remainingRepetitions || active.repetitions,
    repairsRemaining: progress?.repairsRemaining || 0 } };
  const currentBlock = coachState.coachState.repeatedErrorCounts[active.id]?.blockProgress
    ?.[progress?.completedBlocks || 0];
  const repairQueue = [];
  for (const item of matching) {
    const taskHash = salmaCoachEventId({ accountId, itemId: item.id,
      itemType: item.type, skillId: active.skillId });
    const repairs = currentBlock?.repairDebt?.[taskHash]?.remaining || 0;
    for (let index = 0; index < repairs; index += 1) repairQueue.push(item);
  }
  const requested = Math.max(1, Math.min(8, progress?.remainingRepetitions || active.repetitions));
  const queue = repairQueue.slice(0, requested);
  for (let index = queue.length; index < requested; index += 1) {
    queue.push(matching[(index - repairQueue.length) % matching.length]);
  }
  return { items: queue.map((item) => publicSpokenItem(item, true)),
    prescription: { targeted: true, missingTarget: false, completed: progress?.completed === true,
      remainingRepetitions: progress?.remainingRepetitions || requested,
      repairsRemaining: progress?.repairsRemaining || 0 } };
}

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
export function gradeSpoken(item, transcript) {
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
  const allWant = tokenize(item.answer);
  const want = allWant.filter((w) => w.length > 2);
  const expected = item.answer;
  if (!want.length) return { correct: saidPadded.includes(` ${tokenize(item.answer).join(' ')} `), expected };
  const saidSet = new Set(saidTokens);
  const hit = want.filter((w) => saidSet.has(w)).length;
  const coverage = hit / want.length;
  // A correct fragment embedded in unrelated speech is not a correct production. This gate also
  // blocks the real-world false pass where a long English recording happened to contain the target
  // near its end. Keep a small allowance for Whisper splitting/duplicating short German tokens.
  const maximumTokens = Math.max(allWant.length + 4, Math.ceil(allWant.length * 1.45));
  if (saidTokens.length > maximumTokens) return { correct: false, expected, reason: 'contaminated_or_excess_speech' };
  // Meaning reversals must never pass on lexical overlap ("tut mir NICHT leid").
  const negationCount = (tokens) => tokens.filter((token) => token === 'nicht' || /^kein(?:e|en|em|er|es)?$/u.test(token)).length;
  if (negationCount(allWant) !== negationCount(saidTokens)) {
    return { correct: false, expected, reason: 'meaning_reversal' };
  }
  return { correct: coverage >= 0.8, expected };
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

    // Stage A (finde-den-fehler): grammar items ONLY (there is no error to find in a phrase task),
    // the prescribed rule's items first, and NO rule chip — the learner does the noticing.
    if (modeOf(req) === 'find') {
      const targetRule = String(req.query.rule || '');
      const onTarget = (i) => (targetRule && canonicalSkillForItem(i) === targetRule ? 1 : 0);
      const items = dueItems(p, Date.now(), 50)
        .filter((i) => i.type === 'grammar' && usableSpokenReviewItem(i))
        .sort((a, b) => onTarget(b) - onTarget(a) || gravityRank(b) - gravityRank(a) || (a.due - b.due))
        .slice(0, 8)
        .map((i) => ({ id: i.id, type: i.type, rule: '',
          prompt: 'In diesem Satz steckt ein Fehler. Finde ihn und sag den Satz KORREKT laut.',
          wrong: i.example?.wrong || '' }));
      return res.json({ items });
    }

    const coachEnabled = salmaCoachFlags(process.env, req.account).enabled;
    const coachState = coachEnabled ? syncSalmaCoach(p).state : null;
    // GRAVITY-FIRST: pull the full due set, re-order so GLOBAL (skeleton) errors come before LOCAL
    // (polish) ones, then take the session's 8. Stable sort keeps dueItems' due-ascending order
    // within each gravity tier, so the existing "oldest-due first" behavior is preserved as the tiebreak.
    const due = dueItems(p, Date.now(), 50)
      .filter(usableSpokenReviewItem)
      .sort((a, b) => gravityRank(b) - gravityRank(a) || (a.due - b.due))
      .slice(0, 8);
    const targeted = targetedSpokenReviewQueue(p, coachState, req.account.id);
    if (targeted) {
      await saveUser(p);
      return res.json(targeted);
    }
    const items = due.map((i) => {
      const grammar = i.type === 'grammar';
      return {
        id:     i.id,
        type:   i.type,
        // Grammar: i.content is the LanguageTool RULE label (safe to show as the tiny chip).
        // Phrase/vocab: i.content IS the German answer (seedBPOPhrases stores content = p.de) —
        // NEVER send it, or the blue chip leaks exactly what the learner must produce out loud.
        // (This file's header promises "answers stay server-side"; it was silently false for
        // phrase items until now, which trapped learners into reading the answer / the English.)
        rule:   grammar ? i.content : '',
        // Grammar: fixed instruction. Phrase/vocab: the ENGLISH meaning (i.prompt = p.en) — a
        // MEANING to render into German, NOT a line to read aloud (Whisper is pinned to de, so
        // reading the English gets mis-transcribed and false-failed).
        prompt: grammar ? 'Sag den Satz KORREKT laut.' : (i.prompt || ''),
        wrong:  grammar ? (i.example?.wrong || '') : '',   // their own sentence to fix
      };
    });
    res.json({ items });
  } catch (e) {
    console.error('[spokenReview] load error:', e.message);
    res.json({ items: [] });
  }
});

// POST a spoken attempt → deterministic grade → advance the SRS schedule.
spokenReviewRouter.post('/spoken-review/grade',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, tag: 'spoken-review', keyExtra: (req) => req.account.id }),
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '4mb' }),
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
      const mode = modeOf(req);
      const coachEnabled = salmaCoachFlags(process.env, req.account).enabled;
      const { state: coachState } = coachEnabled ? syncSalmaCoach(p) : { state: null };
      const active = coachState?.activePrescription;
      const canonicalSkillId = canonicalSkillForItem(item);
      // A stage-variant rep (find/tempo) belongs to the series ladder, never to a plain
      // sag-es-richtig coach dose — crediting it there would mis-count the dose.
      const isPrescribedCard = !mode && active?.drillId === 'sag-es-richtig' && hasUsableSpokenRepair(item)
        && canonicalSkillId === active.skillId;
      // One coaching dose may repeat the same sentence for automaticity, but it must not fast-forward
      // the long-term spaced schedule eight times in one sitting.
      if (!isPrescribedCard || item.lastCoachPrescriptionId !== active.id) {
        grade(p, id, correct);
        if (isPrescribedCard) item.lastCoachPrescriptionId = active.id;
      }

      // Feed the brain (doctrine D3): the brain's prescribed grammar drill reported NOTHING before,
      // so the drilled→re-tested→improved loop could never close for it. Grammar items land on the
      // same canonical weakLog spine the interview writes (classifyGrammar), so on-target prep and
      // the aha can actually fire; non-grammar items go to the general drillLog. Server-side and
      // atomic with the SRS save — no extra request, nothing for the client to forget.
      const ev = { at: Date.now(), drill: mode ? MODE_DRILL[mode] : 'sag-es-richtig', correct };
      if (item.type === 'grammar' && item.content) {
        const canon = canonicalSkillId;
        const key = canon || ('lt:' + item.content);
        p.weakLog = p.weakLog || {};
        const entry = p.weakLog[key] || { ruleId: canon, ltName: item.content, firstSeen: Date.now(), errCounts: [], drills: [] };
        entry.drills.push(ev);
        if (entry.drills.length > 50) entry.drills = entry.drills.slice(-50);
        p.weakLog[key] = entry;
      } else {
        p.drillLog = (p.drillLog || []).concat(ev).slice(-100);
      }
      let coachCue = null;
      let prescriptionProgress = null;
      if (coachEnabled) {
        const verifiedCoachEvent = active?.drillId === ev.drill && canonicalSkillId === active.skillId
          ? { ...ev, verified: true, verifiedAt: ev.at, prescriptionId: active.id,
            skillId: canonicalSkillId, phase: 'practice',
            taskHash: salmaCoachEventId({ accountId: req.account.id, itemId: id,
              itemType: item.type, skillId: canonicalSkillId }) }
          : ev;
        p.salmaCoach = recordDrillOutcome(coachState, verifiedCoachEvent, ev.at);
        const progress = active?.drillId === 'sag-es-richtig' ? prescriptionDoseProgress(p.salmaCoach) : null;
        if (progress) prescriptionProgress = { targeted: true, credited: isPrescribedCard,
          completed: progress.completed, remainingRepetitions: progress.remainingRepetitions,
          repairsRemaining: progress.repairsRemaining };
        const eventId = salmaCoachEventId({ accountId: req.account.id, itemId: id, ...ev });
        coachCue = coachCueForDrill({ drill: ev.drill, correct, eventId });
      }
      await saveUser(p);

      console.log(`[spokenReview] user=${req.account.id} id=${id} type=${item.type} correct=${correct} transcriptChars=${transcript.length}`);
      res.json({ correct, expected, heard: transcript, ...(coachCue ? { coachCue } : {}),
        ...(prescriptionProgress ? { prescriptionProgress } : {}) });
    } catch (err) {
      console.error('[spokenReview] grade error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'spoken_review_failed' });
    }
  });
