/**
 * exerciseGenerator.js — Phase 4: the live-generated, personal exercise set for ONE bottleneck.
 *
 * One structured LLM call (provider failover, schema-validated, retried) that turns the selected
 * bottleneck + the learner's OWN faulty sentences into a 3-stage transfer ladder:
 *
 *   Stage 1 · ERKENNEN            — spot-the-correct-version pairs built from their utterances
 *   Stage 2 · KONTROLLIERT SAGEN  — say the corrected version out loud (SAG-ES-RICHTIG mechanic)
 *   Stage 3 · TRANSFER            — a micro interview question engineered so a good answer MUST
 *                                   use the target structure, answered aloud under countdown
 *
 * Nothing textbook: the prompt forbids generic items — every item must reference the learner's
 * sentences, interview content, or BPO job context. Reps/minutes are computed IN CODE (never the
 * model's numbers). On total failure the caller uses fallbackSet() — Stage-2-only drills from the
 * stored corrected sentences — so the personal step is never empty.
 *
 * Repeat days: `exerciseHistory` (all previously generated item texts for this bottleneck) goes
 * into the prompt with a hard do-not-reuse instruction, and a canonical-overlap guard drops any
 * item the model reused anyway.
 */
import { chatWithFailover } from './llmFailover.js';
import { CATEGORIES } from './scoring/errorTaxonomy.js';
import { scrubStringsDeep } from './langGuard.js';

const GEN_MODEL  = process.env.GROQ_EXERCISE_MODEL ?? 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 45_000;
const RETRIES    = 2;

