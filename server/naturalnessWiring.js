/**
 * naturalnessWiring.js — the integration layer that turns the isolated naturalness modules
 * (claimLedger + bossVariety) into ONE per-session state and ONE boss directive. This is the
 * "hard part" of the wiring, done + tested here so the change inside the live realtimeClient.js
 * is only two lines (create the state; call the helpers around respond()).
 *
 * Deterministic, self-contained (imports only the two tested modules). Authors German ONLY as an
 * internal SYSTEM directive to the boss model (never learner-facing copy); the interviewer's actual
 * spoken German is still its own generation and still passes german-check downstream.
 *
 * LIVE WIRING (the 2-line change in realtimeClient.js, when its WIP is clean):
 *   constructor:  this._nat = createNaturalnessState();
 *   respond():    onCandidateTurn(this._nat, { text: userText, lowConf, truncated }, this._turnIdx);
 *                 const dir = buildBossDirective(this._nat); if (dir) turnMsgs.push({ role:'system', content: dir });
 *   after boss speaks:  onBossTurn(this._nat, bossText);   // strips clichés + feeds anti-repeat
 */
import { createLedger, noteTurn, pickCallback, findContradiction } from './claimLedger.js';
import {
  createVarietyState, stripWornOpener, noteBossTurn, recentOpenerSignatures,
} from './bossVariety.js';

export function createNaturalnessState(varietyWindow = 4) {
  return { ledger: createLedger(), variety: createVarietyState(varietyWindow) };
}

/** Record a candidate turn into memory (call before the boss responds). */
export function onCandidateTurn(state, turn, turnIndex = 0) {
  noteTurn(state.ledger, turn, turnIndex);
  return state;
}

/**
 * Build the ONE system directive that makes the boss's NEXT turn feel human:
 *   - CONTRADICTION (highest priority) → address it naturally,
 *   - else CALLBACK → reuse the candidate's own exact words,
 *   - always → don't repeat a recent opening / no worn filler.
 * Returns a German directive string, or null if there's nothing to add yet.
 */
export function buildBossDirective(state) {
  const parts = [];
  const contra = findContradiction(state.ledger);
  if (contra) {
    parts.push(
      `Der Kandidat hat sich widersprochen: vorhin „${contra.earlier.raw}“, jetzt „${contra.now.raw}“. `
      + `Sprich das ruhig und natürlich an, zum Beispiel „Sie sagten vorhin …“.`,
    );
  } else {
    const cb = pickCallback(state.ledger);
    if (cb) {
      parts.push(
        `Beziehe dich in deiner nächsten Frage natürlich auf die eigenen Worte des Kandidaten: „${cb.raw}“.`,
      );
    }
  }
  const avoid = recentOpenerSignatures(state.variety);
  if (avoid.length) {
    parts.push(
      `Beginne deine Antwort NICHT wieder mit: ${avoid.map((a) => `„${a}“`).join(', ')}. `
      + `Keine Floskel wie „Das ist interessant“ — steig direkt ein.`,
    );
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * Process the boss's produced turn: strip a leading worn opener and record the (cleaned) opening
 * for anti-repeat. Returns the cleaned text to actually speak/show.
 */
export function onBossTurn(state, bossText = '') {
  const stripped = stripWornOpener(bossText);
  noteBossTurn(state.variety, stripped.text);
  return stripped.text;
}
