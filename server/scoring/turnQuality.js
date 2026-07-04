/**
 * turnQuality.js — deterministic, $0 signals about whether a candidate turn was CUT OFF /
 * fragmentary, and whether the whole session is too thin to judge fairly.
 *
 * WHY: the half-duplex, silence-timer interview can end a candidate's turn mid-sentence, so an
 * interrupted answer is stored identically to a freely-chosen short one. Every downstream scorer
 * then reads "the app cut him off" as "he froze / has no result / can't produce German" and
 * blames the learner for the system's bug — the exact false, demoralizing feedback the accuracy
 * doctrine forbids. These pure functions give the coach and the CEFR grader a way to tell the two
 * apart, from the TEXT alone (no new plumbing, no model call).
 *
 * Bias on purpose: it is doctrinally SAFER to mark a complete answer as "maybe truncated" (we then
 * merely SKIP a critique) than to invent a false critique on a cut-off fragment. So the detector
 * leans slightly toward flagging — but stays precise enough that normal complete answers pass.
 */

// German tokens that cannot legitimately END a finished main clause — if a turn ends here (and
// wasn't closed with terminal punctuation), it was almost certainly cut off mid-thought.
const DANGLING = new Set([
  // auxiliaries / modals left hanging without their participle/infinitive ("Wir haben" …)
  'habe', 'hab', 'haben', 'hast', 'hat', 'hatte', 'hatten', 'bin', 'bist', 'ist', 'sind', 'seid',
  'war', 'waren', 'wird', 'werde', 'werden', 'wirst', 'wurde', 'wurden',
  'kann', 'kannst', 'können', 'könnte', 'muss', 'musst', 'müssen', 'musste', 'will', 'willst',
  'wollen', 'wollte', 'soll', 'sollst', 'sollen', 'sollte', 'möchte', 'möchten', 'würde', 'würden',
  'hätte', 'hätten', 'wäre', 'wären', 'darf', 'mag',
  // conjunctions (coordinating + subordinating) that must be followed by more
  'und', 'oder', 'aber', 'weil', 'dass', 'wenn', 'denn', 'sondern', 'obwohl', 'damit', 'sodass',
  'als', 'sowie', 'bzw',
  // articles / determiners expecting a noun
  'der', 'die', 'das', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'den', 'dem', 'des',
  'mein', 'meine', 'meinen', 'meinem', 'sein', 'ihre', 'ihren', 'kein', 'keine',
  // common prepositions expecting an object
  'mit', 'für', 'zu', 'zur', 'zum', 'in', 'im', 'an', 'am', 'auf', 'bei', 'beim', 'von', 'vom',
  'aus', 'über', 'unter', 'nach', 'vor', 'um', 'gegen', 'ohne', 'durch', 'seit', 'bis', 'wegen',
]);

// Complete minimal answers — a bare "Ja"/"Nein"/"Gerne" is a finished reply, not a cut-off scrap.
const COMPLETE_SHORT = new Set(['ja', 'nein', 'doch', 'gerne', 'klar', 'natürlich', 'richtig', 'genau', 'okay', 'ok', 'danke', 'bitte', 'sicher', 'einverstanden']);

// Subject pronouns: "…habe ich" / "…hat er" left hanging after an auxiliary = mid-clause cut-off
// (the participle/object never came), e.g. "und dann habe ich" → "…habe ich [das gemacht]".
const PRONOUN_END = new Set(['ich', 'er', 'sie', 'es', 'wir', 'ihr', 'du', 'man', 'mir', 'mich', 'ihm', 'ihn', 'uns']);

const wordsOf = (s) => (String(s || '').trim().match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []);

/**
 * Does this candidate utterance look CUT OFF mid-thought (vs. a complete, freely-ended answer)?
 * Pure function of the text. Conservative toward flagging fragments; complete answers pass.
 */
