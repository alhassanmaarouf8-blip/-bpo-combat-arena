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
