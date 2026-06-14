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

import { buildGrammar } from './grammarCheck.js';

const COACH_MODEL  = process.env.OAI_COACH_MODEL ?? 'gpt-4o';
const OAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS   = 30_000;

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
  "deliveryConfidence": { "label": "selbstbewusst|solide|zögerlich", "de": "EIN konkreter Delivery-Tipp (DEUTSCH), stärken-zuerst", "ar": "derselbe Tipp auf ÄGYPTISCH-ARABISCH, stärken-zuerst" }
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

- ZUSÄTZLICHE DIMENSION 1 — "answerArchitecture" (INHALT/STRUKTUR der Antwort, NICHT Grammatik): Bewerte, ob die Verhaltens-/Kompetenz- und Rollenspiel-Antworten eine knappe Geschichte erzählten — Situation → Handlung → konkretes ERGEBNIS — mit spezifischen Details statt vager Behauptungen und PROFESSIONELL/positiv gerahmtem Konflikt. SCHWACH: kein Ergebnis genannt, nur Aufgaben/Pflichten aufgezählt, Abschweifen ohne Struktur, oder eine Rahmung, die den Kandidaten schlecht dastehen lässt. Beispiel selbstsabotierend: "Ich habe meinem Chef gesagt, dass seine Entscheidung dumm war" → schlecht; STARK umgerahmt: Sichtweise respektiert, fehlende Daten erkannt, Ergebnis dadurch verbessert. "label": stark|solide|ausbaufähig. "de"/"ar": stärken-zuerst (erst was gut war), dann GENAU EIN konkreter Struktur-Fix — z.B. "Deine Geschichte hatte kein Ergebnis — schließe mit dem, was sich durch dich konkret geändert hat." Beziehe dich NUR auf echte Antworten; erfinde nichts. Gab es keine inhaltliche Antwort, gib answerArchitecture weg/leer.

- ZUSÄTZLICHE DIMENSION 2 — "deliveryConfidence" (wie SICHER der Kandidat WIRKTE): GETRENNT von Füllwörtern und Flüssigkeit bewerten — NICHT doppelt zählen. Nutze die Sprechsignale (WpM pro Antwort: sehr niedrige WpM = lange Denk-/Einfrierpausen) UND Transkript-Muster (schwache/verklingende Anfänge, viele Neuansätze, sehr kurze flache Antworten = wirkt unsicher; klare, vollständige, ruhige Sätze = souverän). Ein Kandidat kann flüssig sein und trotzdem unsicher klingen — genau das erfassen. "label": selbstbewusst|solide|zögerlich. "de"/"ar": stärken-zuerst, dann GENAU EIN konkreter Delivery-Fix — z.B. "Du hast drei Antworten sehr leise begonnen — starte jede mit einem festen Satz."

- NIVEAU-SKALIERUNG (beide neuen Dimensionen): Bei a2-b1 (Anfänger) LEICHT, ermutigend, nicht überfordernd — höchstens ein sanfter Tipp, nie streng, der Kandidat darf nicht einfrieren. Bei b2 (fortgeschritten) HOHER Maßstab: eine starke Antwort MUSS ein Ergebnis nennen und der Kandidat MUSS souverän klingen — benenne fehlende Ergebnisse und zögerliche Delivery klar, aber weiterhin stärken-zuerst und nur EIN Fix. Das "ar" für beide ist einfaches ägyptisches Arabisch, freundlich, niemals eine Mauer aus Kritik.`;

export async function generateDebrief({ utterances, metrics, level, csScenarioId }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!utterances || utterances.length === 0) {
    return fallbackDebrief(metrics, utterances);
  }

  // ── AUTHORITATIVE grammar from LanguageTool (deterministic). null if unreachable. ──
  let ltGrammar = null;
  try {
    ltGrammar = await buildGrammar(utterances);
    console.log(`[coach] LanguageTool grammar: ${ltGrammar.length} rule(s) flagged  session-utterances=${utterances.length}`);
  } catch (e) {
    console.error('[coach] LanguageTool unavailable, will backstop with model:', e.message);
  }

  // No model key → metrics-only debrief, but still attach the authoritative grammar.
  if (!apiKey) {
    const fb = fallbackDebrief(metrics, utterances);
    if (ltGrammar) fb.grammar = ltGrammar;
    fb.grammarSource = ltGrammar ? 'languagetool' : 'none';
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

  const userMsg =
    `Niveau: ${level}\n` +
    `Rollenspiel-Szenario: ${csScenarioId ?? 'unbekannt'}\n` +
    `Objektive Metriken (bereits berechnet, als Kontext — nicht neu erfinden): ${JSON.stringify(metrics)}\n` +
    `Hinweis: Die (WpM, Sekunden) pro Antwort sind DELIVERY-Signale für "deliveryConfidence" — niedrige WpM = lange Pausen/Zögern. NICHT mit Füllwörtern/Flüssigkeit doppelt zählen.\n\n` +
    `Äußerungen des Kandidaten (chronologisch, mit Pace pro Antwort):\n${sentences}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OAI_CHAT_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:           COACH_MODEL,
        temperature:     0.2,
        max_tokens:      2000,   // hard output cap (debrief JSON fits well under this)
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
      }),
    });

    if (!res.ok) throw new Error(`coach API ${res.status} ${await res.text().catch(() => '')}`);

    const data   = await res.json();
    const txt    = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(txt);
    const norm   = normalize(parsed);
    // GRAMMAR: ONLY from LanguageTool — NEVER the model. A correction can therefore never
    // be hallucinated: each "wrong" is the candidate's real sentence and each "right" is a
    // deterministic LanguageTool fix. If LT was unreachable, show NO grammar at all (we'd
    // rather show nothing than invent a correction). The model is used only for the
    // forward-looking enrichment (strengths / study-next / vocab / upgrades).
    const grammar = ltGrammar || [];
    // Deterministic lesson built from the candidate's real utterances + metrics + the
    // authoritative grammar (NOT from the model) — always factual, never hallucinated.
    const lesson  = buildLesson(utterances, metrics, grammar);
    return { ...norm, grammar, lesson, metrics, generated: true, grammarSource: ltGrammar ? 'languagetool' : 'none' };
  } catch (err) {
    console.error('[coach] debrief failed:', err.message);
    const fb = fallbackDebrief(metrics, utterances);
    if (ltGrammar) fb.grammar = ltGrammar;           // keep authoritative grammar even if the model call failed
    fb.grammarSource = ltGrammar ? 'languagetool' : 'none';
    return fb;
  } finally {
    clearTimeout(timer);
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
    .filter((s) => s.title);

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

  return { grammar, strengths, strengths_ar, studyNext, vocabTargets, upgrades, answerArchitecture, deliveryConfidence };
}

function buildLesson(utterances, metrics, grammar) {
  const text = (utterances || []).map((u) => (u?.text || '').trim()).filter(Boolean).join('\n').toLowerCase();
  const picks = [];

  const add = (de, ar) => { picks.push(de); };

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
    lesson: buildLesson(utterances, metrics, []),
    metrics,
    generated: false,
    note: 'Detaillierte Grammatik-Analyse war nicht verfügbar — hier die objektiven Kennzahlen und Lernhinweise.',
  };
}
