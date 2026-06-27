/**
 * abuseDetector.js — deterministic, multilingual classifier for candidate abuse/disrespect
 * aimed at the interview boss. Used by websocketManager._handleAnswer to drive a REAL
 * HR reaction: severity 1 (mild) → in-character warning + continue; severity 2 (serious)
 * → professional in-character termination of the interview.
 *
 * WHY deterministic (not LLM-judged): the "end the call" decision touches billing + the
 * debrief end-path and must be reliable; a 70B model often stays polite and won't actually
 * stop. The LLM still OWNS the in-character *wording* of the reaction (see realtimeClient
 * _warningInstruction/_terminationInstruction) — this only decides the tier.
 *
 * SCOPE: only UNAMBIGUOUS insults/curses directed at a person, with word boundaries on
 * Latin scripts to avoid false-positives on a nervous learner. Arabic has no \b word
 * boundary, so those patterns are written to match the insult token explicitly.
 *
 * ⚠️ HUMAN-GATE (feedback-accuracy-doctrine): the Arabic/Egyptian list below should be
 * reviewed/expanded by the owner (native speaker) before full trust. Kept conservative.
 */

// Severity 2 — serious abuse → terminate the interview professionally.
const SERIOUS = [
  // German
  /\b(fick\s*dich|verpiss\s*dich|halt(?:'s|s)?\s*maul|hurensohn|wichser|arschloch|fotze|schlampe|mistst(?:ü|ue)ck|leck\s*mich)\b/i,
  // English
  /\b(fuck\s*you|fuck\s*off|shut\s*the\s*fuck\s*up|asshole|a\s*hole|bitch|bastard|son\s*of\s*a\s*bitch|dickhead|motherfucker)\b/i,
  // Arabic / Egyptian dialect — explicit curses directed at a person
  /(ابن\s*ال?كلب|يا\s*كلب|يا\s*حمار|يا\s*خرا|كس\s*ام|كسم|متناك|يا\s*ابن\s*ال?\S*|اخرس|انقلع|يا\s*حقير|يا\s*قذر|تبا\s*لك|يلعن|ابن\s*ال?ـ?وسخة|ابن\s*المتناكة|عرص|يا\s*عرص|خول|يا\s*خول)/i,
];

// Severity 1 — mild rudeness/dismissiveness → one in-character warning, then continue.
const MILD = [
  /\b(idiot|du\s*bist\s*dumm|bl(?:ö|oe)d|halt\s*die\s*klappe|l(?:ä|ae)cherlich|stupid|nonsense|quatsch|shut\s*up)\b/i,
  /(انت\s*غبي|غبي\s*انت|اخرسي|بطل\s*هبل|كلام\s*فارغ|انت\s*مغفل|سخيف|تافه)/i,
];

/**
 * @param {string} text candidate's transcribed/typed answer
 * @returns {0|1|2} 0 = clean, 1 = mild, 2 = serious
 */
export function classifyAbuse(text) {
  const t = String(text || '');
  if (!t.trim()) return 0;
  if (SERIOUS.some((r) => r.test(t))) return 2;
  if (MILD.some((r) => r.test(t)))    return 1;
  return 0;
}

export default { classifyAbuse };
