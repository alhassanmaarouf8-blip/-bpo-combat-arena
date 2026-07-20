/**
 * brainDose.test.mjs — pins the concrete-dose contract (owner 07-20: after the interview the app
 * must say WHAT to do, HOW MANY, for HOW LONG, and when it counts as done — not "Trainingsblock
 * starten"). The dose is the drill's static protocol, attached to every /api/brain drill
 * prescription at the API boundary and rendered by the mission card even with the coach flag off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { salmaDrillProtocol } from './salmaCoachCore.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

test('every prescribable drill has a complete protocol (reps, minutes, success gate)', () => {
  const drills = ['satzbau-schmiede', 'sag-es-richtig', 'flow-drill', 'hoer-check', 'shadowing',
    'druck-leiter', 'srs', 'finde-den-fehler', 'sag-es-richtig-tempo'];
  for (const drill of drills) {
    const proto = salmaDrillProtocol(drill);
    assert.ok(proto, `${drill}: no protocol — the card would fall back to the generic line`);
    assert.ok(proto.repetitions >= 1, `${drill}: repetitions`);
    assert.ok(proto.durationSeconds >= 60, `${drill}: duration`);
    assert.ok(typeof proto.successGate === 'string' && proto.successGate.length > 10,
      `${drill}: success gate must state the finish line`);
  }
});

test('/api/brain attaches the protocol to drill prescriptions (API boundary, engine stays copy-free)', () => {
  const src = read('./progress.js');
  assert.match(src, /prescription\?\.action === 'drill'/u);
  assert.match(src, /directive\.prescription\.protocol = protocol/u);
});

test('the mission card renders the dose from the protocol when no coach dose owns the drill', () => {
  const guide = read('../client/src/BrainGuide.jsx');
  assert.match(guide, /p\.protocol/u, 'missionBrief must read the attached protocol');
  assert.match(guide, /proto\.repetitions[^\n]*Wiederholungen/u, 'reps must be stated');
  assert.match(guide, /proto\?\.successGate/u, 'the finish line must come from the protocol');
});
