/**
 * l1Errors.js — deterministic detectors for the high-frequency ARABIC-L1 error patterns
 * (ROADMAP #3). The debrief names the learner's SPECIFIC L1 wall — "verb goes to the end
 * after weil/dass" — instead of generic "grammar mistakes".
 *
 * HONESTY DOCTRINE (feedback-accuracy, owner law #2 — every rule below is load-bearing):
 *   - Detectors are pure pattern rules on the learner's own transcript. NO model judges.
 *   - A single occurrence is an accident; only ≥2 occurrences are named as a PATTERN.
 *   - Examples quote the learner ONLY from non-truncated turns (looksTruncatedDE) and never
 *     contain words Deepgram was unsure about (utterance.lowConf) — a mishear must never be
 *     blamed on the learner. If no quotable example survives the gates, the pattern is still
 *     COUNTED but shown without a quote.
 *   - Every detector prefers UNDERCLAIMING: contexts where German case morphology makes the
 *     "wrong" form actually possible (e.g. "der Frage" = correct dative) are never flagged.
 *   - P/B items are framed as what the SPEECH RECOGNITION heard (pronunciation artifact),
 *     never as a knowledge error.
 *   - All learner-visible copy is German; note_ar fields are OWNER-AR slots (empty).
 */
import { looksTruncatedDE } from './turnQuality.js';

// ── Detector 1: verb-second inside a subordinate clause (the #1 Arabic-L1 wall) ────────
// "weil ich HABE keine Zeit" — the finite verb sits right after the subject instead of
// clause-final. Rule: conjunction + subject + finite verb + MORE CLAUSE CONTENT. If the verb
// already ends the clause ("weil ich arbeite.", "wenn Sie möchten,") it IS final → correct.
const SUB_CONJ = '(?:weil|dass|wenn|obwohl|ob|damit|falls|bevor|nachdem|sodass|während)';
const SUBJECT  = '(?:ich|du|er|sie|es|wir|ihr|man)';
// Common finite verb forms a B1 speaker actually produces (deliberately finite-only).
const FINITE_VERB = '(?:habe|hast|hat|haben|bin|bist|ist|sind|war|warst|waren|werde|wirst|wird|werden|' +
  'kann|kannst|können|muss|musst|müssen|will|willst|wollen|soll|sollst|sollen|darf|dürfen|möchte|möchtest|möchten|' +
  'mache|machst|macht|machen|gehe|gehst|geht|gehen|komme|kommst|kommt|kommen|arbeite|arbeitest|arbeitet|arbeiten|' +
  'brauche|brauchst|braucht|brauchen|sage|sagst|sagt|sagen|spreche|sprichst|spricht|sprechen|verstehe|verstehst|versteht|verstehen|' +
  'gebe|gibst|gibt|geben|nehme|nimmst|nimmt|nehmen|finde|findest|findet|finden|lerne|lernst|lernt|lernen|wohne|wohnst|wohnt|wohnen)';
// After the misplaced verb there must be REAL clause content (not the clause ending).
const V2_IN_SUB = new RegExp(
  `\\b(${SUB_CONJ})\\s+(${SUBJECT})\\s+(${FINITE_VERB})\\s+([a-zäöüß]+(?:\\s+[a-zäöüß]+)*)`, 'gi');

// Deterministic correction for SIMPLE clauses only: conj + subj + verb + rest → conj + subj +
// rest + verb. Attempted only when the rest is short and contains no further clause boundary —
// otherwise we name the rule but do not fabricate a rewrite.
function suggestVerbFinal(conj, subj, verb, rest) {
  const restTrim = rest.replace(/[.,!?].*$/, '').trim();
  const restWords = restTrim.split(/\s+/).filter(Boolean);
  if (!restWords.length || restWords.length > 6) return null;
  if (/\b(und|aber|oder|weil|dass|wenn|denn|sondern)\b/i.test(restTrim)) return null;
  return `${conj} ${subj} ${restTrim} ${verb}`;
}

