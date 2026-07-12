/**
 * claimLedger.js — deterministic self-CONTRADICTION detection for the interview boss.
 *
 * SCOPE NOTE (why this is small): the live realtimeClient.js ALREADY implements the candidate
 * claim-ledger CALLBACK ("reuse the candidate's exact word", this._ledger + _noteClaims) and the
 * rolling anti-repeat of the boss's own openers. Those are NOT re-implemented here. The one thing
 * the live path does not do — and a real HR interviewer always does — is catch a candidate
 * contradicting their own NUMBERS ("vorhin drei Jahre, jetzt fünf"). That is this module's only job.
 *
 * HONESTY DOCTRINE (owner law #2, mirrors l1Errors.js): pure/deterministic (no model judge);
 * captures ONLY from turns that are not low-confidence STT and not truncated (a mishear must never
 * be thrown back as a "lie"); prefers UNDERCLAIMING. Stores the candidate's verbatim substring so
 * the boss quotes them exactly. Authors no learner-facing German — realtimeClient composes the
 * directive and german-checks it.
 */

const NUM_WORD = {
  ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7,
  acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
};
// Countables where a changed number is a real contradiction worth naming (experience, team, load).
const UNIT = '(?:Jahre?n?|Monate?n?|Wochen?|Kunden?|Mitarbeitern?|Leute|Anrufe?n?)';
const NUMBER_CLAIM = new RegExp(
  `\\b(\\d{1,3}|ein|eine|einen|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\\s+(${UNIT})`,
  'gi',
);

export function createLedger() {
  return { numbers: [], callbacks: [] };
}

function _cleanNum(raw) {
  const n = raw.trim().toLowerCase();
  return /^\d+$/.test(n) ? parseInt(n, 10) : (NUM_WORD[n] ?? null);
}
// canonical unit bucket so "Jahr"/"Jahre"/"Jahren" sit on the SAME axis.
function _unitKey(u) {
  const s = u.toLowerCase();
  if (s.startsWith('jahr')) return 'jahr';
  if (s.startsWith('monat')) return 'monat';
  if (s.startsWith('woche')) return 'woche';
  if (s.startsWith('kund')) return 'kunde';
  if (s.startsWith('mitarbeiter')) return 'mitarbeiter';
  if (s.startsWith('leute')) return 'leute';
  if (s.startsWith('anruf')) return 'anruf';
  return s;
}

/** Extract numeric claims from ONE candidate turn `{ text, lowConf?, truncated? }`. Gated → []. */
export function extractNumberClaims(turn = {}) {
  const text = typeof turn === 'string' ? turn : (turn.text || '');
  if (!text || turn.lowConf || turn.truncated) return [];
  const out = [];
  for (const m of text.matchAll(NUMBER_CLAIM)) {
    const value = _cleanNum(m[1]);
    if (value == null) continue;
    out.push({ value, unit: _unitKey(m[2]), raw: m[0].trim() });
  }
  return out;
}

/** Accumulate a candidate turn's numeric claims into the ledger. */
export function noteTurn(ledger, turn, turnIndex = 0) {
  for (const c of extractNumberClaims(turn)) {
    ledger.numbers.push({ ...c, turnIndex });
  }
  const text = typeof turn === 'string' ? turn.trim() : String(turn?.text || '').trim();
  // Callback memory is deliberately conservative: never quote uncertain/truncated speech,
  // one-word filler, or a named employer. The boss may reuse a candidate's substantive own words,
  // but must not repeat a company name from private work history.
  if (!turn?.lowConf && !turn?.truncated && text.split(/\s+/).length >= 4
      && !/\bbei\s+[A-ZÃ„Ã–Ãœ][\p{L}\d&.-]*/u.test(text)) {
    ledger.callbacks.push({ raw: text.slice(0, 180), turnIndex });
    if (ledger.callbacks.length > 6) ledger.callbacks.shift();
  }
  return ledger;
}

/** Return the most recent safe, substantive candidate phrase for a natural callback. */
export function pickCallback(ledger) {
  if (!ledger?.callbacks?.length) return null;
  return ledger.callbacks[ledger.callbacks.length - 1];
}

/**
 * Return the FIRST self-contradiction on a numeric axis, or null.
 * Fires only across DIFFERENT turns with DIFFERENT values on the SAME unit (restating the same
 * number is not a lie). Shape: { unit, earlier:{value,raw,turnIndex}, now:{value,raw,turnIndex} }.
 */
export function findContradiction(ledger) {
  if (!ledger || !ledger.numbers) return null;
  const firstByUnit = new Map();
  for (const c of ledger.numbers) {
    const prev = firstByUnit.get(c.unit);
    if (prev && prev.value !== c.value && prev.turnIndex !== c.turnIndex) {
      return { unit: c.unit, earlier: prev, now: c };
    }
    if (!prev) firstByUnit.set(c.unit, c);
  }
  return null;
}
