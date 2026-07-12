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
import { FREE_ASSESSMENTS }   from './plans.config.js';
import { voicedDurationMs }   from './audioGuard.js';
import { scrubStringsDeep }   from './langGuard.js';

export const assessmentRouter = express.Router();

const ANALYSIS_MODEL = process.env.GROQ_PLAN_MODEL ?? 'llama-3.3-70b-versatile';
const GROQ_CHAT      = 'https://api.groq.com/openai/v1/chat/completions';
const analysisInFlight = new Set();

// Re-assessment: an ACTIVE PAID plan gets a fresh assessment roughly every month (this is the
// Elite "monatliche Neu-Einstufung"); the free tier stays one-per-account-ever. planOf() already
// reverts an expired plan to free, so an expired user can't re-assess.
const REASSESS_DAYS = 28;
function canStartAssessment(profile, account) {
  if (!profile.assessmentUsed) return true;                 // never taken → allowed
  if (planOf(account) === 'free') return false;             // free: one ever
  const at = profile.assessmentResult?.at || 0;             // paid: monthly
  return (Date.now() - at) >= REASSESS_DAYS * 24 * 60 * 60 * 1000;
}

const SYSTEM_PROMPT =
`Du bist ein erfahrener, fairer Deutsch-Prüfer für ägyptische Bewerber (Zielmarkt: deutsche
Call-Center / BPO). Du bekommst bis zu 5 Antworten EINES Kandidaten. Jede Antwort ist ehrlich als
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
- confidence: 'low' wenn die Antworten sehr kurz oder sehr wenige sind; sonst 'medium' oder 'high'.
- blockers: 3 bis 5 Stück, die WICHTIGSTEN zuerst. JEDER blocker MUSS ein "example_from_their_own_answer"
  enthalten, das WÖRTLICH aus seinen Antworten stammt — NIEMALS erfinden. Findest du kein echtes
  Beispiel für einen Fehler, lass diesen blocker WEG.
- explanation_ar, strengths[].ar und recommendedFocus.ar: einfaches, modernes, ägyptenfreundliches
  Arabisch (KEIN steifes Hocharabisch).
- strengths: GENAU 2, echt und ermutigend.
- recommendedFocus: die EINE wichtigste Sache zum Anfangen — konkret, nicht allgemein.
- Erfinde NICHTS. Beziehe dich nur auf das, was der Kandidat gesagt hat. Antworte NUR mit dem JSON.`;

// ── GET status: has this account used its one free assessment? + the stored verdict ──
assessmentRouter.get('/assessment/status', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    const eligible = canStartAssessment(p, req.account);
    res.json({ used: !eligible, result: p.assessmentResult || null, limit: FREE_ASSESSMENTS, canReassess: eligible && !!p.assessmentUsed });
  } catch (err) {
    console.error('[assessment] status error:', err.message);
    res.status(500).json({ error: 'status_failed' });
  }
});

// ── POST transcribe one answer (cheap STT). Blocked once the account has used its free run. ──
assessmentRouter.post('/assessment/transcribe',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 12, tag: 'assessment-transcribe', keyExtra: (req) => req.account.id }),
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
  rateLimit({ windowMs: 60 * 60 * 1000, max: 4, tag: 'assessment-analyze', keyExtra: (req) => req.account.id }), async (req, res) => {
  if (analysisInFlight.has(req.account.id)) return res.status(409).json({ error: 'assessment_in_progress' });
  analysisInFlight.add(req.account.id);
  try {
    const p = await loadUser(req.account.id);
    // Idempotent: if already used, return the stored verdict (never re-charge / re-run).
    if (!canStartAssessment(p, req.account) && p.assessmentResult) return res.json({ result: p.assessmentResult, alreadyUsed: true });

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const clean = answers
      .map((a) => ({ q: String(a?.q || '').slice(0, 300), transcript: String(a?.transcript || '').slice(0, 2000).trim(),
        inputMode: a?.inputMode === 'voice' ? 'voice' : 'typed' }))
      .filter((a) => a.transcript);
    if (clean.length < 1) return res.status(400).json({ error: 'no_answers' });

    const result = await analyze(clean);

    p.assessmentUsed   = true;
    p.assessmentResult = { ...result, at: Date.now() };
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

  const blockers = arr(d.blockers).slice(0, 5).map((b) => {
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
  }).filter((b) => b.rule);

  const strengths = arr(d.strengths).slice(0, 2)
    .map((x) => ({ de: s(x?.de ?? x, 220), ar: s(x?.ar, 220) }))
    .filter((x) => x.de);

  const hasTyped = answers.some((a) => a?.inputMode !== 'voice');
  return {
    estimatedLevel:   LEVELS.includes(d.estimatedLevel) ? d.estimatedLevel : 'A2',
    confidence:       hasTyped && d.confidence === 'high' ? 'medium'
      : (['low', 'medium', 'high'].includes(d.confidence) ? d.confidence : 'low'),
    measured:         { writtenGerman: true, speakingPronunciation: false, containsTypedAnswers: hasTyped },
    blockers,
    strengths,
    recommendedFocus: { de: s(d.recommendedFocus?.de, 240), ar: s(d.recommendedFocus?.ar, 240) },
  };
}
