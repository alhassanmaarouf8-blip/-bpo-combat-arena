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
  [/reflexiv/,                                                         'reflexive-verben'],
  [/dativ|akkusativ|kasus|genitiv|fallfehler|\bcase\b/,                'dativ-akkusativ'],
  [/trennbar|separable/,                                               'trennbare-verben'],
  [/passiv|passive/,                                                   'passiv'],
  [/futur/,                                                            'futur-1'],
  [/komparativ|superlativ|steigerung|comparison/,                      'komparativ-superlativ'],
  [/relativ/,                                                          'relativsaetze'],
  // Perfekt/participle BEFORE the generic tense bucket, or "zeitform" swallows every Perfekt slip.
  [/perfekt|partizip|participle|hilfsverb|auxiliary/,                  'perfekt'],
  [/präteritum|prateritum|imperfekt|zeitform|\btense\b/,               'praeteritum'],
  [/fragewort|w-?frage|frageform/,                                     'w-fragen'],
  [/negation|verneinung/,                                              'negation'],
  [/adjektiv|kongruenz|agreement|deklination|übereinstimmung/,         'adjektivendungen'],
  [/modalverb|modal_/,                                                 'modalverben'],
  [/präposition|praeposition|preposition/,                             'wechselpraepositionen'],
  [/imperativ|imperative/,                                             'imperativ-sie'],
  [/artikel|\barticle\b/,                                              'artikel-genus'],
  [/wortstellung|verbstellung|satzstellung|word_?order|wortreihenfolge|verbposition/, 'verbstellung-nebensatz'],
];

const MAX_PER_ITEM = 10; // bound: a single rule can't flood the tally

/**
 * @param {Array} grammar  the debrief grammar array (LanguageTool output for one fight)
 * @returns {string[]}     lesson ruleIds, one per error occurrence (repeats = frequency)
 */
// Deterministic Arabic explanations per canonical class (adversarial audit 2026-07-10): the Basic
// perk sells "Feedback auch auf Arabisch", but LanguageTool's messages are German and
// explanation_ar was hardcoded '' — an Arabic-mode user's core feedback rendered entirely in
// German (one screenshot from breaking a paid promise). Authored once, class-level, never
// LLM-translated; German grammar TERMS stay German on purpose (that's how Egyptian learners of
// German actually talk about them). Unmapped classes fall back to German honestly.
export const AR_EXPLANATIONS = {
  'konjunktiv-2':          'الصيغة المهذبة: استخدم "könnten Sie…" و"ich würde…" بدل الأمر المباشر — دي لغة الشغل المحترمة.',
  'reflexive-verben':      'الفعل ده محتاج ضمير انعكاسي زي "sich vorstellen" — متنساش الـ sich.',
  'dativ-akkusativ':       'الحالة (Kasus) مش مظبوطة: في أفعال وحروف جر بتاخد Dativ وتانية Akkusativ — راجع الفعل اللي قبلها.',
  'trennbare-verben':      'الفعل المنفصل بيتقسم: الجزء الأول بيروح آخر الجملة، زي "ich rufe Sie zurück".',
  'passiv':                'المبني للمجهول بيتكوّن بـ werden + Partizip II، زي "das wird geprüft".',
  'futur-1':               'المستقبل: werden + المصدر في آخر الجملة، زي "ich werde das prüfen".',
  'komparativ-superlativ': 'المقارنة والتفضيل: ‏-er / am …-sten، زي "schneller" و"am schnellsten".',
  'relativsaetze':         'جملة الوصل: الضمير (der/die/das) لازم يطابق الاسم، والفعل بيروح آخر الجملة.',
  'perfekt':               'الماضي بالـ Perfekt: ‏haben أو sein + Partizip II في آخر الجملة.',
  'praeteritum':           'زمن الفعل مش مظبوط هنا — راجع صيغة الماضي (war / hatte / musste).',
  'w-fragen':              'السؤال بكلمة W: كلمة الاستفهام الأول وبعدها الفعل، زي "Wie kann ich Ihnen helfen?".',
  'negation':              'النفي: ‏nicht مع الفعل والصفة، وkein مع الاسم النكرة.',
  'adjektivendungen':      'نهاية الصفة لازم تطابق الاسم في الجنس والحالة، زي "ein großes Problem".',
  'modalverben':           'الفعل الناقص (kann / muss / möchte) بيبعت المصدر لآخر الجملة.',
  'wechselpraepositionen': 'حرف الجر ده بيغيّر الحالة: مكان ثابت → Dativ، حركة واتجاه → Akkusativ.',
  'imperativ-sie':         'صيغة الطلب المهذبة: الفعل الأول + Sie، زي "Nennen Sie mir bitte…".',
  'artikel-genus':         'جنس الاسم (der/die/das) مش مظبوط — احفظ كل اسم مع أداته.',
  'verbstellung-nebensatz': 'بعد weil / dass / wenn الفعل بيروح آخر الجملة.',
};

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
