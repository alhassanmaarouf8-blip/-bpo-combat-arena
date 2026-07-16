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
  'gebe|gibst|gibt|geben|nehme|nimmst|nimmt|nehmen|finde|findest|findet|finden|lerne|lernst|lernt|lernen|wohne|wohnst|wohnt|wohnen|' +
  // 2026-07-05 recall bump (accuracy-probe): high-frequency interview verbs the list missed. Chosen to
  // NOT take dass-complements, so they can never false-flag "weil ich <verb>, dass …" (guard-verified).
  'bekomme|bekommst|bekommt|bekommen|verdiene|verdienst|verdient|verdienen|bringe|bringst|bringt|bringen|' +
  'bleibe|bleibst|bleibt|bleiben|suche|suchst|sucht|suchen|fühle|fühlst|fühlt|fühlen)';
// After the misplaced verb there must be REAL clause content (not the clause ending).
const V2_IN_SUB = new RegExp(
  `\\b(${SUB_CONJ})\\s+(${SUBJECT})\\s+(${FINITE_VERB})\\s+([a-zäöüß]+(?:\\s+[a-zäöüß]+)*)`, 'gi');

// ADVERSARIAL FIX (2026-07-05): "weil ich arbeiten muss", "dass ich gehen möchte" are CORRECT — the
// matched early "verb" is an INFINITIVE that shares a form with the finite list, and the REAL finite
// verb (a modal/aux) is already clause-final. If the subordinate clause ENDS with one of these finite
// modal/aux forms, verb-final holds → it is NOT an error. (Caught by the adversarial corpus.)
const MODAL_AUX_FINAL = new Set([
  'muss','musst','müssen','musste','mussten','kann','kannst','können','konnte','konnten','könnte','könnten',
  'will','willst','wollen','wollte','wollten','soll','sollst','sollen','sollte','sollten','darf','darfst','dürfen','durfte',
  'mag','magst','mögen','möchte','möchtest','möchten',
  'habe','hab','hast','hat','haben','hatte','hatten','hätte','hätten',
  'bin','bist','ist','sind','seid','war','warst','waren','wäre','wären',
  'wird','werde','werden','wirst','wurde','wurden','würde','würden','würdest',
]);

// ── Detector 2: explicit subject–verb agreement on closed paradigms ───────────────
// Precision-first: only an adjacent, unambiguous personal pronoun plus a known form of
// nine high-frequency auxiliaries/modals is considered. "sie/Sie" and "ihr" are excluded
// because their person/number or grammatical role cannot be recovered safely from ASR text.
const SUBJECT_VERB_PARADIGMS = {
  sein:    { ich: 'bin',    du: 'bist',     er: 'ist',    es: 'ist',    man: 'ist',    wir: 'sind' },
  haben:   { ich: 'habe',   du: 'hast',     er: 'hat',    es: 'hat',    man: 'hat',    wir: 'haben' },
  werden:  { ich: 'werde',  du: 'wirst',    er: 'wird',   es: 'wird',   man: 'wird',   wir: 'werden' },
  koennen: { ich: 'kann',   du: 'kannst',   er: 'kann',   es: 'kann',   man: 'kann',   wir: 'können' },
  muessen: { ich: 'muss',   du: 'musst',    er: 'muss',   es: 'muss',   man: 'muss',   wir: 'müssen' },
  wollen:  { ich: 'will',   du: 'willst',   er: 'will',   es: 'will',   man: 'will',   wir: 'wollen' },
  sollen:  { ich: 'soll',   du: 'sollst',   er: 'soll',   es: 'soll',   man: 'soll',   wir: 'sollen' },
  duerfen: { ich: 'darf',   du: 'darfst',   er: 'darf',   es: 'darf',   man: 'darf',   wir: 'dürfen' },
  moechten:{ ich: 'möchte', du: 'möchtest', er: 'möchte', es: 'möchte', man: 'möchte', wir: 'möchten' },
};
const SUBJECT_VERB_FORM_INDEX = new Map();
for (const [lemma, paradigm] of Object.entries(SUBJECT_VERB_PARADIGMS)) {
  for (const form of Object.values(paradigm)) {
    if (!SUBJECT_VERB_FORM_INDEX.has(form)) SUBJECT_VERB_FORM_INDEX.set(form, lemma);
  }
}
const SUBJECT_VERB_FORMS = [...SUBJECT_VERB_FORM_INDEX.keys()].sort((a, b) => b.length - a.length).join('|');
const SUBJECT_VERB_RE = new RegExp(`\\b(ich|du|er|es|man|wir)\\s+(${SUBJECT_VERB_FORMS})\\b`, 'giu');
const INFINITIVE_FORMS = new Set(['haben', 'werden', 'können', 'müssen', 'wollen', 'sollen', 'dürfen']);

function governedInfinitive(text, matchEnd, observed) {
  if (!INFINITIVE_FORMS.has(observed)) return false;
  const clauseTail = text.slice(matchEnd).split(/[,.!?;:]/u)[0];
  const laterWords = (clauseTail.match(/[\p{L}]+/gu) || []).map((word) => word.toLocaleLowerCase('de-DE'));
  // "weil ich arbeiten können muss" and "weil ich haben möchte" contain an infinitive
  // after the subject which is governed by the later finite modal. Rewriting it would be wrong.
  return laterWords.some((word) => SUBJECT_VERB_FORM_INDEX.has(word));
}

