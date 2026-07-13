/**
 * bossVariety.js — deterministic anti-repetition for the interviewer's WORDS (naturalness Lane 1).
 *
 * Two robotic tells this kills:
 *   1. WORN OPENERS — the boss starting turn after turn with a filler cliché ("Das ist interessant",
 *      "Verstehe", "Gut", …). A real HR person almost never does this. We detect + strip a leading
 *      worn opener so the boss's turn starts on its real content.
 *   2. SELF-REPETITION — the boss opening several turns with the same first few words. We keep a
 *      rolling window of the boss's own recent opening "signatures" so the wiring can tell the boss
 *      to avoid them next turn (like TURN_RULE) and can strip/flag a detected repeat.
 *
 * Pure + deterministic (NO model judge) → testable and fair. Authors no German of its own; the
 * WORN_OPENERS list is for DETECTION only and never becomes learner-facing copy. Wiring
 * (realtimeClient.respond) composes any German directive and runs german-check there.
 *
 * Intended wiring (later, realtimeClient.js): after the boss produces a turn →
 *   let t = stripWornOpener(text).text; noteBossTurn(state, t);
 *   next turn, push a system directive listing recentOpenerSignatures(state) as "nicht so anfangen".
 */

// Leading fillers the boss overuses. Matched case-insensitively at the START of a turn only,
// optionally followed by punctuation. Curated to worn INTERVIEWER fillers — NOT real content.
const WORN_OPENERS = [
  'das ist interessant',
  'interessant',
  'sehr interessant',
  'ich verstehe',
  'verstehe',
  'ich sehe',
  'gut',
  'sehr gut',
  'okay',
  'ok',
  'alles klar',
  'in ordnung',
  'schön',
  'das freut mich',
  'aha',
  'ach so',
  'genau',
  'natürlich',
  'sicher',
];
// Longest-first so "das ist interessant" is tried before "interessant".
const _OPENERS_SORTED = [...WORN_OPENERS].sort((a, b) => b.length - a.length);

/** Return the worn opener phrase found at the start of `text`, or null. */
export function detectWornOpener(text = '') {
  const t = String(text).replace(/^[\s"„»]+/, '').toLowerCase();
  for (const op of _OPENERS_SORTED) {
    // opener must be a whole leading unit: followed by end, space+, or punctuation.
    if (t === op || t.startsWith(op + ' ') || /^[.,;:!?…]/.test(t.slice(op.length))) {
      if (t.startsWith(op)) return op;
    }
  }
  return null;
}

/**
 * Strip a single leading worn opener (plus its trailing punctuation/space) from `text`.
 * Returns { text, removed }. If nothing worn leads, text is unchanged and removed=null.
 * Never returns empty: if the turn was ONLY the opener, the original text is kept.
 */
export function stripWornOpener(text = '') {
  const removed = detectWornOpener(text);
  if (!removed) return { text: String(text), removed: null };
  const lead = String(text).match(/^[\s"„»]*/)[0];
  const rest = String(text).slice(lead.length);
  // drop the opener + any immediately following punctuation and whitespace
  const after = rest.slice(removed.length).replace(/^[\s.,;:!?…–-]+/, '');
  if (!after) return { text: String(text), removed: null }; // opener was the whole turn → keep it
  // re-capitalise the new first letter for clean German
  const cleaned = after.charAt(0).toUpperCase() + after.slice(1);
  return { text: cleaned, removed };
}

// ── rolling anti-repeat of the boss's OWN openings ──────────────────────────────────────
export function createVarietyState(windowSize = 4) {
  return { window: windowSize, recent: [] };
}

// signature = first 3 content words, lowercased, punctuation-stripped.
function _signature(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

/** Has the boss opened a recent turn the same way? (before you record the current one) */
export function isRepeatOpener(state, text = '') {
  if (!state || !state.recent.length) return false;
  const sig = _signature(text);
  return sig.length > 0 && state.recent.includes(sig);
}

/** Record a boss turn's opening signature into the rolling window. */
export function noteBossTurn(state, text = '') {
  if (!state) return state;
  const sig = _signature(text);
  if (!sig) return state;
  state.recent.push(sig);
  while (state.recent.length > state.window) state.recent.shift();
  return state;
}

/** The recent opening signatures the boss should avoid repeating next turn. */
export function recentOpenerSignatures(state) {
  return state ? [...state.recent] : [];
}

export { WORN_OPENERS };