export function looksTruncatedDE(text) {
  const t = String(text || '').trim();
  if (!t) return false;                                   // empty is "no answer", handled elsewhere
  const toks = wordsOf(t);
  if (!toks.length) return false;
  const last = toks[toks.length - 1].toLowerCase();
  const n = toks.length;
  // terminal punctuation at the very end = the speaker (or STT) closed the sentence
  const hasTerminal = /[.!?…]["'”“„]?\s*$/.test(t);
  const dangles = DANGLING.has(last);

  if (hasTerminal) {
    // A closed sentence is normally complete — but STT sometimes stamps a period onto a short
    // fragment ("Wir haben."). Only then, on a hard-dangling short fragment, still call it cut off.
    return dangles && n <= 5;
  }
  // No terminal punctuation: a hanging function word, or a 1–2 word scrap, reads as interrupted.
  if (dangles) return true;
  // "…habe ich" / "…hat er": auxiliary + trailing pronoun with nothing after = cut off mid-clause.
  if (n >= 2 && PRONOUN_END.has(last) && DANGLING.has(toks[n - 2].toLowerCase())) return true;
  if (n === 1 && COMPLETE_SHORT.has(last)) return false;   // bare "Ja"/"Nein"/"Gerne" is a finished reply
  if (n <= 2)  return true;
  return false;
}

// Tunable thresholds for "too thin / too broken to give a confident hireability verdict".
export const SUBSTANCE = { MIN_WORDS: 25, MIN_COMPLETE_TURNS: 2, MIN_TURN_WORDS: 6, MAX_TRUNCATED_SHARE: 0.6 };

// Deepgram word-confidence below this = the recognizer wasn't sure it heard the word right (an
// English tech term, a name, or plain noise) → likely a mis-transcription like "Python"→"Pariethon".
export const LOW_CONFIDENCE = 0.55;

// ── SHADES OF GRAY (owner 2026-07-04: "not black and white — grade the total like a human, not a
// machine") ────────────────────────────────────────────────────────────────────────────────────
// A hard threshold makes a 0.54-confidence word worthless and a 0.56 word fully counted — a cliff no
// human has. `confidenceWeight` maps a raw Deepgram confidence (0..1) to a CONTINUOUS trust weight,
// so an unclear word contributes a light-gray shade, never all-or-nothing. A logistic centred at
// ~0.6 keeps the ends soft (very-unsure ≈ 0, clear ≈ 1) and the middle a real gradient.
export function confidenceWeight(confidence) {
  const c = typeof confidence === 'number' && isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
  return 1 / (1 + Math.exp(-(c - 0.6) * 9));
}

// How much a single detected mistake should count toward the total — the human "how bad was it,
// really?" blend, on a 0..1 continuum instead of a checkbox:
//   severity   0..1  did it BLOCK understanding? (wrong article ≈ 0.15; unintelligible ≈ 0.9)
//   confidence 0..1  raw STT confidence that we even heard it right (→ confidenceWeight)
//   recurrence 1..n  how many times this same mistake appeared this session (a pattern weighs more)
// A one-off, low-confidence, meaning-preserving slip ≈ a whisper; a repeated, clear, meaning-blocking
// error ≈ full weight. Never 0 (ignored) and never a flat "−1 per error".
export function errorWeight({ severity = 0.5, confidence = 0.8, recurrence = 1 } = {}) {
  const sev = Math.max(0, Math.min(1, severity));
  const cw  = confidenceWeight(confidence);
  const rec = 1 - Math.pow(0.6, Math.max(1, recurrence));   // 1×→0.40, 2×→0.64, 3×→0.78, →1 (saturating)
  return sev * cw * rec;
}

/** Lowercased words in a Deepgram [{word, confidence}] list that the recognizer was unsure about. */
export function lowConfidenceWords(words, threshold = LOW_CONFIDENCE) {
  const out = [];
  for (const w of (Array.isArray(words) ? words : [])) {
    if (typeof w?.confidence === 'number' && w.confidence < threshold) {
      const t = String(w.word || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (t) out.push(t);
    }
  }
  return out;
}

/** Does a quote contain any token the recognizer was unsure about? (→ don't show it back as "you said X"). */
export function quoteHasLowConfidence(quote, lowConfSet) {
  if (!lowConfSet || (lowConfSet.size ?? 0) === 0) return false;
  for (const tok of wordsOf(quote)) if (lowConfSet.has(tok.toLowerCase())) return true;
  return false;
}

/**
 * Aggregate whether a session has enough CLEAN, complete speech to fairly judge interview quality.
 * `tooThinToJudge` → show honest metrics + grammar, but no manufactured per-answer critique / verdict.
 */
export function sessionSubstance(utterances) {
  const utts = Array.isArray(utterances) ? utterances : [];
  let realWords = 0, completeTurns = 0, truncatedTurns = 0, spoken = 0;
  for (const u of utts) {
    const text = u?.text || '';
    const n = (typeof u?.words === 'number' && u.words > 0) ? u.words : wordsOf(text).length;
    if (n <= 0) continue;
    spoken += 1;
    realWords += n;
    const cut = looksTruncatedDE(text);
    if (cut) truncatedTurns += 1;
    else if (n >= SUBSTANCE.MIN_TURN_WORDS) completeTurns += 1;
  }
  const truncatedShare = spoken ? truncatedTurns / spoken : 0;
  const tooThinToJudge =
    completeTurns < SUBSTANCE.MIN_COMPLETE_TURNS ||
    realWords < SUBSTANCE.MIN_WORDS ||
    (spoken >= 2 && truncatedShare >= SUBSTANCE.MAX_TRUNCATED_SHARE);
  return { realWords, completeTurns, truncatedTurns, spoken, truncatedShare, tooThinToJudge };
}

// ── Corrected-sentence trust gate (owner-reported 2026-07-02: Sag es richtig showed a "correct"
// answer that was itself broken German — "…ab ab anfangen, normalerweise ich" trailing off with a
// raw stutter left in) ────────────────────────────────────────────────────────────────────────
// WHY looksTruncatedDE didn't catch it: that detector is tuned to decide whether to CRITIQUE a
// live interview turn at all — its dangling-word lexicon (auxiliaries/conjunctions/prepositions)
// doesn't cover every way a sentence can trail off (e.g. "…normalerweise ich" — an adverb+pronoun
// with nothing after). grammarCheck.js builds its "right" (corrected) sentence by patching ONLY the
// one span LanguageTool flagged and reusing the REST of the original utterance verbatim — so any
// OTHER defect already in that utterance (a stutter, an unfinished trailing clause) rides along
// into what gets shown and stored as "the correct answer to learn." This is a stricter, separate
// gate for exactly that promotion: a sentence is only trustworthy as a MODEL ANSWER (debrief
// "Richtig:" display, and the Sag-es-richtig SRS drill target) if it has no immediate word-stutter
// AND doesn't look cut off by the existing turn doctrine.
// Deliberately broad: a rare, genuinely intentional emphatic double ("sehr sehr gerne") also trips
// this and gets rejected. That is the correct trade-off, not a bug — per this file's own doctrine,
// it is far safer to occasionally fall back to a generic prompt than to ever promote a sentence
// with a real disfluency stutter ("ab ab") as "the correct answer to learn."
const STUTTER = /\b(\p{L}{2,})\b(?:\s+\1\b)+/giu;   // the same word repeated back-to-back (case-insensitive)

/** Safe to promote `s` as a MODEL/correct answer (debrief "Richtig:", SRS drill target)? */
export function looksLikeTrustworthyCorrection(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  STUTTER.lastIndex = 0;
  if (STUTTER.test(t)) return false;      // a raw stutter is never a genuine correction
  return !looksTruncatedDE(t);            // reuse the existing cut-off doctrine
}

export default { looksTruncatedDE, sessionSubstance, SUBSTANCE, lowConfidenceWords, quoteHasLowConfidence, LOW_CONFIDENCE, looksLikeTrustworthyCorrection };
