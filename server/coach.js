/**
 * coach.js
 * End-of-session debrief generation.
 *
 * Objective metrics (WPM, fillers, vocab/politeness hits) are computed deterministically
 * by the caller and passed in as ground truth.
 *
 * GRAMMAR CORRECTIONS are the SOURCE OF TRUTH from LanguageTool (grammarCheck.js) — a
 * deterministic rule engine, NOT the language model. The model is used only for the
 * subjective parts (strengths / study-next / vocab + their Arabic), and as a conservative
 * backstop for grammar ONLY if LanguageTool is unreachable. Either path is filtered so a
 * "correction" can never equal the original.
 */

import { buildGrammar, isSpeakableRule } from './grammarCheck.js';
import { evaluateNaturalness } from './naturalness.js';

// Debrief enrichment runs on Groq (OpenAI-compatible chat API) — no OpenAI. Grammar
// stays authoritative from LanguageTool; the model only writes strengths/study-next/
// vocab/upgrades + their Arabic. Without GROQ_API_KEY this degrades to a metrics-only
// debrief (+ LanguageTool grammar), so the interview never depends on the model call.
const COACH_MODEL   = process.env.GROQ_COACH_MODEL ?? 'llama-3.3-70b-versatile';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS    = 30_000;

const SYSTEM_PROMPT =
`Du bist ein strenger, aber fairer und ermutigender Deutsch-Coach für ein BPO-Bewerbungstraining
(ägyptische Lernende, Zielmarkt deutsche Call-Center). Du analysierst die DEUTSCHEN Äußerungen
EINES Kandidaten aus EINER Trainingssitzung und schreibst ein präzises Debrief.

Gib AUSSCHLIESSLICH gültiges JSON in GENAU diesem Schema zurück (alle Texte auf Deutsch):
{
  "grammar": [
    {
      "rule": "kurzer, konkreter Regelname, z.B. 'Verb am Satzende nach \\"weil\\"'",
      "count": <ganzzahl: wie oft dieser Fehlertyp vorkam>,
      "explanation": "ein Satz auf DEUTSCH: was die Regel ist und was der Kandidat falsch macht",
      "explanation_ar": "GENAU dieselbe Erklärung auf ARABISCH (nur die Erklärung übersetzen)",
      "summaryExamples": [ { "wrong": "<Originalsatz des Kandidaten>", "right": "<korrigiert>" } ],
      "allExamples":     [ { "wrong": "<...>", "right": "<...>" } ]
    }
  ],
  "strengths":    [ "konkrete, ECHTE Stärke aus dieser Sitzung (DEUTSCH)" ],
  "strengths_ar": [ "dieselbe Stärke auf ARABISCH — gleiche Anzahl, gleiche Reihenfolge wie strengths" ],
  "studyNext": [ { "title": "konkrete Handlung (DEUTSCH)", "title_ar": "dieselbe Handlung auf ARABISCH", "detail": "benannte Regel/Vokabel-Set (DEUTSCH)", "detail_ar": "dasselbe Detail auf ARABISCH" } ],
  "vocabTargets": [ { "de": "deutsches Wort/Wendung, das der Kandidat üben sollte", "en": "englische Bedeutung", "note": "kurzer Hinweis (DEUTSCH)", "note_ar": "derselbe Hinweis auf ARABISCH" } ],
  "upgrades": [ { "original": "kurzer ECHTER Ausschnitt aus einer Äußerung des Kandidaten (Originalwortlaut, DEUTSCH)", "better": "stärkere, elegantere deutsche Formulierung DESSELBEN Inhalts", "why": "ein kurzer Satz DEUTSCH: warum stärker (gehobener Wortschatz/Struktur)", "why_ar": "derselbe Grund auf ARABISCH" } ],
  "answerArchitecture": { "label": "stark|solide|ausbaufähig", "de": "EIN konkreter Struktur-Tipp (DEUTSCH), stärken-zuerst", "ar": "derselbe Tipp auf ÄGYPTISCH-ARABISCH, stärken-zuerst" },
  "deliveryConfidence": { "label": "selbstbewusst|solide|zögerlich", "de": "EIN konkreter Delivery-Tipp (DEUTSCH), stärken-zuerst", "ar": "derselbe Tipp auf ÄGYPTISCH-ARABISCH, stärken-zuerst" },
  "priorityFix": { "de": "EIN SATZ auf DEUTSCH: die allerwichtigste Sache, die der Kandidat JETZT üben soll — konkret und handlungsorientiert (z.B. 'Übe heute Abend drei Sätze mit Konjunktiv II: Ich würde … / Ich könnte … / Es wäre besser, wenn …'). Nicht mehr als einen Satz.", "ar": "GENAU DASSELBE auf ägyptischem Arabisch — kurz, direkt, ermutigend." },
  "interviewReview": [
    {
      "frage": "die Frage des Interviewers in 3–8 Wörtern (DEUTSCH)",
      "deinSatz": "WÖRTLICHES Zitat aus der Antwort des Kandidaten (Originalwortlaut)",
      "stark": "was an DIESER Antwort konkret gut war (DEUTSCH) — oder \\"\\" wenn nichts Konkretes",
      "luecke": "was IN BEZUG AUF DIE FRAGE fehlte und einen Personaler stört — präzise (DEUTSCH) — oder \\"\\" wenn die Antwort gut war",
      "fixDerEinstellt": "der EINE konkrete Zusatz/Satz, der genau diese Antwort einstellungsreif macht (DEUTSCH)",
      "stark_ar": "…ägyptisch-arabisch", "luecke_ar": "…", "fixDerEinstellt_ar": "…"
    }
  ]
}

HARTE REGELN:
- KONSERVATIV SEIN (oberste Regel): Im Zweifel NICHT korrigieren. Einem Lernenden fälschlich zu sagen, sein korrektes Deutsch sei falsch, ist SCHLIMMER als einen kleinen Fehler zu übersehen. Markiere AUSSCHLIESSLICH eindeutige, echte Grammatikfehler.
- Ist ein Satz bereits korrekt, darf er NICHT als Fehler erscheinen — auch nicht wegen Stil, Wortwahl oder weil es "schöner" ginge.
- Für JEDES Beispiel MUSS sich "right" inhaltlich von "wrong" UNTERSCHEIDEN. Wäre "right" identisch mit "wrong" (gleiche Wörter, gleiche Reihenfolge), war es kein Fehler → lass das Beispiel WEG.
- VERIFIKATIONSSCHRITT (Pflicht vor der Ausgabe): Prüfe jedes einzelne Beispiel: (1) Ist der Originalsatz WIRKLICH grammatikalisch falsch? (2) VERÄNDERT deine Korrektur den Satz tatsächlich? Behalte das Beispiel NUR, wenn BEIDES eindeutig zutrifft. Sonst verwirf es.
- Beispiel für einen KORREKTEN Satz, der NICHT korrigiert werden darf: "Weil ich sehr gut Deutsch sprechen kann" — das Verb steht korrekt am Satzende nach "weil". So etwas niemals als Fehler ausgeben.
- Bleiben nach dieser Prüfung keine echten Fehler übrig, gib zwingend "grammar": [] zurück. Eine leere Grammatik-Liste ist völlig in Ordnung.
- Gruppiere Fehler nach Regel — NICHT pro Vorkommen auflisten. "count" ist die Gesamtzahl der Vorkommen dieser Regel.
- "summaryExamples": HÖCHSTENS 2 pro Regel, immer aus den ECHTEN Sätzen des Kandidaten (Originalwortlaut bei "wrong").
- "allExamples": ALLE gefundenen Vorkommen dieser Regel (für "alle Fehler zeigen"). Erfinde nichts dazu.
- Erfinde KEINE Fehler und KEINE Sätze. Wenn du dir nicht sicher bist, lass es weg.
- "strengths": nur echte, belegbare Stärken aus DIESER Sitzung. KEINE leere Schmeichelei. Wenn schwach, sei ehrlich und dennoch ermutigend.
- "studyNext": präzise benannte Grammatikregeln und konkrete Vokabel-Sets (z.B. "Konnektoren: obwohl/dennoch/trotzdem", "Beschwerde-Deeskalation: 'Es tut mir leid, dass…', 'Ich kümmere mich umgehend darum'"). Als konkrete Aufgaben formuliert.
- "vocabTargets": 3–6 konkrete deutsche Wörter/Wendungen, die der Kandidat NICHT oder falsch benutzt hat und üben sollte (für Vokabel-Drills). Jeweils mit klarer englischer Bedeutung.
- "upgrades": 2–4 Vorschläge, wie der Kandidat etwas, das er WIRKLICH gesagt hat, STÄRKER formulieren könnte (gehobener Wortschatz, bessere Struktur, mehr Variation zum SELBEN Thema). Das ist KEINE Fehlerkorrektur — "original" war NICHT falsch, sondern wird nur aufgewertet. "original" MUSS wörtlich aus den echten Äußerungen stammen; erfinde NICHTS. Gibt es nichts Sinnvolles oder war die Sitzung sehr kurz, gib "upgrades": [] zurück.
- Höchstens 5 Grammatik-Regeln, höchstens 4 Stärken, höchstens 4 Study-Next-Einträge — die wichtigsten zuerst, nicht-repetitiv.
- ZWEISPRACHIG (Pflicht): Liefere zu JEDER Erklärung zusätzlich die arabische Übersetzung in den Feldern mit Suffix "_ar" (explanation_ar, strengths_ar, title_ar, detail_ar, note_ar). Schreibe EINFACHES, modernes, alltagsnahes Arabisch, das ein ägyptischer Lernender mühelos versteht — KEIN steifes, formelles Hocharabisch. Freundlich und direkt, wie ein ägyptischer Trainer es sagen würde (leichte ägyptische Färbung ist erwünscht, aber verständlich für alle). ÜBERSETZE NUR die Erklärtexte. Deutsche Zielwörter, Regelnamen, Vokabeln ("de") und die Beispielsätze (wrong/right) bleiben IMMER auf Deutsch. "strengths_ar" hat exakt dieselbe Länge und Reihenfolge wie "strengths".
- ARABISCH-STIL (verbindlich für ALLE _ar-Felder und "ar"): Schreibe ECHTES ägyptisches Umgangsarabisch (عامية مصرية), wie ein Trainer in Kairo redet — NICHT förmliches Hocharabisch/Fusha. Kurze, direkte, freundliche Sätze. Ton-Beispiele: „علشان" statt „لأنّ/كي"؛ „اللي" statt „الذي/التي"؛ „اقفل/قفّل" statt „اختتم"؛ „عايز" statt „تريد"؛ „بسببك / بسبب اللي عملته" statt „بفضل جهودك"؛ „حاول / خلّيك" statt „ينبغي/يجب"؛ „كده" statt „هكذا". Es muss klingen wie gesprochenes Ägyptisch, nicht wie ein Lehrbuch.

- ZUSÄTZLICHE DIMENSION 1 — "answerArchitecture" (INHALT/STRUKTUR der Antwort, NICHT Grammatik): Bewerte, ob die Verhaltens-/Kompetenz- und Rollenspiel-Antworten eine knappe Geschichte erzählten — Situation → Handlung → konkretes ERGEBNIS — mit spezifischen Details statt vager Behauptungen und PROFESSIONELL/positiv gerahmtem Konflikt. SCHWACH: kein Ergebnis genannt, nur Aufgaben/Pflichten aufgezählt, Abschweifen ohne Struktur, oder eine Rahmung, die den Kandidaten schlecht dastehen lässt. Beispiel selbstsabotierend: "Ich habe meinem Chef gesagt, dass seine Entscheidung dumm war" → schlecht; STARK umgerahmt: Sichtweise respektiert, fehlende Daten erkannt, Ergebnis dadurch verbessert. "label": stark|solide|ausbaufähig. "de"/"ar": stärken-zuerst (erst was gut war), dann GENAU EIN konkreter Struktur-Fix — z.B. "Deine Geschichte hatte kein Ergebnis — schließe mit dem, was sich durch dich konkret geändert hat." Beziehe dich NUR auf echte Antworten; erfinde nichts. Gab es keine inhaltliche Antwort, gib answerArchitecture weg/leer.

- ZUSÄTZLICHE DIMENSION 2 — "deliveryConfidence" (wie SICHER der Kandidat WIRKTE): GETRENNT von Füllwörtern und Flüssigkeit bewerten — NICHT doppelt zählen. Nutze die Sprechsignale (WpM pro Antwort: sehr niedrige WpM = lange Denk-/Einfrierpausen) UND Transkript-Muster (schwache/verklingende Anfänge, viele Neuansätze, sehr kurze flache Antworten = wirkt unsicher; klare, vollständige, ruhige Sätze = souverän). Ein Kandidat kann flüssig sein und trotzdem unsicher klingen — genau das erfassen. "label": selbstbewusst|solide|zögerlich. "de"/"ar": stärken-zuerst, dann GENAU EIN konkreter Delivery-Fix — z.B. "Du hast drei Antworten sehr leise begonnen — starte jede mit einem festen Satz."

- NIVEAU-SKALIERUNG (beide neuen Dimensionen): Bei a2-b1 (Anfänger) LEICHT, ermutigend, nicht überfordernd — höchstens ein sanfter Tipp, nie streng, der Kandidat darf nicht einfrieren. Bei b2 (fortgeschritten) HOHER Maßstab: eine starke Antwort MUSS ein Ergebnis nennen und der Kandidat MUSS souverän klingen — benenne fehlende Ergebnisse und zögerliche Delivery klar, aber weiterhin stärken-zuerst und nur EIN Fix. Das "ar" für beide ist einfaches ägyptisches Arabisch, freundlich, niemals eine Mauer aus Kritik.

- KERNSTÜCK — "interviewReview" (DAS WICHTIGSTE FELD): Du bekommst das ECHTE Gespräch als Abfolge von Interviewer-Fragen (B:) und Kandidaten-Antworten (K:). Bewerte die 3–4 WICHTIGSTEN Austausche (Vorstellung, Verhaltensfrage, Beschwerde-/Deeskalations-Rollenspiel) — NICHT jede Mini-Äußerung. Für jeden: zitiere die Antwort WÖRTLICH ("deinSatz"), sag was an genau dieser Antwort gut war ("stark"), und vor allem: was IN BEZUG AUF DIE GESTELLTE FRAGE fehlte ("luecke") und der EINE Zusatz, der sie einstellungsreif macht ("fixDerEinstellt"). Ziel: ein AHA-Moment — der Kandidat soll sehen "genau DAS hätte mich den Job gekostet — und SO fixe ich es".
- EINSTELLUNGS-RUBRIK (woran du "luecke" misst — echter BPO-Maßstab):
  • Vorstellung: WER bist du + WARUM Kundenservice + EINE konkrete Stärke mit Beleg. Lücke = nur Floskeln, kein Warum, keine belegte Stärke.
  • Verhaltensfrage (STAR): Situation → Handlung → konkretes ERGEBNIS. Lücke = KEIN Ergebnis, nur Aufgaben aufgezählt, oder Selbstsabotage.
  • Beschwerde/Deeskalation: Beschwerde ANERKENNEN → konkrete LÖSUNG → ZUSAGE/nächster Schritt, ruhig und höflich. Lücke = keine Lösung, defensiv, oder Schuld beim Kunden.
- WAHRHEIT VOR ALLEM: "deinSatz" MUSS wörtlich aus den Kandidaten-Antworten stammen — erfinde NIE ein Zitat. War eine Antwort wirklich gut, lass "luecke" leer und sag es ehrlich in "stark". Erfinde keine Lücke, nur um etwas zu schreiben. Lieber 2 echte, treffende Einträge als 4 erzwungene.
- NIVEAU für interviewReview: a2-b1 → höchstens 2–3 Einträge, sanft, ein Fix pro Eintrag, nie überfordernd. b2 → hoher Maßstab, benenne fehlende Ergebnisse/Lösungen klar, aber immer mit dem konkreten Fix.`;

