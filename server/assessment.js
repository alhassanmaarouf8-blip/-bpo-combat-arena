/**
 * assessment.js — the FREE intelligent level assessment (the conversion hook).
 *
 * COST: this flow NEVER opens a Realtime voice session. It only makes cheap Groq calls:
 *   - Groq Whisper (whisper-large-v3, one per recorded answer)  → speech-to-text
 *   - Groq llama-3.3-70b       (ONE per assessment)             → analysis of all transcripts
 * 100% Groq — no OpenAI. A Realtime session may only ever open for a real paid fight (elsewhere).
 *
 * Server is the single source of truth: the one-per-account limit (assessmentUsed) and the
 * stored verdict (assessmentResult) live on the user profile and are enforced here — UI
 * hiding is never the gate.
 *
 *   GET  /api/assessment/status      → { used, result, limit }
 *   POST /api/assessment/transcribe  → { transcript }   (raw WAV body; blocked once used)
 *   POST /api/assessment/analyze     → { result }        (sets assessmentUsed=true)
 */
import express from 'express';
import { loadUser, saveUser } from './store.js';
import { requireAuth, planOf, rateLimit }  from './auth.js';
import { transcribeAudio }    from './planGuide.js';
import { isSpeakableRule, buildGrammarForBenchmark } from './grammarCheck.js';
import { computeDials }       from './skillDials.mjs';
import { FREE_ASSESSMENTS }   from './plans.config.js';
import { voicedDurationMs }   from './audioGuard.js';
import { scrubStringsDeep }   from './langGuard.js';
import { planNext }           from './assessmentRamp.mjs';

export const assessmentRouter = express.Router();

// ── POST next-question: deterministic adaptive routing (v2 Phase 1) ──────────────
// DARK until ASSESSMENT_ADAPTIVE=1 (ship-dark law: the client isn't wired yet; flipping the flag
// without the client changes nothing a user sees). Stateless by design: the full answer list is
// replayed on every call, so the same answers always yield the same next question (idempotent,
// no session state to corrupt). Routing only — the verdict stays with /assessment/analyze.
assessmentRouter.post('/assessment/next-question', requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 120, tag: 'assessment-next-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 40, tag: 'assessment-next-account',
              keyExtra: (req) => req.account.id, accountOnly: true }), async (req, res) => {
  if (process.env.ASSESSMENT_ADAPTIVE !== '1') return res.status(404).json({ error: 'not_enabled' });
  try {
    const p = await loadUser(req.account.id);
    if (!canStartAssessment(p, req.account)) return res.status(403).json({ error: 'assessment_used' });

    const answers = (Array.isArray(req.body?.answers) ? req.body.answers : []).slice(0, 12)
      .map((a) => ({ qid: Number(a?.qid), transcript: String(a?.transcript || '').slice(0, 2000),
        durationMs: Math.max(0, Number(a?.durationMs) || 0), inputMode: a?.inputMode === 'voice' ? 'voice' : 'typed' }));

    let plan;
    try { plan = planNext(answers); }
    catch { return res.status(400).json({ error: 'bad_answers' }); }

    // Minimal surface: the client needs the question and the stop signal — never the internal
    // routing measurements (numbers that reach a UI become "scores"; these must not).
    res.json({ done: plan.done, reason: plan.done ? plan.reason : null, asked: plan.trace.length,
      question: plan.next ? { id: plan.next.id, band: plan.next.band, de: plan.next.de, ar: plan.next.ar } : null });
  } catch (err) {
    console.error('[assessment] next-question error:', err.message);
    res.status(500).json({ error: 'next_question_failed' });
  }
});

const ANALYSIS_MODEL = process.env.GROQ_PLAN_MODEL ?? 'llama-3.3-70b-versatile';
const GROQ_CHAT      = 'https://api.groq.com/openai/v1/chat/completions';
const analysisInFlight = new Set();

// Re-assessment: an ACTIVE PAID plan gets a fresh assessment roughly every month (this is the
// Elite "monatliche Neu-Einstufung"); a free account keeps one-per-account-ever. planOf() already
// reverts an expired plan to free, so an expired user can't re-assess.
// (Owner order 2026-07-25 settled the money model as run-free / pay-for-results, so the assessment
// is NOT blocked at the door — the gate that matters is the interview verdict.)
const REASSESS_DAYS = 28;
function canStartAssessment(profile, account) {
  if (!profile.assessmentUsed) return true;                 // never taken → allowed
  if (planOf(account) === 'free') return false;             // free: one ever
  const at = profile.assessmentResult?.at || 0;             // paid: monthly
  return (Date.now() - at) >= REASSESS_DAYS * 24 * 60 * 60 * 1000;
}

