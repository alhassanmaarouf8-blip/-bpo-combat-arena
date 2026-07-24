/**
 * drillLockVisibility.test.mjs — the Übungen paid boundary must be VISIBLE and must fail OPEN.
 *
 * Before this shipped: all five drills 402 server-side (listening/fluencyDrill/shadowing/
 * spokenReview/satzbauSchmiede) while `entitlement.drillsUnlocked` — computed in auth.js — had
 * ZERO uses anywhere in client/src. A free user tapped a tile, the overlay opened, the server
 * refused, the overlay slammed shut and a paywall appeared with no stated reason. It read as a
 * bug rather than an offer.
 *
 * Two properties are locked here, in priority order:
 *   1. FAIL OPEN (revenue-critical). The lock is driven by a STRICT `=== false`. Rewriting it as
 *      `!drillsUnlocked` would badge-lock every paying subscriber during the window where the
 *      entitlement is undefined/loading/stale. The server 402 is the real enforcement; the client
 *      flag is only the explanation, so when in doubt it must show the drill, never withhold it.
 *   2. PROTECTED FEATURE. Übungen is on the owner's never-delete list. The tiles must remain
 *      present, named and tappable — dimming and badging is allowed, removing/hiding/disabling
 *      is not (a `disabled` tile is unfocusable, un-tappable and explains nothing).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');

test('the drill lock fails OPEN — strict === false, never a truthiness negation', () => {
  assert.match(source, /const drillsLocked = auth\.account\?\.entitlement\?\.drillsUnlocked === false/,
    'drillsLocked must use a STRICT === false so a missing/loading entitlement leaves drills OPEN');
  // The dangerous rewrites. Any of these locks a paying user out while entitlement is undefined.
  assert.doesNotMatch(source, /const drillsLocked = !auth/,
    'a truthiness negation would badge-lock paying subscribers on a stale/absent entitlement');
  assert.doesNotMatch(source, /const drillsLocked = auth\.account\?\.entitlement\?\.drillsUnlocked !== true/,
    '`!== true` has the same fail-closed defect as a negation');
});

test('a locked tile opens the PAYWALL, not the drill, and reports which exercise was wanted', () => {
  assert.match(source, /if \(!drillsLocked\) return t\.open\(\);/,
    'an unlocked tile must still open its drill directly');
  assert.match(source, /beacon\('drill_locked_tap'\)/);
  assert.match(source, /reason:'drill', drillLabel:t\.de/,
    'the paywall needs the drill name to answer the question the tap actually asked');
  // The paywall must render that reason, and must still render without it (every other entry point).
  assert.match(source, /info\?\.reason === 'drill' && info\?\.drillLabel &&/,
    'the reason block must be gated so all other paywall entry points are unchanged');
});

test('the free personal step is promised only because the server really leaves it ungated', async () => {
  // If anyone ever adds an entitlement gate to personalStep.js, this copy becomes a LIE and the
  // test must fail loudly rather than let the app promise something it no longer delivers.
  const personalStep = await readFile(new URL('./personalStep.js', import.meta.url), 'utf8');
  for (const gate of ['402', 'drillsUnlocked', 'plan_required', 'upgrade_required']) {
    assert.equal(personalStep.includes(gate), false,
      `personalStep.js now contains "${gate}" — the paywall line "Dein persönlicher Schritt ... `
      + 'bleibt frei" is no longer true and must be removed or reworded.');
  }
  assert.match(source, /Dein persönlicher Schritt aus deinem letzten Interview bleibt frei\./);
});

test('PROTECTED: all five Übungen tiles survive, named and never disabled', () => {
  for (const label of ['Shadowing', 'Flow-Drill', 'Hör-Check', 'Sag es richtig', 'Satzbau-Schmiede']) {
    assert.ok(source.includes(`'${label}'`), `Übungen tile "${label}" must not be removed or relabeled`);
  }
  // Scope the disabled-check to the tile grid so unrelated disabled controls elsewhere don't match.
  const gridStart = source.indexOf("{ icon:'waveform',     de:'Shadowing'");
  assert.ok(gridStart > 0, 'the Übungen tile grid must still exist');
  const grid = source.slice(gridStart, gridStart + 3500);
  assert.doesNotMatch(grid, /disabled=\{drillsLocked\}/,
    'locked tiles stay tappable — dim + badge + route to plans, never disable');
  assert.match(grid, /opacity: drillsLocked \? 0\.5 : 1/);
  assert.match(grid, /ab Basic/, 'the badge names the cheapest plan that unlocks drills');
});
