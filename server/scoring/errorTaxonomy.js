/**
 * errorTaxonomy.js — the OPEN, two-level error coding scheme for the deep diagnostic engine
 * (v2 Phase 2 spec, owner order 2026-07-20).
 *
 * Level 1: a FIXED set of top-level categories (below) — every error the analyzer reports must
 * carry one of these ids, so aggregation and the Phase-3 bottleneck selector have a stable axis.
 * Level 2: a FREE-TEXT subcode the analyzer invents itself ("nach_unbestimmtem_artikel_maskulin_akk"),
 * normalized here so the SAME issue maps to the SAME subcode across days. German has thousands of
 * possible issues; the subcode layer is how the system can name any of them without a hardcoded list.
 *
 * Deterministic + dependency-free. The taxonomy is data, not judgment: no scoring lives here.
 */

// ── Level 1: fixed top-level categories ────────────────────────────────────────────────────────
// `de` labels are learner-facing German. `ruleId` is the ADVISORY bridge to the existing brain
// canon (brain/problemRank.js, errorTags.js) — Phase 3 may use it to merge deep-analysis evidence
// into weakLog; nothing writes through it yet (weakLog stays single-writer: the debrief).
export const CATEGORIES = Object.freeze({
  ADJ_ENDUNG:               { de: 'Adjektivendungen',                     ruleId: 'adjektivendung' },
  KASUS:                    { de: 'Kasus (Akkusativ/Dativ/Genitiv)',      ruleId: 'dativ-akkusativ' },
  ARTIKEL_GENUS:            { de: 'Artikel & Genus (der/die/das)',        ruleId: 'artikel-genus' },
  VERB_POSITION:            { de: 'Verbstellung (V2, Verb am Ende)',      ruleId: 'word-order-sub' },
  VERB_KONJUGATION:         { de: 'Verbkonjugation',                      ruleId: 'verbkonjugation' },
  TEMPUS:                   { de: 'Zeitformen (Perfekt/Präteritum/…)',    ruleId: 'praesens-perfekt' },
  PRAEPOSITION:             { de: 'Präpositionen',                        ruleId: 'praeposition' },
  PLURAL:                   { de: 'Pluralbildung',                        ruleId: 'plural' },
  WORTSTELLUNG:             { de: 'Wortstellung (TeKaMoLo …)',            ruleId: 'wortstellung' },
  SATZBAU_NEBENSATZ:        { de: 'Satzbau & Nebensätze',                 ruleId: 'word-order-sub' },
  WORTSCHATZ_PRAEZISION:    { de: 'Wortschatz & Präzision',               ruleId: null },
  REGISTER_FORMALITAET:     { de: 'Register & Förmlichkeit (du/Sie)',     ruleId: 'konjunktiv-2' },
  FUELLWOERTER:             { de: 'Füllwörter (äh, ähm …)',               ruleId: null },
  SELBSTKORREKTUR_SCHLEIFEN:{ de: 'Selbstkorrektur-Schleifen (Neustarts)',ruleId: null },
  AUSSPRACHE:               { de: 'Aussprache',                           ruleId: 'pronunciation-phone' },
  FLUESSIGKEIT:             { de: 'Flüssigkeit',                          ruleId: 'fluency-interrupt' },
  ANTWORT_STRUKTUR:         { de: 'Antwortstruktur (Frage verfehlt/kein STAR)', ruleId: null },
  KOHAERENZ:                { de: 'Kohärenz (roter Faden)',               ruleId: null },
});

export const CATEGORY_IDS = Object.freeze(Object.keys(CATEGORIES));

// Categories that judge the WHOLE answer's shape, not a token inside it. On a turn the
// interviewer CUT OFF these are structurally unfair (doctrine law 7: never blame the learner
// for a gap the system caused) — the validator drops them for truncated turns. Token-level
// grammar inside a truncated fragment stays fair: those words were really spoken.
export const ANSWER_LEVEL_CATEGORIES = Object.freeze(new Set([
  'ANTWORT_STRUKTUR', 'KOHAERENZ', 'FLUESSIGKEIT', 'SELBSTKORREKTUR_SCHLEIFEN',
]));

// Model output arrives with umlauts, casing drift, or near-miss names. Deterministic repair
// first (canonical form), then aliases for the drifts we have actually seen. Unknown → null
// (the validator drops the error rather than guessing a category — honesty over coverage).
const CATEGORY_ALIASES = Object.freeze({
  'KOHÄRENZ': 'KOHAERENZ',
  'FÜLLWÖRTER': 'FUELLWOERTER',
  'REGISTER': 'REGISTER_FORMALITAET',
  'FORMALITAET': 'REGISTER_FORMALITAET',
  'ADJEKTIVENDUNG': 'ADJ_ENDUNG',
  'ADJEKTIV_ENDUNG': 'ADJ_ENDUNG',
  'ARTIKEL': 'ARTIKEL_GENUS',
  'GENUS': 'ARTIKEL_GENUS',
  'VERBSTELLUNG': 'VERB_POSITION',
  'KONJUGATION': 'VERB_KONJUGATION',
  'NEBENSATZ': 'SATZBAU_NEBENSATZ',
  'SATZBAU': 'SATZBAU_NEBENSATZ',
  'WORTSCHATZ': 'WORTSCHATZ_PRAEZISION',
  'STRUKTUR': 'ANTWORT_STRUKTUR',
  'SELBSTKORREKTUR': 'SELBSTKORREKTUR_SCHLEIFEN',
});

export function normalizeCategory(raw) {
  if (typeof raw !== 'string') return null;
  const up = raw.normalize('NFC').trim().toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/gi, 'SS')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (CATEGORIES[up]) return up;
  if (CATEGORY_ALIASES[up]) return CATEGORY_ALIASES[up];
  return null;
}

// ── Level 2: subcode normalization ─────────────────────────────────────────────────────────────
// Stability across days comes from this function, not from the model: lowercase, umlauts →
// ascii, everything non-alphanumeric → "_", collapsed, capped. Close variants we have observed
// get an explicit alias entry (grow this map as real drift shows up — it is the ONLY place a
// variant mapping may live, so drift fixes stay reviewable).
const SUBCODE_ALIASES = Object.freeze({
  'nach_unbestimmten_artikel_maskulin_akk': 'nach_unbestimmtem_artikel_maskulin_akk',
  'verb_am_ende_nebensatz_weil': 'verb_am_ende_nach_weil',
  'verb_ende_nach_weil': 'verb_am_ende_nach_weil',
});

export function normalizeSubcode(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return 'allgemein';
  const s = raw.normalize('NFC').trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 64).replace(/_+$/g, '');
  if (!s) return 'allgemein';
  return SUBCODE_ALIASES[s] || s;
}

/** Full code "CATEGORY/subcode" — the stable key error_events aggregate on. */
export function errorCode(category, subcode) {
  return `${category}/${normalizeSubcode(subcode)}`;
}

export default { CATEGORIES, CATEGORY_IDS, ANSWER_LEVEL_CATEGORIES, normalizeCategory, normalizeSubcode, errorCode };