const _canon = (s) => String(s ?? '').normalize('NFC').toLowerCase()
  .replace(/["'„“”‚‘»«]+/g, '').replace(/\s+/g, ' ').trim();

// Reps + timing are PRESCRIPTION, decided by code: the learner sees count + the why.
export const STAGE1_REPS = 1;
export const STAGE2_REPS = 3;
export const STAGE3_REPS = 1;
export const STAGE3_COUNTDOWN_S = 45;

const SYSTEM_PROMPT =
`Du bist ein Elite-Sprachtrainer für ägyptische BPO-Bewerber (Deutsch, Vorstellungsgespräch
Kundenservice). Du baust einen PERSÖNLICHEN Übungsblock für GENAU EINE Schwäche des Kandidaten —
aus seinen ECHTEN Sätzen aus dem heutigen Interview. NICHTS davon darf wie ein Lehrbuch wirken.

Gib AUSSCHLIESSLICH gültiges JSON in GENAU diesem Schema zurück:
{
  "title_de": "die Schwäche in einfachen Worten (3-6 Wörter DEUTSCH)",
  "title_ar": "dasselbe auf ÄGYPTISCH-ARABISCH",
  "stage1": [
    { "faulty": "ein FALSCHER Satz — aus den echten Sätzen des Kandidaten oder eine enge Variante davon (gleiches Thema: seine Bewerbung, seine Firma, sein Kunde)",
      "corrected": "derselbe Satz KORREKT",
      "why_de": "EIN Satz DEUTSCH: warum die korrekte Form richtig ist",
      "why_ar": "dasselbe auf ÄGYPTISCH-ARABISCH" }
  ],
  "stage2": [
    { "instruction_de": "kurze Anweisung DEUTSCH (z.B. 'Sag den Satz KORREKT — aus dem Gedächtnis')",
      "instruction_ar": "dasselbe auf ÄGYPTISCH-ARABISCH",
      "prompt": "der fehlerhafte Ausgangssatz (aus Kandidaten-Material)",
      "target": "der korrekte Satz, den er laut sagen soll",
      "why_de": "EIN Satz: warum LAUT sprechen hier zählt",
      "why_ar": "dasselbe auf ÄGYPTISCH-ARABISCH" }
  ],
  "stage3": [
    { "frage": "EINE Mini-Interviewfrage, so gebaut, dass eine gute Antwort die Zielstruktur ERZWINGT (Bezug: seine Bewerbung/BPO-Alltag)",
      "must_use_de": "was die Antwort strukturell zeigen muss (DEUTSCH, eine Zeile)",
      "must_use_ar": "dasselbe auf ÄGYPTISCH-ARABISCH",
      "indicator_tokens": ["2-6 deutsche Wörter/Formen, deren Vorkommen zeigt, dass die Zielstruktur benutzt wurde"],
      "why_de": "EIN Satz: warum diese Frage den Transfer in ein echtes Interview trainiert",
      "why_ar": "dasselbe auf ÄGYPTISCH-ARABISCH" }
  ]
}

HARTE REGELN:
- GENAU 4-5 stage1-Items, GENAU 3 stage2-Items, GENAU 1-2 stage3-Items.
- JEDES Item muss sich auf die echten Sätze, das Interview-Thema oder den BPO-Job des Kandidaten
  beziehen. VERBOTEN: Lehrbuchsätze über Hans, das Wetter, die Schule, den Urlaub.
- stage1: "faulty" und "corrected" MÜSSEN sich unterscheiden; der Fehler MUSS die eine Ziel-Schwäche
  sein, nicht irgendein anderer.
- stage2: mindestens 2 der 3 Items bauen DIREKT auf den mitgelieferten echten Fehlersätzen auf;
  das dritte darf eine Transformation sein (z.B. anderes Subjekt, andere Zeit), die dieselbe
  Struktur erzwingt.
- stage3: die Frage darf die Zielstruktur NICHT nennen — sie muss sie erzwingen (verdeckter Test).
  "indicator_tokens" sind konkrete Formen (z.B. konjugierte Verben, Endungen tragende Wörter), die
  in einer korrekten Antwort natürlich vorkommen.
- ARABISCH-STIL (alle _ar-Felder): ECHTES ägyptisches Umgangsarabisch (عامية مصرية), wie ein
  Trainer in Kairo — NICHT Hocharabisch: „علشان" statt „لأنّ"، „اللي" statt „الذي"، „عايز" statt
  „تريد"، „كده" statt „هكذا". Deutsche Sätze und Zielwörter bleiben IMMER Deutsch.
- Niveau des Kandidaten beachten: die Items müssen auf SEINEM Niveau lösbar sein.`;

// ── Validation: shape + anti-textbook grounding + novelty vs history ──────────────────────────
export function validateExerciseSet(parsed, { evidence = [], exerciseHistory = [] } = {}) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => String(x ?? '').trim();
  if (!parsed || typeof parsed !== 'object') return null;
  const seen = new Set((exerciseHistory || []).map(_canon));
  const fresh = (t) => t && !seen.has(_canon(t));

  const stage1 = arr(parsed.stage1).map((i) => ({
    faulty: str(i?.faulty), corrected: str(i?.corrected),
    why_de: str(i?.why_de), why_ar: str(i?.why_ar),
  })).filter((i) => i.faulty && i.corrected && _canon(i.faulty) !== _canon(i.corrected)
    && fresh(i.faulty)).slice(0, 5);

  const stage2 = arr(parsed.stage2).map((i) => ({
    instruction_de: str(i?.instruction_de) || 'Sag den Satz KORREKT — laut.',
    instruction_ar: str(i?.instruction_ar),
    prompt: str(i?.prompt), target: str(i?.target),
    why_de: str(i?.why_de), why_ar: str(i?.why_ar),
  })).filter((i) => i.target && _canon(i.prompt) !== _canon(i.target)
    && fresh(i.target)).slice(0, 3);

  const stage3 = arr(parsed.stage3).map((i) => ({
    frage: str(i?.frage), must_use_de: str(i?.must_use_de), must_use_ar: str(i?.must_use_ar),
    indicator_tokens: arr(i?.indicator_tokens).map(str).filter((t) => t.length >= 2).slice(0, 6),
    why_de: str(i?.why_de), why_ar: str(i?.why_ar),
  })).filter((i) => i.frage && i.indicator_tokens.length >= 1 && fresh(i.frage)).slice(0, 2);

  if (stage1.length < 3 || stage2.length < 2 || stage3.length < 1) return null;

  // Grounding meter (anti-textbook): at least ONE item must visibly build on the learner's own
  // material. Quotes are short; canonical containment either way counts.
  const quotes = (evidence || []).flatMap((q) => [q.quote, q.corrected]).filter(Boolean).map(_canon);
  const texts = [...stage1.flatMap((i) => [i.faulty, i.corrected]), ...stage2.flatMap((i) => [i.prompt, i.target])].map(_canon);
  const grounded = quotes.some((q) => q.length >= 8 && texts.some((t) => t.includes(q) || q.includes(t)));

  return {
    title_de: str(parsed.title_de), title_ar: str(parsed.title_ar),
    stage1: stage1.map((i, n) => ({ id: `s1-${n}`, ...i, reps: STAGE1_REPS })),
    stage2: stage2.map((i, n) => ({ id: `s2-${n}`, ...i, reps: STAGE2_REPS })),
    stage3: stage3.map((i, n) => ({ id: `s3-${n}`, ...i, reps: STAGE3_REPS, countdownS: STAGE3_COUNTDOWN_S })),
    grounded,
  };
}

/** Deterministic prescription math — shown to the learner per item and as a total. */
export function computePlan(set) {
  const totalReps = set.stage1.length * STAGE1_REPS + set.stage2.length * STAGE2_REPS + set.stage3.length * STAGE3_REPS;
  const estMinutes = Math.max(3, Math.round(
    set.stage1.length * 0.4 + set.stage2.length * STAGE2_REPS * 0.5 + set.stage3.length * 1.5));
  return { totalReps, estMinutes };
}

/** Flatten a set to the compact strings that go into exerciseHistory (novelty on repeat days). */
export function historyEntries(set) {
  return [
    ...set.stage1.map((i) => i.faulty),
    ...set.stage2.map((i) => i.target),
    ...set.stage3.map((i) => i.frage),
  ].filter(Boolean).slice(0, 30);
}

export async function generateExerciseSet({ bottleneck, evidence = [], level = 'b2',
  exerciseHistory = [], sessionId }) {
  const label = CATEGORIES[bottleneck.category]?.de || bottleneck.category;
  const evidenceBlock = (evidence || []).slice(0, 5)
    .map((q, i) => `${i + 1}. FALSCH: "${q.quote}"${q.corrected ? `  KORREKT: "${q.corrected}"` : ''}`)
    .join('\n') || '(keine wörtlichen Zitate — nutze das BPO-Interview-Szenario)';
  const historyBlock = (exerciseHistory || []).length
    ? `\nBEREITS VERWENDETE ÜBUNGEN (VERBOTEN — nutze KEINE dieser Formate, Blickwinkel oder Sätze wieder; baue völlig NEUE Items):\n` +
      exerciseHistory.slice(-30).map((t) => `- ${t}`).join('\n') + '\n'
    : '';

  const userMsg =
    `ZIEL-SCHWÄCHE: ${label} — ${bottleneck.subcode?.replace(/_/g, ' ')}\n` +
    `WARUM GEWÄHLT: ${bottleneck.why || '-'}\n` +
    `NIVEAU: ${level}\nKONTEXT: BPO-/Kundenservice-Vorstellungsgespräch\n\n` +
    `ECHTE SÄTZE DES KANDIDATEN (heutiges Interview):\n${evidenceBlock}\n` +
    historyBlock +
    `\nBaue jetzt den Übungsblock als JSON.`;

  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const { content, usage, provider } = await chatWithFailover({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
        temperature: attempt === 0 ? 0.4 : 0.7,   // retry with more variety (novelty guard may have starved the set)
        maxTokens: 2600, timeoutMs: TIMEOUT_MS, groqModel: GEN_MODEL, tag: 'exerciseGen',
      });
      const parsed = scrubStringsDeep(JSON.parse(content || '{}'));
      const set = validateExerciseSet(parsed, { evidence, exerciseHistory });
      if (!set) throw new Error('schema_invalid_or_stale');
      const plan = computePlan(set);
      console.log(`[exerciseGen] set ok  session=${sessionId ?? '?'}  s1=${set.stage1.length} s2=${set.stage2.length} s3=${set.stage3.length}  grounded=${set.grounded}  reps=${plan.totalReps}  ~${plan.estMinutes}min  provider=${provider}  tokens=${usage?.prompt_tokens ?? '?'}in/${usage?.completion_tokens ?? '?'}out`);
      return { set: { ...set, ...plan }, usage: { provider, promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null } };
    } catch (err) {
      lastErr = err;
      console.error(`[exerciseGen] attempt ${attempt + 1}/${RETRIES + 1} failed  session=${sessionId ?? '?'}: ${err.message}`);
    }
  }
  throw lastErr ?? new Error('exercise_generation_failed');
}

