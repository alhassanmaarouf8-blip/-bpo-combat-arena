/**
 * errorTags.js — classify a fight's grammar errors into Trainingslager lesson ruleIds.
 *
 * PURE RULE-BASED: a keyword/regex map over the grammar-checker's own output (LanguageTool
 * rule id + category + German rule name + message). NO AI call, no LLM, no guessing beyond
 * these explicit patterns. Errors we aren't confident about are simply skipped — we never
 * invent a lesson tag.
 *
 * Output is a flat list of ruleIds with ONE entry per error occurrence, so the caller can
 * count exact frequency by tallying the list.
 */
import { hasLesson } from './lessons.config.js';

// First match wins. Patterns are matched (case-insensitively) against the combined text
// "<ltRuleId> <ltCategoryId> <rule> <explanation>" of each flagged grammar error.
const KEYWORD_MAP = [
  [/konjunktiv|subjunctive/,                                           'konjunktiv-2'],
  [/dativ|akkusativ|kasus|genitiv|fallfehler|\bcase\b/,                'dativ-akkusativ'],
  [/trennbar|separable/,                                               'trennbare-verben'],
  [/passiv|passive/,                                                   'passiv'],
  [/futur/,                                                            'futur-1'],
  [/komparativ|superlativ|steigerung|comparison/,                      'komparativ-superlativ'],
  [/relativ/,                                                          'relativsaetze'],
  [/präteritum|prateritum|imperfekt|zeitform|\btense\b/,               'praeteritum'],
  [/fragewort|w-?frage|frageform/,                                     'w-fragen'],
  [/negation|verneinung/,                                              'negation'],
  [/adjektiv|kongruenz|agreement|deklination|übereinstimmung/,         'adjektivendungen'],
  [/modalverb|modal_/,                                                 'modalverben'],
  [/artikel|\barticle\b/,                                              'dativ-akkusativ'],
  [/wortstellung|verbstellung|satzstellung|word_?order|wortreihenfolge|verbposition/, 'relativsaetze'],
];

const MAX_PER_ITEM = 10; // bound: a single rule can't flood the tally

/**
 * @param {Array} grammar  the debrief grammar array (LanguageTool output for one fight)
 * @returns {string[]}     lesson ruleIds, one per error occurrence (repeats = frequency)
 */
export function classifyGrammar(grammar) {
  const tags = [];
  for (const g of (Array.isArray(grammar) ? grammar : [])) {
    const hay = `${g?.ltRuleId || ''} ${g?.ltCategoryId || ''} ${g?.rule || ''} ${g?.explanation || ''}`.toLowerCase();
    const n = Math.max(1, Math.min(MAX_PER_ITEM, Number(g?.count) || (Array.isArray(g?.allExamples) ? g.allExamples.length : 1)));
    for (const [re, ruleId] of KEYWORD_MAP) {
      if (re.test(hay) && hasLesson(ruleId)) {
        for (let i = 0; i < n; i++) tags.push(ruleId);
        break; // first match wins
      }
    }
  }
  return tags;
}