// ── Detector 2: article–gender slips on high-frequency interview nouns ────────────────
// Curated lexicon (BPO/interview register). We flag an article ONLY when it is impossible
// for that noun's gender in EVERY case (nom/acc/dat/gen) — "der Frage" (dative) is correct
// German and is never flagged. Underclaims by design.
const GENDER_ARTICLES = {
  m: new Set(['der', 'den', 'dem', 'des', 'ein', 'einen', 'einem', 'eines']),
  f: new Set(['die', 'der', 'eine', 'einer']),
  n: new Set(['das', 'dem', 'des', 'ein', 'einem', 'eines']),
};
const NOM = { m: 'der', f: 'die', n: 'das' };
// singular surface form → gender (exact-match only; plurals have different forms).
const NOUN_GENDER = {
  problem: 'n', kunde: 'm', frage: 'f', antwort: 'f', lösung: 'f', rechnung: 'f',
  lieferung: 'f', firma: 'f', team: 'n', arbeit: 'f', erfahrung: 'f', beispiel: 'n',
  nummer: 'f', system: 'n', vertrag: 'm', fehler: 'm', zeit: 'f', jahr: 'n',
  sprache: 'f', termin: 'm', anruf: 'm', nachricht: 'f', adresse: 'f', konto: 'n',
  name: 'm', beruf: 'm', kollege: 'm', abteilung: 'f', gespräch: 'n', angebot: 'n',
};
const ARTICLE_RE = /\b(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+([A-Za-zÄÖÜäöüß]+)\b/g;

// ── Detector 3: P→B devoicing artifacts in the transcript ─────────────────────────────
// Arabic has no /p/; devoiced P surfaces as B and the STT writes a NON-WORD. Only
// unambiguous non-words are listed — every key here is impossible as correct German.
const P_B_MAP = {
  broblem: 'Problem', brobleme: 'Probleme', brozess: 'Prozess', brozesse: 'Prozesse',
  brodukt: 'Produkt', brodukte: 'Produkte', berson: 'Person', bersonen: 'Personen',
  bause: 'Pause', bunkt: 'Punkt', bunkte: 'Punkte', breis: 'Preis', breise: 'Preise',
  blan: 'Plan', barty: 'Party', basswort: 'Passwort', brivat: 'privat',
  braktisch: 'praktisch', brofi: 'Profi', brojekt: 'Projekt', brojekte: 'Projekte',
};

// ── Shared: which utterances may be QUOTED (the honesty gates) ─────────────────────────
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
 * Scan all utterances → every detected occurrence per pattern.
 * @returns {{ key, count, examples: [{quote, better}] }[]} (examples already honesty-gated)
 */
export function detectL1Patterns(utterances) {
  const hits = {
    'verb-final':     { key: 'verb-final',     count: 0, examples: [] },
    'article-gender': { key: 'article-gender', count: 0, examples: [] },
    'p-b':            { key: 'p-b',            count: 0, examples: [] },
  };

  for (const u of (Array.isArray(utterances) ? utterances : [])) {
    const text = String(u?.text || '');
    if (!text.trim()) continue;
    const mayQuote = quotable(u);

    // 1) verb-second in subordinate clause
    V2_IN_SUB.lastIndex = 0;
    let m;
    while ((m = V2_IN_SUB.exec(text)) !== null) {
      const [, conj, subj, verb, rest] = m;
      hits['verb-final'].count++;
      const restShown = rest.replace(/[.,!?].*$/, '').trim().split(/\s+/).slice(0, 6).join(' ');
      const quote = `${conj} ${subj} ${verb} ${restShown}`.trim();
      const better = suggestVerbFinal(conj, subj, verb, rest);
      if (mayQuote && !hasLowConfOverlap(u, quote)) {
        hits['verb-final'].examples.push({ quote, better });
      }
    }

    // 2) article–gender (impossible-article-only, exact singular forms)
    ARTICLE_RE.lastIndex = 0;
    while ((m = ARTICLE_RE.exec(text)) !== null) {
      const article = m[1].toLowerCase();
      const noun = m[2];
      const gender = NOUN_GENDER[noun.toLowerCase()];
      if (!gender || GENDER_ARTICLES[gender].has(article)) continue;
      hits['article-gender'].count++;
      const cap = noun.charAt(0).toUpperCase() + noun.slice(1).toLowerCase();
      const quote = `${m[1]} ${noun}`;
      if (mayQuote && !hasLowConfOverlap(u, quote)) {
        hits['article-gender'].examples.push({ quote, better: `${NOM[gender]} ${cap}` });
      }
    }

    // 3) P→B transcript artifacts
    for (const tok of text.toLowerCase().split(/[^a-zäöüß]+/)) {
      if (!tok || !Object.prototype.hasOwnProperty.call(P_B_MAP, tok)) continue;
      hits['p-b'].count++;
      if (mayQuote && !hasLowConfOverlap(u, tok)) {
        hits['p-b'].examples.push({ quote: tok, better: P_B_MAP[tok] });
      }
    }
  }

  return Object.values(hits).filter((h) => h.count > 0);
}

// Learner-visible copy per pattern (German; ar = OWNER-AR slot, never authored here).
const COPY = {
  'verb-final': {
    title: 'Dein Muster: das Verb muss ans Ende',
    explain: 'Nach weil, dass, wenn … wandert das Verb ans Satzende. Das ist DIE typische Hürde ' +
             'für Arabisch-Muttersprachler — und einer der Fehler, die deutsche Interviewer sofort hören.',
  },
  'article-gender': {
    title: 'Dein Muster: der / die / das',
    explain: 'Bei einigen häufigen Wörtern rutscht der falsche Artikel rein. Lern diese Wörter ' +
             'IMMER zusammen mit ihrem Artikel — nie das Wort allein.',
  },
  'p-b': {
    title: 'Dein Muster: P klingt wie B',
    explain: 'Die Spracherkennung hat bei dir mehrmals ein B gehört, wo ein P hingehört (im Arabischen ' +
             'gibt es kein P). Am Telefon versteht ein deutsches Ohr dann ein anderes Wort. Übe: Papier, ' +
             'Problem, Pause — mit einem kleinen Luftstoß beim P.',
  },
};

/**
 * THE debrief hook: at most ONE pattern (the most frequent), only when it occurred ≥2 times.
 * @returns {{ key, title, explain, note_ar, count, example: {quote, better}|null } | null}
 */
export function topL1Pattern(utterances, minCount = 2) {
  const found = detectL1Patterns(utterances);
  if (!found.length) return null;
  found.sort((a, b) => b.count - a.count);
  const top = found[0];
  if (top.count < minCount) return null;
  const example = top.examples.find((e) => e.better) || top.examples[0] || null;
  return { key: top.key, ...COPY[top.key], note_ar: '', count: top.count, example };
}

export default { detectL1Patterns, topL1Pattern };
