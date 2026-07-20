/**
 * deepDiagnosis.js — the Deep Diagnostic Engine (v2 Phase 2, owner order 2026-07-20).
 *
 * ONE structured LLM pass over the ENTIRE interview transcript, after the debrief is already on
 * its way to the learner (this module is never on the debrief's latency path). For EVERY answer:
 * all errors (open two-level taxonomy: fixed category + free-text subcode), 2–3 alternative
 * phrasings, quote-tied strengths. The current failure mode is UNDER-reporting — this pass is
 * asked to be complete — but completeness never overrides truth: every quote must be verbatim,
 * every correction must actually change something, cut-off turns are never blamed for structure,
 * and low-confidence STT words are never quoted back (feedback-accuracy doctrine).
 *
 * Aggregates are computed DETERMINISTICALLY in code from the validated errors — the model is
 * never asked to count (no fabricated metrics). CEFR is stored as an explicit ESTIMATE.
 *
 * Zero new spend: Groq chat completions on the existing key; fails safe (caller queues + retries).
 */

import { looksTruncatedDE, quoteHasLowConfidence } from './scoring/turnQuality.js';
import { ANSWER_LEVEL_CATEGORIES, CATEGORY_IDS, normalizeCategory, normalizeSubcode, errorCode }
  from './scoring/errorTaxonomy.js';
import { scrubStringsDeep } from './langGuard.js';

const DEEP_MODEL    = process.env.GROQ_DEEP_MODEL ?? 'llama-3.3-70b-versatile';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS    = 60_000;
const RETRY_DELAYS  = [0, 2_000, 8_000];   // spec: retry with backoff before queueing

// Same filler semantics as the live meter (websocketManager.js FILLER_RE — duplicated there,
// in scoreFactors.js and elevenDebrief.js by existing convention).
const FILLER_RE = /(?<!\p{L})(?:ähm+|äh+|ehm+|also|halt|irgendwie|quasi|sozusagen)(?!\p{L})/giu;