// ── Fallback: Stage-2-only drills straight from the stored corrected sentences. Deterministic,
// $0, never empty — the personal step degrades to "say your own corrections aloud", which is
// still the highest-evidence drill in the app (SAG-ES-RICHTIG doctrine). ──────────────────────
export function fallbackSet({ bottleneck, evidence = [] }) {
  const label = CATEGORIES[bottleneck.category]?.de || bottleneck.category;
  const stage2 = (evidence || []).filter((q) => q.quote && q.corrected).slice(0, 4)
    .map((q, n) => ({
      id: `s2-${n}`,
      instruction_de: 'Sag den Satz KORREKT — laut und aus dem Gedächtnis.',
      instruction_ar: '',   /* OWNER-AR slot */
      prompt: q.quote, target: q.corrected,
      why_de: 'Laut sprechen verankert die korrekte Form im Sprechfluss — genau da, wo das Interview sie braucht.',
      why_ar: '',           /* OWNER-AR slot */
      reps: STAGE2_REPS,
    }));
  if (!stage2.length) return null;   // no corrected sentences stored → caller keeps status 'failed'
  const set = { title_de: label, title_ar: '', stage1: [], stage2, stage3: [], grounded: true, fallback: true };
  return { ...set, ...computePlan(set) };
}

export default { generateExerciseSet, validateExerciseSet, computePlan, historyEntries, fallbackSet };