export async function generateDebrief({ utterances, dialogue, history, metrics, level, csScenarioId }) {
  const apiKey = process.env.GROQ_API_KEY;
  // Deterministic, 100%-accurate "you progressed" narrative from the user's OWN past sessions
  // (never the model's opinion). Always attached so the numbers can never be wrong.
  const progressNarrative = buildProgress(history, metrics);
  if (!utterances || utterances.length === 0) {
    const fb = fallbackDebrief(metrics, utterances);
    fb.progressNarrative = progressNarrative;
    return fb;
  }

  // ── AUTHORITATIVE grammar from LanguageTool (deterministic). null if unreachable. ──
  let ltGrammar = null;
  try {
    ltGrammar = await buildGrammar(utterances);
    console.log(`[coach] LanguageTool grammar: ${ltGrammar.length} rule(s) flagged  session-utterances=${utterances.length}`);
  } catch (e) {
    console.error('[coach] LanguageTool unavailable, will backstop with model:', e.message);
  }

  // No model key → metrics-only debrief, but still attach the authoritative grammar + progress.
  if (!apiKey) {
    const fb = fallbackDebrief(metrics, utterances);
    if (ltGrammar) fb.grammar = ltGrammar;
    fb.grammarSource = ltGrammar ? 'languagetool' : 'none';
    fb.grammarUnavailable = !ltGrammar;
    fb.progressNarrative = progressNarrative;
    return fb;
  }

  // Per-answer pacing from already-available timing (no new data, no new API). The WpM/seconds
  // per answer are DELIVERY signals for deliveryConfidence (very low WpM ⇒ long freezing pauses).
  const sentences = utterances
    .map((u, i) => {
      const ms  = u.durationMs || 0;
      const w   = u.words || String(u.text || '').split(/\s+/).filter(Boolean).length;
      const wpm = ms > 0 ? Math.round(w / (ms / 60000)) : 0;
      const pace = wpm > 0 ? `≈${wpm} WpM, ${(ms / 1000).toFixed(1)}s` : 'keine Pace-Daten';
      return `${i + 1}. [${u.stageLabel ?? 'Teil ' + ((u.stage ?? 0) + 1)}] (${pace}) ${u.text}`;
    })
    .join('\n');

  // The ACTUAL interview as a dialogue (B: interviewer, K: candidate) — this is what lets the
  // debrief judge whether each answer actually answered the question. The single biggest input.
  const transcriptBlock = formatDialogue(dialogue, utterances);

  const userMsg =
    `Niveau: ${level}\n` +
    `Rollenspiel-Szenario: ${csScenarioId ?? 'unbekannt'}\n` +
    `Objektive Metriken (bereits berechnet, als Kontext — nicht neu erfinden): ${JSON.stringify(metrics)}\n` +
    `Hinweis: Die (WpM, Sekunden) pro Antwort sind DELIVERY-Signale für "deliveryConfidence" — niedrige WpM = lange Pausen/Zögern. NICHT mit Füllwörtern/Flüssigkeit doppelt zählen.\n\n` +
    `DAS ECHTE GESPRÄCH (B = Interviewer, K = Kandidat) — analysiere "interviewReview" auf DIESER Grundlage:\n${transcriptBlock}\n\n` +
    `Äußerungen des Kandidaten (chronologisch, mit Pace pro Antwort):\n${sentences}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const coachFetch = fetch(GROQ_CHAT_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal:  controller.signal,
    body: JSON.stringify({
      model:           COACH_MODEL,
      temperature:     0.2,
      max_tokens:      3200,   // larger now to fit the per-exchange interviewReview
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
    }),
  });

  // Run naturalness evaluator in parallel — zero added latency.
  const [coachResult, naturalResult] = await Promise.allSettled([
    coachFetch,
    evaluateNaturalness({ utterances, level, csScenarioId }),
  ]);

  clearTimeout(timer);

  const naturalness = naturalResult.status === 'fulfilled' ? naturalResult.value?.naturalness ?? null : null;

  try {
    if (coachResult.status === 'rejected') throw coachResult.reason;
    const res = coachResult.value;
    if (!res.ok) throw new Error(`coach API ${res.status} ${await res.text().catch(() => '')}`);

    const data   = await res.json();
    const txt    = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(txt);
    const norm   = normalize(parsed);
    // GUARD (anti-fabrication): an "upgrade" must reword words the candidate REALLY said.
    const saidCanon = _canon((utterances || []).map((u) => u?.text || '').join(' '));
    norm.upgrades = (norm.upgrades || []).filter((u) => saidCanon.includes(_canon(u.original)));
    // GUARD: every interviewReview "deinSatz" must be a real candidate quote (substring) —
    // drop any entry the model invented, so the review can never fabricate words.
    norm.interviewReview = (norm.interviewReview || []).filter((r) => r.deinSatz && saidCanon.includes(_canon(r.deinSatz)));
    // GRAMMAR: ONLY from LanguageTool — NEVER the model.
    const grammar = ltGrammar || [];
    const lesson  = buildLesson(utterances, metrics, grammar);
    const drills  = buildDrills(grammar);
    return { ...norm, grammar, lesson, drills, metrics, progressNarrative, generated: true, naturalness, grammarSource: ltGrammar ? 'languagetool' : 'none', grammarUnavailable: !ltGrammar };
  } catch (err) {
    console.error('[coach] debrief failed:', err.message);
    const fb = fallbackDebrief(metrics, utterances);
    if (ltGrammar) fb.grammar = ltGrammar;
    fb.grammarSource = ltGrammar ? 'languagetool' : 'none';
    fb.grammarUnavailable = !ltGrammar;
    fb.naturalness = naturalness;
    fb.drills = buildDrills(fb.grammar);
    fb.progressNarrative = progressNarrative;
    return fb;
  }
}

// ── Identical-correction guard ──────────────────────────────────────────────────
// Canonicalize for comparison: collapse whitespace and ignore a trailing sentence
// punctuation mark. Case IS preserved — German noun capitalization is a real fix, so
// "haus" → "Haus" must still count as a genuine correction.
function _canon(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["'„“‚‘]+|["'„“‚‘]+$/g, '')
    .replace(/[.!?…]+\s*$/u, '')
    .trim()
    .toLowerCase();
}
// A correction is only real if both fields exist AND the corrected text actually
// differs from the original. wrong === right means the model invented a non-error.
function _isRealCorrection(e) {
  if (!e || !e.wrong || !e.right) return false;
  const w = _canon(e.wrong), r = _canon(e.right);
  return w.length > 0 && r.length > 0 && w !== r;
}

// ── Shape-guard the model output ────────────────────────────────────────────────
// PURE function of the model's parsed JSON `d` only. It produces the forward-looking
// ENRICHMENT (strengths / studyNext / vocab / upgrades + their Arabic). Grammar and the
// deterministic lesson are attached by the caller (generateDebrief), which has access to
// the authoritative LanguageTool grammar and the candidate's utterances/metrics.
export function normalize(d) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  // The model's own grammar is shaped here for safety, but generateDebrief OVERRIDES it
  // with the authoritative LanguageTool grammar — the model never decides corrections.
  const grammar = arr(d.grammar)
    .map((g) => {
      // Hard filter: discard every example whose "correction" equals the original.
      const all     = arr(g.allExamples).filter(_isRealCorrection);
      let   summary = arr(g.summaryExamples).filter(_isRealCorrection).slice(0, 2);
      if (!summary.length) summary = all.slice(0, 2);
      // count must reflect REAL corrections only — never the model's (possibly inflated) number.
      const realCount = Math.max(all.length, summary.length);
      return {
        rule:           String(g.rule ?? 'Unbenannte Regel'),
        count:          realCount,
        explanation:    String(g.explanation ?? ''),
        explanation_ar: String(g.explanation_ar ?? ''),   // Arabic explanation (German targets stay German)
        summaryExamples: summary,
        allExamples:    all.length ? all : summary,
      };
    })
    // Drop any rule that has no genuine correction left after filtering.
    .filter((g) => g.summaryExamples.length > 0)
    .slice(0, 5);

  const strengths    = arr(d.strengths).slice(0, 4).map(String);
  const strengths_ar = arr(d.strengths_ar).slice(0, 4).map(String);

  const studyNext = arr(d.studyNext).slice(0, 4)
    .map((s) => ({
      title:     String(s?.title ?? ''),
      title_ar:  String(s?.title_ar ?? ''),
      detail:    String(s?.detail ?? ''),
      detail_ar: String(s?.detail_ar ?? ''),
    }))
    // Drop any model-suggested study item about punctuation/casing/spelling — unspeakable in a
    // voice trainer (e.g. "Kommasetzung üben"). isSpeakableRule screens both title and detail.
    .filter((s) => s.title && isSpeakableRule(s.title) && isSpeakableRule(s.detail));

  const vocabTargets = arr(d.vocabTargets).slice(0, 6)
    .map((v) => ({
      de:      String(v?.de ?? ''),
      en:      String(v?.en ?? ''),
      note:    String(v?.note ?? ''),
      note_ar: String(v?.note_ar ?? ''),
    }))
    .filter((v) => v.de);

  // "upgrades" reword something the candidate REALLY said; keep only when it actually changes.
  const upgrades = arr(d.upgrades)
    .filter((u) => u && u.original && u.better && _canon(u.original) !== _canon(u.better))
    .slice(0, 4)
    .map((u) => ({ original: String(u.original), better: String(u.better), why: String(u.why ?? ''), why_ar: String(u.why_ar ?? '') }));

  // ── Additive coaching dimensions (answer architecture + delivery confidence) ──────
  // Shaped here, attached to the debrief; absent (null) when the model/key is unavailable so
  // the client simply doesn't render them. Purely additive — existing fields are untouched.
  const dim = (o, allowed, dflt) => {
    if (!o || typeof o !== 'object') return null;
    const de = String(o.de ?? '').trim();
    const ar = String(o.ar ?? '').trim();
    if (!de && !ar) return null;
    return { label: allowed.includes(String(o.label)) ? String(o.label) : dflt, de, ar };
  };
  const answerArchitecture = dim(d.answerArchitecture, ['stark', 'solide', 'ausbaufähig'], 'solide');
  const deliveryConfidence = dim(d.deliveryConfidence, ['selbstbewusst', 'solide', 'zögerlich'], 'solide');
  const priorityFix = (d.priorityFix?.de || d.priorityFix?.ar)
    ? { de: String(d.priorityFix?.de ?? '').trim(), ar: String(d.priorityFix?.ar ?? '').trim() }
    : null;

  // ── interviewReview: per-exchange, quote-grounded coaching (the "aha" field) ──────
  // deinSatz membership in the real transcript is enforced by the caller; here we shape.
  const str = (x) => String(x ?? '').trim();
  const interviewReview = arr(d.interviewReview)
    .map((r) => ({
      frage:              str(r?.frage),
      deinSatz:           str(r?.deinSatz),
      stark:              str(r?.stark),
      luecke:             str(r?.luecke),
      fixDerEinstellt:    str(r?.fixDerEinstellt),
      stark_ar:           str(r?.stark_ar),
      luecke_ar:          str(r?.luecke_ar),
      fixDerEinstellt_ar: str(r?.fixDerEinstellt_ar),
    }))
    .filter((r) => r.deinSatz && (r.stark || r.luecke || r.fixDerEinstellt))
    .slice(0, 4);

  return { grammar, strengths, strengths_ar, studyNext, vocabTargets, upgrades, answerArchitecture, deliveryConfidence, priorityFix, interviewReview };
}

// ── Format the real interview as a readable B:/K: transcript for the model ─────────
// Falls back to candidate-only utterances if no paired dialogue was captured (older sessions).
function formatDialogue(dialogue, utterances) {
  const turns = Array.isArray(dialogue) ? dialogue.filter((t) => (t?.text || '').trim()) : [];
  if (turns.length) {
    let lastStage = -1, out = '';
    for (const t of turns) {
      if (t.stage !== lastStage && t.stageLabel) { out += `\n[${t.stageLabel}]\n`; lastStage = t.stage; }
      out += `${t.role === 'boss' ? 'B' : 'K'}: ${String(t.text).trim()}\n`;
    }
    return out.trim();
  }
  return (utterances || []).map((u, i) => `K${i + 1}: ${(u.text || '').trim()}`).join('\n');
}

// ── DETERMINISTIC progress narrative — built from the user's OWN past sessions ─────
// 100% factual (their real numbers), never the model's opinion. Returns null on the first
// session (nothing to compare) or when there is not enough signal to say something true.
function buildProgress(history, metrics) {
  const past = Array.isArray(history) ? history.filter((h) => Number.isFinite(h?.fluency)) : [];
  if (!past.length || !metrics) return null;
  const firstFl = past[0].fluency;
  const lines_de = [], lines_ar = [];
  const sessionNo = past.length + 1;
  lines_de.push(`Das ist deine ${sessionNo}. Sitzung.`);
  lines_ar.push(`دي الجلسة رقم ${sessionNo} ليك.`);

  if (Number.isFinite(past[0]?.fillers) && Number.isFinite(metrics.fillers)) {
    const d0 = past[0].fillers, dn = metrics.fillers;
    if (dn < d0)      { lines_de.push(`Füllwörter: von ${d0} (erste Sitzung) auf ${dn} heute — du zögerst weniger.`); lines_ar.push(`كلمات الحشو: من ${d0} (أول جلسة) لـ ${dn} النهاردة — بتتردد أقل.`); }
    else if (dn > d0) { lines_de.push(`Füllwörter heute ${dn} (erste Sitzung ${d0}) — heute etwas mehr Zögern, das schwankt.`); lines_ar.push(`كلمات الحشو النهاردة ${dn} (أول جلسة ${d0}) — تردد أكتر شوية، بيتغير من جلسة للتانية.`); }
  }
  if (Number.isFinite(firstFl) && Number.isFinite(metrics.fluency)) {
    const diff = Math.round(metrics.fluency - firstFl);
    if (diff > 0) { lines_de.push(`Flüssigkeit: +${diff} Punkte seit deiner ersten Sitzung.`); lines_ar.push(`الطلاقة: +${diff} نقطة من أول جلسة.`); }
  }

  if (lines_de.length <= 1) return null;   // only the session counter → not worth showing yet
  return { de: lines_de.join(' '), ar: lines_ar.join(' ') };
}

function buildLesson(utterances, metrics, grammar) {
  const text = (utterances || []).map((u) => (u?.text || '').trim()).filter(Boolean).join('\n').toLowerCase();
  const picks = [];

  const add = (de, ar) => { picks.push({ de, ar: ar || de }); };

  // 1) If few real grammar blocks: give a concrete next-rule focus based on their miss set.
  const realRules = (grammar || []).filter((g) => Array.isArray(g.summaryExamples) && g.summaryExamples.length > 0)
    .map((g) => g.rule).filter(Boolean);
  if (realRules.length === 0) {
    add('Abschluss: Keine expliziten Grammatikfehler gefunden — saubere Sitzung. Nächster Schritt: erzähl eine Geschichte mit 3 verschiedenen Nebensätzen.', 'خلاصة: لم يتم العثور على أخطاء نحوية واضحة — أداء نظيف.');
  } else if (realRules.length === 1) {
    const rule = realRules[0];
    add(`Kurzübung nur zu dieser Regel: "${rule}" — 5 Sätze neu formulieren und laut vorlesen.`, 'تمرين قصير متمركز فقط على قاعدة:');
  } else {
    if (realRules.length > 0) add(`Höchste Priorität ist jetzt: "${realRules[0]}".`, 'الأولوية القصوى الآن:');
  }

  // 2) Pace and length signal.
  const wpm = metrics?.wpm;
  if (typeof wpm === 'number') {
    if (wpm < 100) add(`Tempo niedrig (ca. ${wpm} WpM). Mehrere kurze Antworten kombinieren und aktives Sprechen üben.`, 'سرعة الكلام منخفضة تقريباً:');
    else if (wpm > 185) add(`Tempo sehr hoch (ca. ${wpm} WpM). Für Klarheit und Höflichkeit eine kurze Denkpause einbauen.`, 'سرعة الكلام مرتفعة جداً:');
  }

  // 3) Tool words they actually used / missed.
  const used = text.includes('weil') || text.includes('obwohl') || text.includes('damit') || text.includes('sodass');
  if (!used) add('Ergänze heute mindestens einen Nebensatz: weil / obwohl / damit / sodass.', 'أضف اليوم جملة ثانوية واحدة على الأقل:');

  const polite = text.includes('entschuldigung') || text.includes('tut mir leid') || text.includes('ich würde') || text.includes('ich könnte');
  if (!polite) add('Höflichkeitssignal einbauen: "Es tut mir leid, dass …" oder "Ich würde vorschlagen, dass …"', 'أدرج إشارة تأدب:');

  // 4) Variation-only recommendation if they stayed on-topic but were short.
  const words = (metrics?.words ?? 0);
  if (words > 0 && words < 45) add('Antworten ausdauernder gestalten: zuerst Grund, dann Beispiel, dann Ergebnis.', 'خلّي إجاباتك أطول وأكثر تفصيلاً:');

  // 5) If they already used some strong words, anchor on it.
  if (metrics?.c1WordsUsed && metrics.c1WordsUsed.length) {
    add(`Starker Begriff schon genutzt: "${metrics.c1WordsUsed[0]}". Baue noch einen weiteren an.`, 'استخدمت كلمة قوية مسبقاً. أضف واحدة مشابهة.');
  }

  // 6) Fallback if nothing matched: a generic but concrete skill.
  if (picks.length === 0) {
    add('Aufgabe: eine kurze Kunden-Mail auf Deutsch formulieren.', 'المهمّة الآن: صيغ بريد إلكتروني عميل قصير بالألمانية.');
  }

  return picks.slice(0, 4);
}

// ── "Fix it now" drills — derived from LanguageTool grammar errors (zero API cost) ─
// Each drill gives the user one sentence to repair: the wrong form they actually said,
// the correct form, and a terse instruction. Max 3 drills, one per top grammar rule.
function buildDrills(grammar) {
  const drills = [];
  for (const g of (Array.isArray(grammar) ? grammar : []).slice(0, 3)) {
    const ex = (g.summaryExamples || [])[0] || (g.allExamples || [])[0];
    if (!ex || !ex.wrong || !ex.right) continue;
    drills.push({
      rule:   String(g.rule ?? ''),
      before: String(ex.wrong),
      after:  String(ex.right),
      de:     `Sag es richtig: „${ex.wrong}"`,
      ar:     `قوله صح: „${ex.wrong}"`,
    });
  }
  return drills;
}