const _canon = (s) => String(s ?? '').normalize('NFC').toLowerCase()
  .replace(/["'„“”‚‘»«]+/g, '').replace(/\s+/g, ' ').trim();

const SYSTEM_PROMPT =
`Du bist ein extrem gründlicher Deutsch-Diagnostiker für ein BPO-Bewerbungstraining (ägyptische
Lernende, arabische Muttersprache). Du bekommst das VOLLSTÄNDIGE Interview (B = Interviewer,
A1..An = nummerierte Antworten des Kandidaten) und analysierst JEDE Antwort einzeln und vollständig.

Gib AUSSCHLIESSLICH gültiges JSON in GENAU diesem Schema zurück:
{
  "answers": [
    {
      "index": <ganzzahl — die Antwortnummer An>,
      "frage": "die Frage des Interviewers in 3–8 Wörtern (DEUTSCH)",
      "errors": [
        {
          "quote": "WÖRTLICHES Zitat aus GENAU dieser Antwort — exakt die fehlerhaften Wörter, so kurz wie möglich",
          "korrektur": "die korrigierte Version desselben Ausschnitts",
          "kategorie": "GENAU EINE aus: ${CATEGORY_IDS.join(', ')}",
          "subcode": "frei erfundener, präziser snake_case-Untercode, z.B. nach_unbestimmtem_artikel_maskulin_akk",
          "schwere": <1-5: wie gravierend der Fehler sprachlich ist>,
          "verstaendlichkeit": <1-5: 5 = Bedeutung ging verloren, 1 = klingt nur unschön>,
          "erklaerung_de": "EIN kurzer Satz DEUTSCH: was falsch ist und wie die Regel lautet",
          "erklaerung_ar": "GENAU dieselbe Erklärung auf ÄGYPTISCH-ARABISCH"
        }
      ],
      "alternativen": [
        { "text": "eine ANDERE, natürlichere/professionellere Art, DIESELBE Antwort zu formulieren (DEUTSCH, vollständiger Satz)",
          "wann_de": "eine Zeile DEUTSCH: wann diese Variante stark ist (Register, Wirkung im Interview)",
          "wann_ar": "dieselbe Zeile auf ÄGYPTISCH-ARABISCH" }
      ],
      "staerken": [
        { "quote": "WÖRTLICHES Zitat aus dieser Antwort, das gut war",
          "warum_de": "warum das konkret stark war (DEUTSCH)",
          "warum_ar": "dasselbe auf ÄGYPTISCH-ARABISCH" }
      ]
    }
  ],
  "cefr": { "geschaetzt": "A2|B1|B2|C1", "signale_de": "1–2 Sätze DEUTSCH: welche beobachteten Signale diese Schätzung stützen" }
}

HARTE REGELN:
- VOLLSTÄNDIGKEIT: Finde JEDEN echten Fehler, auch kleine (falsche Endung, fehlender Artikel,
  falsche Präposition, Füllwort-Häufung, Neustart-Schleifen wie "ich habe... ich bin... also ich
  habe"). Zu wenige Fehler zu melden ist der aktuelle Hauptmangel dieses Systems. Melde jedes
  Vorkommen einzeln (dieselbe Regel 3× falsch = 3 Einträge, gern mit demselben subcode).
- SYSTEMATISCHE PRÜFUNG pro Antwort: gehe JEDES Satzglied durch — jeden Artikel, jede
  Adjektivendung, den Kasus nach JEDER Präposition, die Verbposition in JEDEM Haupt- und
  Nebensatz, jede Zeitform. Ein einziger Satz kann 3+ verschiedene Fehler enthalten — melde
  jeden einzeln, fasse NIE mehrere reale Vorkommen zu einem Eintrag zusammen.
- WAHRHEIT VOR VOLLSTÄNDIGKEIT: "quote" MUSS wörtlich in der jeweiligen Antwort stehen. Erfinde
  NIE Wörter. Ist ein Satz korrekt, ist er KEIN Fehler — Stil ist kein Fehler. "korrektur" muss
  sich von "quote" unterscheiden, sonst weglassen.
- Der Text ist ein SPRACH-Transkript: Rechtschreibung, Groß/Kleinschreibung und Zeichensetzung
  sind Artefakte der Spracherkennung — NIEMALS als Fehler melden.
- Mit „⟨ABGEBROCHEN⟩" markierte Antworten wurden vom Interviewer unterbrochen: dort NIEMALS
  ANTWORT_STRUKTUR, KOHAERENZ, FLUESSIGKEIT oder SELBSTKORREKTUR_SCHLEIFEN bemängeln — nur
  Fehler INNERHALB der tatsächlich gesprochenen Wörter.
- "alternativen" sind PFLICHT für jede substanzielle Antwort (ab ca. 6 Wörtern): GENAU 2 oder 3
  wirklich VERSCHIEDENE Formulierungen derselben Aussage — keine Korrekturen, sondern bessere
  Varianten (natürlicher, professioneller, stärker im Interview), jede mit "wann"-Zeile.
  EINE einzelne Alternative ist UNGÜLTIG — liefere immer mindestens 2, sonst ist die ganze
  Ausgabe unbrauchbar. Nur bei sehr kurzen Antworten (unter 6 Wörtern): leere Liste.
- "staerken": nur echte, zitierbare Stärken (z.B. Verb korrekt am Ende nach "weil", gutes
  Konnektoren-Gerüst, höfliche Deeskalation). Keine leere Schmeichelei.
- ARABISCH-STIL (verbindlich für alle _ar-Felder): ECHTES ägyptisches Umgangsarabisch (عامية
  مصرية), wie ein Trainer in Kairo redet — NICHT Hocharabisch. Kurz, direkt, freundlich:
  „علشان" statt „لأنّ"، „اللي" statt „الذي"، „عايز" statt „تريد"، „كده" statt „هكذا". Deutsche
  Zielwörter und die Zitate bleiben IMMER auf Deutsch.
- "cefr.geschaetzt" ist eine grobe SCHÄTZUNG aus dieser einen Sitzung — wähle konservativ.`;

// ── Transcript formatting: numbered candidate answers the model can reference ──────────────────
export function numberedTranscript(dialogue = [], utterances = []) {
  const turns = Array.isArray(dialogue) && dialogue.length
    ? dialogue
    : (utterances || []).map((u) => ({ role: 'candidate', text: u.text }));
  const candidateTurns = [];
  let out = '';
  for (const t of turns) {
    const txt = String(t?.text || '').trim();
    if (!txt) continue;
    if (t.role === 'boss') { out += `B: ${txt}\n`; continue; }
    candidateTurns.push(txt);
    const cut = looksTruncatedDE(txt) ? '  ⟨ABGEBROCHEN — vom Interviewer unterbrochen⟩' : '';
    out += `A${candidateTurns.length}: ${txt}${cut}\n`;
  }
  return { transcript: out.trim(), candidateTurns };
}

// ── Validation: shape-guard + anti-fabrication gates. Pure → unit-testable. ────────────────────
export function validateDeepAnalysis(parsed, { candidateTurns = [], lowConfSet = new Set() } = {}) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => String(x ?? '').trim();
  const clamp15 = (x, dflt = 2) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : dflt; };
  if (!parsed || !Array.isArray(parsed.answers)) return null;   // hard shape failure → retry

  const canonTurns = candidateTurns.map(_canon);
  let dropped = 0;

  const answers = arr(parsed.answers).slice(0, 12).map((a) => {
    const index = Math.round(Number(a?.index));
    if (!Number.isFinite(index) || index < 1 || index > candidateTurns.length) { dropped += arr(a?.errors).length; return null; }
    const original  = candidateTurns[index - 1];
    const truncated = looksTruncatedDE(original);
    const canonTurn = canonTurns[index - 1];

    const errors = arr(a.errors).slice(0, 12).map((e) => {
      const quote = str(e?.quote), korrektur = str(e?.korrektur);
      const kategorie = normalizeCategory(e?.kategorie);
      if (!quote || !korrektur || !kategorie) { dropped++; return null; }
      // Answer-level judgments need a real quote too, but their real gate is truncation (below).
      const inThisTurn = canonTurn.includes(_canon(quote));
      const inAnyTurn  = inThisTurn || canonTurns.some((t) => t.includes(_canon(quote)));
      if (!inAnyTurn) { dropped++; return null; }                         // fabricated quote
      if (_canon(quote) === _canon(korrektur)) { dropped++; return null; } // non-correction
      if (truncated && ANSWER_LEVEL_CATEGORIES.has(kategorie)) { dropped++; return null; }
      if (lowConfSet.size && quoteHasLowConfidence(quote, lowConfSet)) { dropped++; return null; }
      const subcode = normalizeSubcode(e?.subcode);
      return {
        quote, korrektur, kategorie, subcode, code: errorCode(kategorie, subcode),
        schwere: clamp15(e?.schwere), verstaendlichkeit: clamp15(e?.verstaendlichkeit),
        erklaerung_de: str(e?.erklaerung_de), erklaerung_ar: str(e?.erklaerung_ar),
      };
    }).filter(Boolean);

    const alternativen = arr(a.alternativen).slice(0, 3).map((v) => {
      const text = str(v?.text);
      if (!text || _canon(text) === _canon(original)) return null;
      return { text, wann_de: str(v?.wann_de), wann_ar: str(v?.wann_ar) };
    }).filter(Boolean);

    const staerken = arr(a.staerken).slice(0, 3).map((s) => {
      const quote = str(s?.quote);
      if (!quote || !canonTurns.some((t) => t.includes(_canon(quote)))) return null;
      if (lowConfSet.size && quoteHasLowConfidence(quote, lowConfSet)) return null;
      return { quote, warum_de: str(s?.warum_de), warum_ar: str(s?.warum_ar) };
    }).filter(Boolean);

    return { index, frage: str(a?.frage), original, truncated, errors, alternativen, staerken };
  }).filter(Boolean);

  const cefrRaw = str(parsed?.cefr?.geschaetzt).toUpperCase();
  const cefr = ['A2', 'B1', 'B2', 'C1'].includes(cefrRaw)
    ? { geschaetzt: cefrRaw, signale_de: str(parsed?.cefr?.signale_de), estimate: true }
    : null;

  return { answers, cefr, dropped };
}