const SYSTEM_PROMPT =
`Du bist ein erfahrener, fairer Deutsch-Prüfer für ägyptische Bewerber (Zielmarkt: deutsche
Call-Center / BPO). Du bekommst bis zu 7 Antworten EINES Kandidaten. Jede Antwort ist ehrlich als
GESPROCHENES TRANSKRIPT oder GETIPPTER TEXT markiert (kleine Transkriptionsfehler ignorieren).
Schätze sein Deutsch-Niveau EHRLICH und konkret ein.

Gib AUSSCHLIESSLICH gültiges JSON in GENAU diesem Schema zurück:
{
  "estimatedLevel": "A1|A2|B1|B2|C1",
  "confidence": "low|medium|high",
  "blockers": [
    { "rule": "kurzer, konkreter Regelname auf DEUTSCH (z.B. 'Verbstellung im Nebensatz')",
      "explanation_de": "EIN kurzer Satz auf Deutsch: was schiefläuft",
      "explanation_ar": "derselbe Satz auf EINFACHEM, ägyptenfreundlichem Arabisch",
      "example_from_their_own_answer": "ein WÖRTLICHES Zitat aus einer echten Antwort des Kandidaten, das den Fehler zeigt" }
  ],
  "strengths": [ { "de": "echte, belegbare Stärke", "ar": "نفس النقطة بالعربي المصري البسيط" } ],
  "recommendedFocus": { "de": "die EINE Sache, die er zuerst üben sollte", "ar": "نفس الكلام بالعربي المصري" }
}

HARTE REGELN:
- estimatedLevel: ehrliche CEFR-Schätzung NUR aus dem, was er WIRKLICH produziert hat. Im Zweifel konservativ.
- Beurteile KEINE Aussprache, Stimme, Sprechgeschwindigkeit oder mündliche Flüssigkeit: du erhältst nur Text.
- Dies ist ein GESPROCHENER Trainer. NIEMALS Rechtschreibung, Zeichensetzung/Kommasetzung oder
  Groß-/Kleinschreibung als blocker oder recommendedFocus nennen — das kann man beim Sprechen nicht
  hören und stammt oft nur aus dem Transkript. Nur GESPROCHENE Fehler (Grammatik, Wortstellung,
  Wortschatz, Verständlichkeit).
- confidence: 'low' wenn die Antworten sehr kurz oder sehr wenige sind; sonst 'medium' oder 'high'.
- blockers: NUR so viele, wie durch die Antworten WIRKLICH belegt sind — die WICHTIGSTEN zuerst.
  Bei sehr kurzem oder dünnem Input (confidence 'low') nur 0 bis 2, NIEMALS eine Schwäche erfinden,
  um eine Zahl zu erreichen. Lieber WENIGE, echte Blocker als viele erfundene. JEDER blocker MUSS ein
  "example_from_their_own_answer" enthalten, das WÖRTLICH aus seinen Antworten stammt. Findest du kein
  echtes Beispiel, lass den blocker WEG. Bei sehr wenig Input: sei ermutigend, nicht kategorisch
  vernichtend ("noch wenig Datenbasis"), statt harte Urteile wie "kann sich nicht vorstellen".
- explanation_ar, strengths[].ar und recommendedFocus.ar: einfaches, modernes, ägyptenfreundliches
  Arabisch (KEIN steifes Hocharabisch).
- strengths: 1 bis 2, echt und belegbar (nichts erfinden — lieber eine echte als zwei erfundene).
- recommendedFocus: die EINE wichtigste Sache zum Anfangen — konkret, nicht allgemein.
- Erfinde NICHTS. Beziehe dich nur auf das, was der Kandidat gesagt hat. Antworte NUR mit dem JSON.`;

