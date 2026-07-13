/**
 * langGuard.js — deterministic, $0 guard against LLM script-drift.
 *
 * WHY: several drills generate fresh content every round via a Groq chat model (listening.js,
 * shadowing.js, fluencyDrill.js). Under generation pressure, a small/quantized model occasionally
 * emits a stray token in the WRONG SCRIPT — Chinese, Cyrillic, Thai, Devanagari — mixed into what
 * is supposed to be German or Arabic. The existing validators only checked shape (length, required
 * fields), never that the text is actually the language it claims to be — so a glitched item could
 * reach a learner as "garbage that isn't English, Arabic, or German" (owner-reported, 2026-07-02).
 *
 * This is a character-range check, not a model call: $0, instant, no false negatives on real
 * German/Arabic (which never contain these ranges), and it can only ever REJECT — a rejected item
 * falls back to the existing curated pool, exactly like any other generation failure already does.
 */

// Scripts that must NEVER appear in German or Arabic learner-facing text. If any of these hit,
// the string is definitely not clean German/Arabic and must be rejected outright.
const FOREIGN_SCRIPT = /[一-鿿぀-ヿ가-힯฀-๿ऀ-ॿЀ-ӿ]/;
const ARABIC_SCRIPT   = /[؀-ۿ]/;

/** A German (or English/idiomatic-Latin) field: reject any foreign script AND any Arabic —
 *  Arabic leaking into a "de" field is the same class of generation glitch (mixed-language). */
export function isCleanGermanText(s) {
  const t = String(s ?? '');
  if (!t.trim()) return false;
  if (FOREIGN_SCRIPT.test(t)) return false;
  if (ARABIC_SCRIPT.test(t)) return false;
  return true;
}

/** An Arabic field: Arabic script is expected, but several callers fall back to the German text
 *  when translation is empty — so Latin is also fine here. Only the definitely-wrong scripts
 *  (CJK/Cyrillic/Thai/Devanagari) are rejected. */
export function isCleanArabicOrGermanText(s) {
  const t = String(s ?? '');
  if (!t.trim()) return false;
  return !FOREIGN_SCRIPT.test(t);
}

// ── Same-script dialect drift (the gap this file admits above) ────────────────────────────────
// Character-range checks can't tell Cairo masri from formal MSA/fusha — but the LLM debrief
// (coach.js _ar fields) is explicitly prompted for عامية مصرية, so formal-Arabic markers in its
// output mean the model DISOBEYED and produced stiff, less-trustworthy Arabic for an Egyptian
// learner (the fake-masri class the owner worries about). This is a WORD-list heuristic, not a
// model call: it flags high-confidence formal markers a Cairo native avoids in casual coaching.
// Non-destructive by design — callers use it to LOG/measure drift, not to blank real feedback.
// (Sourced from the owner's own coach.js anti-fusha rules + scripts/masri-check.mjs.)
const FORMAL_AR_MARKERS = [
  'الذي', 'التي', 'الذين', 'لأنّ', 'لأن ', 'كي ', 'ماذا', 'لماذا', 'كيف ', 'الآن', 'سوف ',
  'ليس ', 'يجب أن', 'ينبغي', 'يمكنك أن', 'نستطيع', 'تريد', 'هكذا', 'عندما', 'أيضاً', 'أيضًا',
  'كذلك', 'إنّ ', 'قد قمت', 'بفضل', 'اختتم',
];

/** Count formal-MSA markers in a string (0 = looks like clean masri by this heuristic). */
export function formalArabicMarkers(s) {
  const t = String(s ?? '');
  if (!ARABIC_SCRIPT.test(t)) return [];
  return FORMAL_AR_MARKERS.filter((m) => t.includes(m));
}

/** True if the string carries formal-MSA markers — i.e. probable dialect drift away from masri. */
export function hasFormalArabicDrift(s) {
  return formalArabicMarkers(s).length > 0;
}

// ── Scrubbing (for surfaces where REJECTING isn't possible) ───────────────────────────────────
// The drills above can reject a glitched item and fall back to a curated pool. But the DEBRIEF,
// the BOSS's live streamed turn, the assessment verdict etc. have no pool to fall back to — the
// text is one-of-a-kind and mostly fine except for the stray glyph ("兄" inside an Arabic reply,
// owner-reported live 2026-07-02). For those, the safe deterministic move is to STRIP the
// foreign-script characters (plus the U+FFFD replacement char) and tidy the whitespace: real
// German/Arabic never contains these ranges, so scrubbing can only remove glitch glyphs, never
// meaning. NOTE the honest limit: same-script drift (Latin "aku", Arabic-script Farsi) is
// invisible to any character-range check — that class needs a different tool.
const SCRUB      = /[一-鿿぀-ヿ가-힯฀-๿ऀ-ॿЀ-ӿ�]/g;
const SCRUB_TEST = /[一-鿿぀-ヿ가-힯฀-๿ऀ-ॿЀ-ӿ�]/;    // no `g` — a global regex's test() mutates lastIndex

/** Remove foreign-script glyphs from one string; collapse the whitespace scars left behind. */
export function scrubForeignScript(s) {
  const t = String(s ?? '');
  if (!SCRUB_TEST.test(t)) return t;   // fast path: nothing to scrub
  return t.replace(SCRUB, '').replace(/ {2,}/g, ' ').replace(/^ +| +$/gm, '');
}

/** Walk any parsed-JSON value (object/array/string) and scrub EVERY string in place-of.
 *  Non-string leaves pass through untouched. Use at the parse boundary of learner-facing
 *  LLM JSON (debrief, assessment, plan) — one line, covers every field incl. _ar. */
export function scrubStringsDeep(v) {
  if (typeof v === 'string') return scrubForeignScript(v);
  if (Array.isArray(v)) return v.map(scrubStringsDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = scrubStringsDeep(v[k]);
    return out;
  }
  return v;
}
