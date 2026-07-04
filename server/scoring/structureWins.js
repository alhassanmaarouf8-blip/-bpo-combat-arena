/**
 * structureWins.js — deterministic recognition of German structures the candidate USED WELL.
 * The mirror image of l1Errors.js: instead of naming the learner's error pattern, this names
 * what a real human HR interviewer would genuinely notice and mention in a warm goodbye —
 * "Mir ist aufgefallen, dass Sie mehrfach den Konjunktiv verwendet haben."
 *
 * HONESTY DOCTRINE (feedback-accuracy, owner law #2 — praise must be as verified as criticism):
 *   - Detectors are pure pattern rules on the learner's own transcript. NO model judges.
 *   - A single occurrence can be an STT fluke; only ≥2 occurrences become a named strength.
 *   - Quoted examples come ONLY from non-truncated turns (looksTruncatedDE) and never contain
 *     words Deepgram was unsure about (utterance.lowConf) — invented praise is as false as
 *     invented blame. If no quotable example survives, the win is still counted, shown quoteless.
 *   - Every detector prefers UNDERCLAIMING: ambiguous forms (e.g. "sollte" = Präteritum OR
 *     Konjunktiv II) are never counted.
 *   - All learner-visible copy is German; Arabic is an OWNER-AR slot (never authored here).
 */
import { looksTruncatedDE } from './turnQuality.js';

// ── Detector 1: Konjunktiv II (the classic "hireable German" marker) ────────────────────
// Unambiguously subjunctive finite forms only. "sollte/wollte" are Präteritum-ambiguous and
// are deliberately excluded; "würde/hätte/wäre/könnte/müsste/dürfte" cannot be anything else.
const K2_RE = /\b(würde(?:st|n|t)?|hätte(?:st|n|t)?|wäre(?:st|n|t)?|könnte(?:st|n|t)?|müsste(?:st|n|t)?|dürfte(?:st|n|t)?)\b/gi;

// ── Detector 2: subordinate clause with the verb CORRECTLY at the end ────────────────────
// The exact mirror of l1Errors' V2_IN_SUB: conjunction + clause content + finite verb + clause
// boundary. Requires ≥2 words between conjunction and final verb and a real boundary right
// after the verb, so "weil ich HABE keine Zeit" (verb-second error) can never match.
const SUB_CONJ = '(?:weil|dass|wenn|obwohl|ob|damit|falls|bevor|nachdem|sodass|während)';
const FINITE_VERB = '(?:habe|hast|hat|haben|bin|bist|ist|sind|war|warst|waren|hatte|hatten|werde|wirst|wird|werden|' +
  'kann|kannst|können|konnte|konnten|muss|musst|müssen|musste|mussten|will|willst|wollen|wollte|wollten|' +
  'soll|sollst|sollen|darf|dürfen|möchte|möchtest|möchten|würde|würden|hätte|hätten|wäre|wären|könnte|könnten|müsste|müssten|' +
  'mache|machst|macht|machen|machte|gehe|gehst|geht|gehen|ging|komme|kommst|kommt|kommen|kam|arbeite|arbeitest|arbeitet|arbeiten|arbeitete|' +
  'brauche|brauchst|braucht|brauchen|sage|sagst|sagt|sagen|sagte|spreche|sprichst|spricht|sprechen|sprach|verstehe|verstehst|versteht|verstehen|verstand|' +
  'gebe|gibst|gibt|geben|gab|nehme|nimmst|nimmt|nehmen|nahm|finde|findest|findet|finden|fand|lerne|lernst|lernt|lernen|lernte|' +
  'wohne|wohnst|wohnt|wohnen|weiß|weißt|wissen|wusste|bekomme|bekommt|bekommen|bekam|bleibe|bleibt|bleiben|blieb|helfe|hilft|helfen|half|löse|löst|lösen|löste)';
const VERB_FINAL_OK_RE = new RegExp(
  `\\b(${SUB_CONJ})\\s+((?:[A-Za-zÄÖÜäöüß]+\\s+){2,10}?)(${FINITE_VERB})\\s*(?:[,.!?;:]|$)`, 'gim');

// ── Detector 3: Perfekt past-tense narration ("ich habe … gemacht") ──────────────────────
// Auxiliary + a ge-participle within the same clause. The participle must be ≥6 letters and
// not on the false-friend stoplist (gerne/genau/gegen … start with "ge" but are not participles).
const NOT_A_PARTICIPLE = new Set(['gegen', 'gerne', 'genau', 'gerade', 'gering', 'gesamt', 'gestern',
  'gesund', 'geld', 'gefühl', 'gegend', 'gesetz', 'gesicht', 'gespräch', 'geduld', 'genug', 'gewalt']);
const PERFEKT_RE = /\b(habe|hast|hat|haben|bin|bist|ist|sind)\b([^,.!?;]{0,60}?)\b((?:[a-zäöüß]{2,6})?ge[a-zäöüß]{3,}(?:t|en))\b/gi;