// ── Metrics-only fallback (no key / API error / no speech) ───────────────────────
function fallbackDebrief(metrics, utterances) {
  const strengths = [], strengths_ar = [];
  const addStrength = (de, ar) => { strengths.push(de); strengths_ar.push(ar); };
  if (metrics?.connectorHits > 0)  addStrength(`Du hast Nebensätze mit Konnektoren benutzt (${metrics.connectorHits}×) — gute Satzstruktur.`, `استخدمت جملاً ثانوية بأدوات ربط (${metrics.connectorHits}×) — بنية جُمَل جيدة.`);
  if (metrics?.konjunktivHits > 0) addStrength(`Du hast den Konjunktiv II für Höflichkeit eingesetzt (${metrics.konjunktivHits}×).`, `استخدمت صيغة الـ Konjunktiv II للتأدّب (${metrics.konjunktivHits}×).`);
  if (metrics?.c1Hits > 0)         addStrength(`Gehobener Wortschatz erkannt (${metrics.c1Hits} C1-Treffer).`, `تم رصد مفردات راقية (${metrics.c1Hits} من مستوى C1).`);
  if (!strengths.length)           addStrength('Du hast die Sitzung auf Deutsch durchgehalten — das ist die Basis. Weiter so.', 'أكملت الجلسة بالألمانية — هذا هو الأساس. واصل التقدّم.');

  const studyNext = [
    { title: 'Sprechtempo festigen',  title_ar: 'ثبّت سرعة الكلام',     detail: `Ziel 140–160 WpM (zuletzt ${metrics?.wpm ?? '?'} WpM).`, detail_ar: `الهدف 140–160 كلمة/دقيقة (آخر قياس ${metrics?.wpm ?? '؟'}).` },
    { title: 'Füllwörter reduzieren', title_ar: 'قلّل كلمات الحَشو',      detail: 'äh / ehm / also / halt bewusst durch eine kurze Pause ersetzen.', detail_ar: 'استبدل äh / ehm / also / halt بوقفة قصيرة بدلاً منها.' },
    { title: 'Konnektoren üben',      title_ar: 'تدرّب على أدوات الربط', detail: 'weil, obwohl, damit, sodass — je einen Nebensatz pro Antwort einbauen.', detail_ar: 'weil, obwohl, damit, sodass — أدرج جملة ثانوية واحدة في كل إجابة.' },
  ];

  return {
    grammar: [],
    strengths,
    strengths_ar,
    studyNext,
    vocabTargets: [],
    upgrades: [],
    drills: [],
    interviewReview: [],
    lesson: buildLesson(utterances, metrics, []),
    metrics,
    generated: false,
    naturalness: null,
    note: 'Detaillierte Grammatik-Analyse war nicht verfügbar — hier die objektiven Kennzahlen und Lernhinweise.',
  };
}