// Deterministic correction for SIMPLE clauses only: conj + subj + verb + rest → conj + subj +
// rest + verb. Attempted only when the rest is short and contains no further clause boundary —
// otherwise we name the rule but do not fabricate a rewrite.
function suggestVerbFinal(conj, subj, verb, rest) {
  const restTrim = rest.replace(/[.,!?].*$/, '').trim();
  const restWords = restTrim.split(/\s+/).filter(Boolean);
  // Human-corpus guard (Falko-MERLIN dev): a one-token tail such as "weil wir machen in"
  // is not enough evidence to reconstruct a complete clause. Count the signal, but do not
  // promote a fabricated "better" sentence.
  if (restWords.length < 2 || restWords.length > 6) return null;
  // "bitte" commonly marks the following main-clause request when ASR omits the comma
  // ("Wenn du suchst bitte ruf ..."). Moving that whole request behind the subordinate verb
  // teaches broken German. Without a reliable clause boundary we abstain from the rewrite.
  if (/\bbitte\b/iu.test(restTrim)) return null;
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
// Preserve the learner's definiteness and case whenever the observed article form makes the
// replacement unambiguous. A missing entry means: count the signal, but do not invent a rewrite.
// Examples: "dem Arbeit" → "der Arbeit" (dative); "eine System" → "ein System".
const SAFE_ARTICLE_REPLACEMENT = {
  das:   { f: 'die' },
  die:   { n: 'das' },
  den:   { f: 'die', n: 'das' },
  dem:   { f: 'der' },
  des:   { f: 'der' },
  eine:  { n: 'ein' },
  ein:   { f: 'eine' },
  einen: { f: 'eine', n: 'ein' },
  einem: { f: 'einer' },
  eines: { f: 'einer' },
};
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
    'subject-verb':   { key: 'subject-verb',   count: 0, examples: [] },
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
      // GUARD: if THIS subordinate clause already ends with a finite modal/aux, verb-final holds
      // ("weil ich arbeiten muss", "dass ich gehen möchte") → NOT an error. (Adversarial-corpus fix.)
      const _tail = text.slice(m.index).split(/[,.!?;:]/)[0];
      const _last = (_tail.match(/[\p{L}]+/gu) || []).pop() || '';
      if (MODAL_AUX_FINAL.has(_last.toLowerCase())) continue;
      hits['verb-final'].count++;
      const restShown = rest.replace(/[.,!?].*$/, '').trim().split(/\s+/).slice(0, 6).join(' ');
      const quote = `${conj} ${subj} ${verb} ${restShown}`.trim();
      const better = suggestVerbFinal(conj, subj, verb, rest);
      if (mayQuote && !hasLowConfOverlap(u, quote)) {
        hits['verb-final'].examples.push({ quote, better });
      }
    }

    // 2) subject–verb agreement (closed paradigms, explicit adjacent subject only)
    SUBJECT_VERB_RE.lastIndex = 0;
    while ((m = SUBJECT_VERB_RE.exec(text)) !== null) {
      const subject = m[1].toLocaleLowerCase('de-DE');
      const observed = m[2].toLocaleLowerCase('de-DE');
      const lemma = SUBJECT_VERB_FORM_INDEX.get(observed);
      const expected = SUBJECT_VERB_PARADIGMS[lemma]?.[subject];
      if (!expected || observed === expected || governedInfinitive(text, SUBJECT_VERB_RE.lastIndex, observed)) continue;
      hits['subject-verb'].count++;
      const quote = m[0];
      const better = `${m[1]} ${expected}`;
      if (mayQuote && !hasLowConfOverlap(u, quote)) {
        hits['subject-verb'].examples.push({ quote, better });
      }
    }

    // 3) article–gender (impossible-article-only, exact singular forms)
    ARTICLE_RE.lastIndex = 0;
    while ((m = ARTICLE_RE.exec(text)) !== null) {
      const article = m[1].toLowerCase();
      const noun = m[2];
      const gender = NOUN_GENDER[noun.toLowerCase()];
      if (!gender || GENDER_ARTICLES[gender].has(article)) continue;
      // Human-corpus guard: in "das Sprache Sprechen", the apparent noun is a modifier and
      // the article governs the following nominalized head. ASR spacing cannot resolve whether
      // the learner intended a compound, so this context is not evidence of an article error.
      if (/^\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]*/u.test(text.slice(ARTICLE_RE.lastIndex))) continue;
      hits['article-gender'].count++;
      const cap = noun.charAt(0).toUpperCase() + noun.slice(1).toLowerCase();
      const quote = `${m[1]} ${noun}`;
      if (mayQuote && !hasLowConfOverlap(u, quote)) {
        const replacement = SAFE_ARTICLE_REPLACEMENT[article]?.[gender] || null;
        hits['article-gender'].examples.push({ quote, better: replacement ? `${replacement} ${cap}` : null });
      }
    }

    // 4) P→B transcript artifacts
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
  'subject-verb': {
    title: 'Dein Muster: Subjekt und Verb müssen zusammenpassen',
    explain: 'Die Verbform muss zur Person passen: „ich bin“, „du bist“, „wir sind“. ' +
             'Übe Pronomen und Verbform immer zusammen, bis die Verbindung automatisch kommt.',
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