// ── GET status: has this account used its one free assessment? + the stored verdict ──
assessmentRouter.get('/assessment/status', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    const eligible = canStartAssessment(p, req.account);
    // requiresPlan: a free account that has SPENT its one assessment is routed to the plan screen
    // instead of an intro that would end in a 403 after it already recorded answers.
    res.json({ used: !eligible, result: p.assessmentResult || null, limit: FREE_ASSESSMENTS,
      canReassess: eligible && !!p.assessmentUsed,
      requiresPlan: !eligible && !p.assessmentResult && planOf(req.account) === 'free' });
  } catch (err) {
    console.error('[assessment] status error:', err.message);
    res.status(500).json({ error: 'status_failed' });
  }
});

// ── POST transcribe one answer (cheap STT). Blocked once the account has used its free run. ──
assessmentRouter.post('/assessment/transcribe',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 120, tag: 'assessment-transcribe-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 12, tag: 'assessment-transcribe-account',
              keyExtra: (req) => req.account.id, accountOnly: true }),
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '4mb' }),
  async (req, res) => {
    try {
      const p = await loadUser(req.account.id);
      if (!canStartAssessment(p, req.account)) return res.status(403).json({ error: 'assessment_used' });

      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length < 1000) return res.status(400).json({ error: 'empty_audio' });
      // HONEST GATE: no real voiced speech → empty transcript, never a hallucinated assessment answer.
      if (voicedDurationMs(audio) < 600) return res.json({ transcript: '', noSpeech: true });

      const transcript = await transcribeAudio(audio, { mime: req.headers['content-type'] || 'audio/wav' });
      res.json({ transcript });
    } catch (err) {
      console.error('[assessment] transcribe error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'transcribe_failed' });
    }
  });

// ── POST analyze all answers (ONE cheap text-model call). Sets assessmentUsed=true. ──
assessmentRouter.post('/assessment/analyze', requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 80, tag: 'assessment-analyze-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 4, tag: 'assessment-analyze-account',
              keyExtra: (req) => req.account.id, accountOnly: true }), async (req, res) => {
  if (analysisInFlight.has(req.account.id)) return res.status(409).json({ error: 'assessment_in_progress' });
  analysisInFlight.add(req.account.id);
  try {
    const p = await loadUser(req.account.id);
    // Idempotent: if already used, return the stored verdict (never re-charge / re-run).
    if (!canStartAssessment(p, req.account) && p.assessmentResult) return res.json({ result: p.assessmentResult, alreadyUsed: true });

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const clean = answers
      .map((a) => ({ q: String(a?.q || '').slice(0, 300), transcript: String(a?.transcript || '').slice(0, 2000).trim(),
        inputMode: a?.inputMode === 'voice' ? 'voice' : 'typed',
        qid: Number.isInteger(a?.qid) ? a.qid : undefined,
        durationMs: Math.max(0, Number(a?.durationMs) || 0) }))
      .filter((a) => a.transcript);
    if (clean.length < 1) return res.status(400).json({ error: 'no_answers' });

    const result = await analyze(clean);

    // 6-dial profile (v2 Phase 1): deterministic, evidence-floored, computed from the answers —
    // the LLM never touches a dial. Grammar count comes from LanguageTool UNCAPPED (a density
    // needs every verified error, not the 6-rule display cap); LT down → dial honestly unmeasured.
    let grammarErrors = null;
    try {
      const groups = await buildGrammarForBenchmark(clean.map((a) => ({ text: a.transcript })));
      grammarErrors = groups.reduce((s, g) => s + (g.count || 0), 0);
    } catch (err) {
      console.error('[assessment] dials grammar count unavailable:', err.message);
    }
    const dials = computeDials({ answers: clean, grammarErrors });

    p.assessmentUsed   = true;
    p.assessmentResult = { ...result, dials, at: Date.now() };
    await saveUser(p);

    res.json({ result: p.assessmentResult });
  } catch (err) {
    console.error('[assessment] analyze error:', err.message);
    const noKey = err.message === 'no_api_key';
    res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'analyze_failed' });
  } finally {
    analysisInFlight.delete(req.account.id);
  }
});

