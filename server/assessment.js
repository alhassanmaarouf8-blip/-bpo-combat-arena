/**
 * assessment.js — the FREE intelligent level assessment (the conversion hook).
 *
 * COST: this flow NEVER opens a Realtime voice session. It only makes CHEAP calls:
 *   - gpt-4o-mini-transcribe  (one per recorded answer)  → speech-to-text
 *   - gpt-4o-mini             (ONE per assessment)        → analysis of all transcripts
 * A Realtime session may only ever open for a real paid fight (elsewhere).
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
import { requireAuth, planOf }  from './auth.js';
import { transcribeAudio }    from './planGuide.js';
import { FREE_ASSESSMENTS }   from './plans.config.js';

export const assessmentRouter = express.Router();

const ANALYSIS_MODEL = process.env.OAI_PLAN_MODEL ?? 'gpt-4o-mini';
const OAI_CHAT       = 'https://api.openai.com/v1/chat/completions';

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
Call-Center / BPO). Du bekommst die TRANSKRIPTE von 5 gesprochenen Antworten EINES Kandidaten
(per Sprache aufgenommen und automatisch transkribiert — kleine Transkriptionsfehler ignorieren).
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
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '15mb' }),
  requireAuth,
  async (req, res) => {
    try {
      const p = await loadUser(req.account.id);
      if (!canStartAssessment(p, req.account)) return res.status(403).json({ error: 'assessment_used' });

      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length < 1000) return res.status(400).json({ error: 'empty_audio' });

      const transcript = await transcribeAudio(audio, { mime: req.headers['content-type'] || 'audio/wav' });
      res.json({ transcript });
    } catch (err) {
      console.error('[assessment] transcribe error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'transcribe_failed' });
    }
  });

// ── POST analyze all answers (ONE cheap text-model call). Sets assessmentUsed=true. ──
assessmentRouter.post('/assessment/analyze', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    // Idempotent: if already used, return the stored verdict (never re-charge / re-run).
    if (!canStartAssessment(p, req.account) && p.assessmentResult) return res.json({ result: p.assessmentResult, alreadyUsed: true });

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const clean = answers
      .map((a) => ({ q: String(a?.q || '').slice(0, 300), transcript: String(a?.transcript || '').slice(0, 2000).trim() }))
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
  }
});

// ── ONE gpt-4o-mini call analyzing all transcripts together ──────────────────────
async function analyze(answers) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no_api_key');
  console.log(`[ai] ${ANALYSIS_MODEL} · assessment analysis (${answers.length} answers)`); // cost audit

  const userMsg = answers
    .map((a, i) => `Frage ${i + 1}: ${a.q}\nGesprochene Antwort (Transkript): ${a.transcript}`)
    .join('\n\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(OAI_CHAT, {
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
    return normalizeResult(JSON.parse(data.choices?.[0]?.message?.content ?? '{}'));
  } finally {
    clearTimeout(timer);
  }
}

// Shape-guard the model output so the client always gets a valid, bounded verdict.
function normalizeResult(d) {
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const arr = (x) => (Array.isArray(x) ? x : []);
  const s = (x, n) => String(x ?? '').slice(0, n);

  const blockers = arr(d.blockers).slice(0, 5).map((b) => ({
    rule:                          s(b?.rule, 90),
    explanation_de:                s(b?.explanation_de, 320),
    explanation_ar:                s(b?.explanation_ar, 320),
    example_from_their_own_answer: s(b?.example_from_their_own_answer, 320),
  })).filter((b) => b.rule && b.example_from_their_own_answer);

  const strengths = arr(d.strengths).slice(0, 2)
    .map((x) => ({ de: s(x?.de ?? x, 220), ar: s(x?.ar, 220) }))
    .filter((x) => x.de);

  return {
    estimatedLevel:   LEVELS.includes(d.estimatedLevel) ? d.estimatedLevel : 'A2',
    confidence:       ['low', 'medium', 'high'].includes(d.confidence) ? d.confidence : 'low',
    blockers,
    strengths,
    recommendedFocus: { de: s(d.recommendedFocus?.de, 240), ar: s(d.recommendedFocus?.ar, 240) },
  };
}
