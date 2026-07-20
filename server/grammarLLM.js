/**
 * grammarLLM.js — L2-aware German grammar checker (owner 2026-07-05: "LanguageTool's accuracy is 0
 * for my learners — do whatever"). LanguageTool is built for native typos and is BLIND to the
 * systematic Arabic-L1 → German errors this app exists to fix (verb-final, case, aux haben/sein,
 * gender, adjective endings). This uses a strong German-capable model (Groq, already $0) to catch
 * those — but under HARD accuracy guards so it can never tell a learner something false:
 *
 *   1. QUOTE GATE (doctrine law 3): every flagged `wrong` MUST be a verbatim substring of what the
 *      learner actually said — else it is dropped. The model can never fabricate words.
 *   2. NO-CHANGE GATE: if the "correction" equals the original (canonicalized), it is not an error.
 *   3. TRUNCATION GATE (law 7): cut-off fragments are removed before checking — never graded.
 *   4. CONSERVATIVE PROMPT: "when in doubt, do NOT flag" — precision over recall, because a false
 *      "you're wrong" is as unacceptable as a miss.
 *   5. FAIL-SAFE: any error → return null so coach.js falls back; the debrief is never broken.
 *
 * Returns the SAME shape as grammarCheck.buildGrammar so coach.js can use it interchangeably:
 *   [{ rule, explanation, explanation_ar, ltRuleId, ltCategoryId, examples:[{wrong, right, fragment...}] }]
 */
import { looksTruncatedDE, looksLikeTrustworthyCorrection } from './scoring/turnQuality.js';
import { chatWithFailover } from './llmFailover.js';

const MODEL      = process.env.GROQ_GRAMMAR_MODEL ?? 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 12_000;

// Human-readable rule name per error type (learner-facing, German).
const TYPE_RULE = {
  'verb-final':  'Verbstellung: Verb ans Satzende (nach weil/dass/wenn …)',
  'aux':         'Hilfsverb: haben oder sein',
  'case':        'Kasus (Fall) nach Präposition',
  'gender':      'Artikel / Genus (der, die, das)',
  'adjective':   'Adjektivendung',
  'word-order':  'Wortstellung',
  'conjugation': 'Verbkonjugation',
  'other':       'Grammatik',
};

const _canon = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?…"'»«„“”]+/gu, '').trim();

const SYSTEM = `Du bist ein PRÄZISER Deutsch-Grammatikprüfer für arabische Muttersprachler, die sich auf ein Vorstellungsgespräch vorbereiten. Der Text ist ein SPRACH-Transkript (der Kandidat hat gesprochen, nicht getippt).

Finde AUSSCHLIESSLICH echte GRAMMATIKfehler dieser Art:
- Verbstellung: Verb-Endstellung im Nebensatz ("weil ich HABE Zeit" → "weil ich Zeit HABE"); Verb-Zweitstellung im Hauptsatz.
- Hilfsverb: haben vs. sein ("ich habe gefahren" → "ich bin gefahren").
- Kasus nach Präposition ("an diese Stelle" → "an dieser Stelle").
- Artikel/Genus (der/die/das), Adjektivendungen ("meiner offene Idee" → "meiner offenen Idee").
- Verbkonjugation, grobe Wortstellung.

Melde NIEMALS: Stil, Wortwahl/Synonyme, Rechtschreibung, Zeichensetzung, Groß/Kleinschreibung (alles Artefakte der Spracherkennung), oder etwas, das in IRGENDEINER Lesart korrekt sein könnte. IM ZWEIFEL NICHT MELDEN — lieber einen Fehler übersehen als etwas Richtiges als falsch markieren.

Für jeden ECHTEN Fehler geben:
{ "wrong": "<WÖRTLICHER Ausschnitt aus dem Text, unverändert>", "correct": "<derselbe Ausschnitt, korrigiert>", "type": "<verb-final|aux|case|gender|adjective|word-order|conjugation|other>", "explain_de": "<eine kurze, einfache deutsche Erklärung>" }

"wrong" MUSS exakt so im Text vorkommen. Antworte NUR mit gültigem JSON: { "errors": [ ... ] }. Keine Fehler → { "errors": [] }.`;

/**
 * @param {Array<{text:string, words?:number}>} utterances candidate turns
 * @returns {Promise<Array|null>} grammar array (buildGrammar shape) or null on failure (→ caller falls back)
 */
export async function buildGrammarLLM(utterances) {
  if (!process.env.GROQ_API_KEY && !process.env.CEREBRAS_API_KEY) return null;

  // Only check clean, complete turns (law 7: never grade a cut-off fragment).
  const clean = (utterances || [])
    .map((u) => (u?.text || '').trim())
    .filter((t) => t && t.split(/\s+/).length >= 2 && !looksTruncatedDE(t));
  if (!clean.length) return [];
  const doc = clean.join('\n');

  let errors;
  try {
    const { content } = await chatWithFailover({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Transkript des Kandidaten (jede Zeile eine Aussage):\n${doc}` },
      ],
      temperature: 0,                       // deterministic → same text, same verdict
      maxTokens: 900,
      timeoutMs: TIMEOUT_MS,
      groqModel: MODEL,
      tag: 'grammarLLM',
    });
    const parsed = JSON.parse(content || '{}');
    errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
  } catch (e) {
    console.error('[grammarLLM] failed:', e.message);
    return null;                              // fail-safe → coach.js keeps LanguageTool/none
  }

  // ── Guards: quote-verify, no-change, trustworthy-correction ──────────────────────────────────
  const docCanon = _canon(doc);
  const byType = new Map();
  for (const e of errors) {
    const wrong = String(e?.wrong ?? '').trim();
    const right = String(e?.correct ?? '').trim();
    if (!wrong || !right) continue;
    if (!docCanon.includes(_canon(wrong))) continue;          // QUOTE GATE — not really said → drop
    if (_canon(wrong) === _canon(right)) continue;            // NO-CHANGE GATE — not an error
    if (!looksLikeTrustworthyCorrection(right)) continue;     // never promote broken German as "correct"
    const type = TYPE_RULE[e?.type] ? e.type : 'other';
    if (!byType.has(type)) {
      byType.set(type, {
        rule:           TYPE_RULE[type],
        explanation:    String(e?.explain_de ?? '').trim(),
        explanation_ar: '',                                   // OWNER-AR slot
        ltRuleId:       `LLM_${type.toUpperCase()}`,
        ltCategoryId:   'GRAMMAR',
        examples:       [],
      });
    }
    const grp = byType.get(type);
    if (!grp.explanation && e?.explain_de) grp.explanation = String(e.explain_de).trim();
    // De-dupe identical wrong/right within a type.
    if (!grp.examples.some((x) => _canon(x.wrong) === _canon(wrong) && _canon(x.right) === _canon(right))) {
      grp.examples.push({ wrong, right, fragmentWrong: wrong, fragmentRight: right });
    }
  }
  return [...byType.values()].filter((g) => g.examples.length);
}

export default { buildGrammarLLM };
