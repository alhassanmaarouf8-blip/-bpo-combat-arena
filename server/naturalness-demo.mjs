/**
 * naturalness-demo.mjs — proves the isolated naturalness modules compose into HUMAN behaviour,
 * WITHOUT touching the live realtime path. Run: `node server/naturalness-demo.mjs`
 *
 * It simulates a short interview: for each candidate turn it updates the claimLedger, then shows
 * what the boss WOULD do on its next turn — reuse the candidate's exact words (callback), catch a
 * self-contradiction, and refuse to open the same way twice / with a worn cliché.
 * Read-only demonstration; changes nothing in the app.
 */
import { createLedger, noteTurn, pickCallback, findContradiction } from './claimLedger.js';
import { stripWornOpener, createVarietyState, isRepeatOpener, noteBossTurn } from './bossVariety.js';

const candidateTurns = [
  'Ich habe drei Jahre Erfahrung im technischen Support.',
  'Einmal hatte ich einen schwierigen Kunden, der sehr wütend war.',
  'Ich habe als Kundenberater bei einer großen Firma gearbeitet.',
  'Also insgesamt fünf Jahre, wenn ich alles zusammenrechne.', // contradicts "drei Jahre"
];

// what the RAW model might produce (robotic) vs what the modules fix:
const rawBossOpenings = [
  'Das ist interessant. Warum haben Sie gewechselt?',
  'Und wie haben Sie reagiert?',
  'Und wie haben Sie das gelöst?',   // repeats "Und wie haben" → should be flagged
  'Verstehe. Erzählen Sie weiter.',
];

const ledger = createLedger();
const variety = createVarietyState(4);

console.log('=== NATURALNESS DEMO — the boss behaves like a person ===\n');
candidateTurns.forEach((text, i) => {
  noteTurn(ledger, { text }, i);
  console.log(`Kandidat (Turn ${i}): "${text}"`);

  // 1) worn-opener strip + anti-repeat on the raw boss opening
  const raw = rawBossOpenings[i];
  const stripped = stripWornOpener(raw);
  const repeat = isRepeatOpener(variety, stripped.text);
  if (stripped.removed) console.log(`   • opener hygiene: dropped cliché "${stripped.removed}" → "${stripped.text}"`);
  if (repeat) console.log(`   • anti-repeat: boss already opened this way → force a DIFFERENT opening`);
  noteBossTurn(variety, stripped.text);

  // 2) memory: callback + contradiction
  const contra = findContradiction(ledger);
  if (contra) {
    console.log(`   • CONTRADICTION caught: earlier "${contra.earlier.raw}" vs now "${contra.now.raw}" `
      + `→ boss says: "Sie sagten vorhin ${contra.earlier.value} ${contra.unit.charAt(0).toUpperCase()+contra.unit.slice(1)}e, jetzt ${contra.now.value}?"`);
  } else {
    const cb = pickCallback(ledger);
    if (cb) console.log(`   • CALLBACK: boss reuses the candidate's own words → weave "${cb.raw}" into the next question`);
  }
  console.log('');
});
console.log('=== end demo — none of the live interview code was touched ===');