// ── Aggregates: counted in CODE from validated errors — never by the model ─────────────────────
export function computeAggregates(validated, utterances = []) {
  const byCategory = {}, byCode = {};
  let totalErrors = 0, severitySum = 0;
  for (const a of validated.answers) {
    for (const e of a.errors) {
      totalErrors++;
      severitySum += e.schwere;
      byCategory[e.kategorie] = (byCategory[e.kategorie] || 0) + 1;
      byCode[e.code] = (byCode[e.code] || 0) + 1;
    }
  }
  const allText = (utterances || []).map((u) => u?.text || '').join(' ');
  return {
    totalErrors,
    byCategory,
    byCode,
    meanSeverity: totalErrors ? +(severitySum / totalErrors).toFixed(2) : 0,
    fillerCount: (allText.match(FILLER_RE) ?? []).length,
    selfCorrectionLoops: byCategory.SELBSTKORREKTUR_SCHLEIFEN || 0,
    answersAnalyzed: validated.answers.length,
    cefrEstimate: validated.cefr,   // explicit estimate, single session — never a certificate
  };
}

// ── The one full-transcript analysis call (retry-with-backoff inside; throws when exhausted) ───
export async function generateDeepAnalysis({ dialogue, utterances, metrics, level, csScenarioId, sessionId }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('no_groq_key');
  const { transcript, candidateTurns } = numberedTranscript(dialogue, utterances);
  if (!candidateTurns.length) throw new Error('no_candidate_turns');
  const lowConfSet = new Set((utterances || []).flatMap((u) => u?.lowConf || []));

  const userMsg =
    `Niveau: ${level}\nRollenspiel-Szenario: ${csScenarioId ?? 'unbekannt'}\n` +
    `Objektive Metriken (Kontext, nicht neu erfinden): ${JSON.stringify(metrics ?? {})}\n\n` +
    `DAS VOLLSTÄNDIGE GESPRÄCH:\n${transcript}\n\n` +
    `Analysiere jetzt JEDE Antwort A1..A${candidateTurns.length} vollständig als JSON.`;

  // A substantive answer with fewer than 2 alternatives misses the spec's mandate. Such an
  // attempt is kept as fallback (never discarded — its errors are real) but retried once for a
  // fuller pass; the BEST attempt (fewest thin answers, then most errors found) is returned.
  const thinCount = (v) => v.answers.filter((a) =>
    !a.truncated && (a.original || '').split(/\s+/).length >= 6 && a.alternativen.length < 2).length;

  let lastErr = null, best = null;
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (RETRY_DELAYS[attempt]) await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ];
      if (best && thinCount(best.validated) > 0) {
        messages.push({ role: 'user', content:
          'Deine letzte Analyse hatte bei mehreren substanziellen Antworten weniger als 2 "alternativen". ' +
          'Wiederhole die KOMPLETTE Analyse als JSON und liefere für JEDE substanzielle Antwort GENAU 2–3 Alternativen mit "wann"-Zeilen.' });
      }
      const res = await fetch(GROQ_CHAT_URL, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({
          model: DEEP_MODEL, temperature: 0.2, max_tokens: 7500,
          response_format: { type: 'json_object' },
          messages,
        }),
      });
      if (!res.ok) throw new Error(`deep API ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
      const data   = await res.json();
      const txt    = data.choices?.[0]?.message?.content ?? '{}';
      const parsed = scrubStringsDeep(JSON.parse(txt));
      const validated = validateDeepAnalysis(parsed, { candidateTurns, lowConfSet });
      if (!validated) throw new Error('schema_invalid');
      const aggregates = computeAggregates(validated, utterances);
      const usage = {
        model: DEEP_MODEL,
        promptTokens:     data.usage?.prompt_tokens     ?? null,
        completionTokens: data.usage?.completion_tokens ?? null,
      };
      const candidate = { validated, aggregates, usage };
      if (!best || thinCount(validated) < thinCount(best.validated)
        || (thinCount(validated) === thinCount(best.validated) && aggregates.totalErrors > best.aggregates.totalErrors)) {
        best = candidate;
      }
      // Token cost per analysis, always visible in the logs (spec §5).
      console.log(`[deepDiagnosis] attempt ${attempt + 1} ok  session=${sessionId ?? '?'}  answers=${validated.answers.length}  errors=${aggregates.totalErrors}  thinAlt=${thinCount(validated)}  dropped=${validated.dropped}  tokens=${usage.promptTokens ?? '?'}in/${usage.completionTokens ?? '?'}out  model=${DEEP_MODEL}`);
      if (thinCount(best.validated) === 0) return best;
    } catch (err) {
      lastErr = err;
      console.error(`[deepDiagnosis] attempt ${attempt + 1}/${RETRY_DELAYS.length} failed  session=${sessionId ?? '?'}: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (best) return best;
  throw lastErr ?? new Error('deep_analysis_failed');
}

export default { generateDeepAnalysis, validateDeepAnalysis, computeAggregates, numberedTranscript };