// ── ONE Groq llama-3.3-70b call analyzing all transcripts together ───────────────
async function analyze(answers) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('no_api_key');
  console.log(`[ai] ${ANALYSIS_MODEL} · assessment analysis (${answers.length} answers)`); // cost audit

  const userMsg = answers
    .map((a, i) => `Frage ${i + 1}: ${a.q}\n${a.inputMode === 'voice' ? 'Gesprochene Antwort (Transkript)' : 'Getippte Antwort'}: ${a.transcript}`)
    .join('\n\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(GROQ_CHAT, {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:           ANALYSIS_MODEL,
        temperature:     0.2,
        max_tokens:      1100,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
      }),
    });
    if (!res.ok) throw new Error(`assessment model ${res.status} ${await res.text().catch(() => '')}`);
    const data = await res.json();
    // scrubStringsDeep: strip script-drift glyphs (the "兄" class) from every string field —
    // the Einstufung verdict is one-of-a-kind text with nothing curated to fall back to.
    return normalizeResult(scrubStringsDeep(JSON.parse(data.choices?.[0]?.message?.content ?? '{}')), answers);
  } finally {
    clearTimeout(timer);
  }
}

// Shape-guard the model output so the client always gets a valid, bounded verdict.
// `answers` (the real transcripts) are passed so we can verify any "their own words" quote.
function normalizeResult(d, answers = []) {
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const arr = (x) => (Array.isArray(x) ? x : []);
  const s = (x, n) => String(x ?? '').slice(0, n);
  const canon = (x) => String(x ?? '').replace(/\s+/g, ' ').toLowerCase().trim();
  const saidCanon = canon(answers.map((a) => a?.transcript || '').join(' '));
  // Evidence volume: how much the candidate ACTUALLY produced. A few short sentences cannot honestly
  // support five categorical weaknesses — that's the "appearance of accuracy" the doctrine forbids.
  const evidenceWords = saidCanon ? saidCanon.split(' ').filter(Boolean).length : 0;

  const hasTyped = answers.some((a) => a?.inputMode !== 'voice');
  const confidence = hasTyped && d.confidence === 'high' ? 'medium'
    : (['low', 'medium', 'high'].includes(d.confidence) ? d.confidence : 'low');
  // Thin evidence = low confidence OR very little speech. On thin evidence a harsh categorical
  // blocker with no VERIFIED own-words quote is fabrication, so we require the quote and cap the count.
  const thin = confidence === 'low' || evidenceWords < 40;

  let blockers = arr(d.blockers).slice(0, 5).map((b) => {
    const ex = s(b?.example_from_their_own_answer, 320);
    // Anti-fabrication: keep the "their own words" quote ONLY if it actually appears in a
    // transcript. Otherwise blank it (keep the rule) — never show a paraphrased/invented quote.
    const verifiedEx = ex && saidCanon.includes(canon(ex)) ? ex : '';
    return {
      rule:                          s(b?.rule, 90),
      explanation_de:                s(b?.explanation_de, 320),
      explanation_ar:                s(b?.explanation_ar, 320),
      example_from_their_own_answer: verifiedEx,
    };
  // Deterministic guard (prompts don't stop fabrication): drop any blocker whose rule is a
  // punctuation/casing/spelling artifact — a speaker cannot produce a comma, and this verdict is
  // spoken aloud by Salma. Sibling of the SRS/grammar filters; foot-gun #17 + class B.
  }).filter((b) => b.rule && isSpeakableRule(b.rule) && isSpeakableRule(b.explanation_de));
  // On thin evidence: keep ONLY blockers backed by a verified own-words quote, and at most 2.
  // Better to name one real weakness (or none) than to invent five to fill a quota — honest-when-thin.
  if (thin) blockers = blockers.filter((b) => b.example_from_their_own_answer).slice(0, 2);

  const strengths = arr(d.strengths).slice(0, 2)
    .map((x) => ({ de: s(x?.de ?? x, 220), ar: s(x?.ar, 220) }))
    .filter((x) => x.de);

  return {
    estimatedLevel:   LEVELS.includes(d.estimatedLevel) ? d.estimatedLevel : 'A2',
    confidence,
    measured:         { writtenGerman: true, speakingPronunciation: false, containsTypedAnswers: hasTyped, evidenceThin: thin },
    blockers,
    strengths,
    // Salma VOICES recommendedFocus.de — if the model returned an orthography focus (unhearable),
    // drop it rather than have her read "achte auf die Kommasetzung" as the top spoken priority.
    recommendedFocus: isSpeakableRule(d.recommendedFocus?.de)
      ? { de: s(d.recommendedFocus?.de, 240), ar: s(d.recommendedFocus?.ar, 240) }
      : { de: '', ar: '' },
  };
}