// ── Shared: which utterances may be QUOTED (same honesty gates as l1Errors) ──────────────
function quotable(u) {
  if (!u || typeof u.text !== 'string' || !u.text.trim()) return false;
  if (looksTruncatedDE(u.text)) return false;
  return true;
}
function hasLowConfOverlap(u, fragment) {
  const low = u.lowConf;
  if (!low) return false;
  const set = low instanceof Set ? low : new Set(Array.isArray(low) ? low : []);
  if (!set.size) return false;
  const norm = (w) => String(w).toLowerCase().replace(/[^a-zäöüß0-9]/gi, '');
  const lowNorm = new Set([...set].map(norm));
  return String(fragment).toLowerCase().split(/\s+/).some((w) => lowNorm.has(norm(w)));
}

/**
 * Scan all utterances → every detected win with count + honesty-gated example quotes.
 * @returns {{ key, count, examples: string[] }[]}
 */
export function detectStructureWins(utterances) {
  const hits = {
    konjunktiv2:     { key: 'konjunktiv2',     count: 0, examples: [] },
    'verb-final-ok': { key: 'verb-final-ok',   count: 0, examples: [] },
    perfekt:         { key: 'perfekt',         count: 0, examples: [] },
  };

  for (const u of (Array.isArray(utterances) ? utterances : [])) {
    const text = String(u?.text || '');
    if (!text.trim()) continue;
    const mayQuote = quotable(u);
    let m;

    // 1) Konjunktiv II — quote a small window around the form ("ich würde zuerst fragen").
    K2_RE.lastIndex = 0;
    while ((m = K2_RE.exec(text)) !== null) {
      // The NOUN "Würde" (dignity: "mit Würde", "die Würde") is not Konjunktiv II. Underclaim:
      // skip any capitalized match that is not sentence-initial, and any match right after an
      // article/preposition/possessive that marks a noun phrase.
      const before = text.slice(0, m.index);
      const sentenceInitial = /(?:^|[.!?]\s*)$/.test(before);
      if (/^[A-ZÄÖÜ]/.test(m[0]) && !sentenceInitial) continue;
      if (/\b(die|der|das|mit|voller|ohne|seine[rn]?|ihre[rn]?|eine[rn]?)\s*$/i.test(before)) continue;
      hits.konjunktiv2.count++;
      const start = text.lastIndexOf(' ', Math.max(0, m.index - 12)) + 1;
      const quote = text.slice(start, m.index + m[0].length + 24).split(/[,.!?;]/)[0].trim();
      if (mayQuote && quote && !hasLowConfOverlap(u, quote)) hits.konjunktiv2.examples.push(quote);
    }

    // 2) Correct verb-final subordinate clause.
    VERB_FINAL_OK_RE.lastIndex = 0;
    while ((m = VERB_FINAL_OK_RE.exec(text)) !== null) {
      hits['verb-final-ok'].count++;
      const quote = `${m[1]} ${m[2]}${m[3]}`.replace(/\s+/g, ' ').trim();
      if (mayQuote && !hasLowConfOverlap(u, quote)) hits['verb-final-ok'].examples.push(quote);
    }

    // 3) Perfekt narration.
    PERFEKT_RE.lastIndex = 0;
    while ((m = PERFEKT_RE.exec(text)) !== null) {
      const participle = m[3].toLowerCase();
      if (NOT_A_PARTICIPLE.has(participle) || participle.length < 6) continue;
      hits.perfekt.count++;
      const quote = `${m[1]}${m[2]} ${m[3]}`.replace(/\s+/g, ' ').trim();
      if (mayQuote && !hasLowConfOverlap(u, quote)) hits.perfekt.examples.push(quote);
    }
  }

  return Object.values(hits).filter((h) => h.count > 0);
}

// What the interviewer may SAY about each win (German; factual, verified-by-detection).
const WIN_COPY = {
  konjunktiv2:     'mehrfach den Konjunktiv II benutzt (höfliches, gehobenes Deutsch)',
  'verb-final-ok': 'in Nebensätzen das Verb korrekt ans Ende gestellt',
  perfekt:         'im Perfekt von eigenen Erfahrungen erzählt',
};

/**
 * THE hook for the interview's human closing: at most `max` wins, each seen ≥`minCount` times,
 * strongest first. Each entry: { key, count, phrase, quote|null } — `phrase` is safe to hand an
 * LLM as a VERIFIED observation; `quote` (honesty-gated, learner's own words) may be cited.
 */
export function topStructureWins(utterances, { max = 2, minCount = 2 } = {}) {
  const found = detectStructureWins(utterances);
  found.sort((a, b) => b.count - a.count);
  return found
    .filter((h) => h.count >= minCount)
    .slice(0, max)
    .map((h) => ({
      key:    h.key,
      count:  h.count,
      phrase: WIN_COPY[h.key],
      quote:  h.examples.find((q) => q && q.split(/\s+/).length >= 2) || null,
    }));
}

export default { detectStructureWins, topStructureWins };
