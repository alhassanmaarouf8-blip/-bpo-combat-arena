import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNaturalnessState, onCandidateTurn, buildBossDirective, onBossTurn,
} from './naturalnessWiring.js';

test('directive weaves the candidate\'s own words back (callback)', () => {
  const s = createNaturalnessState();
  onCandidateTurn(s, { text: 'Einmal hatte ich einen schwierigen Kunden.' }, 0);
  const dir = buildBossDirective(s);
  assert.ok(dir, 'a directive is produced');
  assert.match(dir, /schwierigen Kunden/);
});

test('directive prioritises a contradiction over a callback', () => {
  const s = createNaturalnessState();
  onCandidateTurn(s, { text: 'Ich habe drei Jahre Erfahrung.' }, 0);
  onCandidateTurn(s, { text: 'Also insgesamt fünf Jahre im Support.' }, 2);
  const dir = buildBossDirective(s);
  assert.match(dir, /widersprochen/);
  assert.match(dir, /drei Jahre/);
  assert.match(dir, /fünf Jahre/);
});

test('directive never leaks a company name (owner rule)', () => {
  const s = createNaturalnessState();
  onCandidateTurn(s, { text: 'Ich habe bei Microsoft gearbeitet.' }, 0);
  const dir = buildBossDirective(s);
  // only a proper-noun employer was said → no callback content; if a directive exists it must not name it
  assert.ok(!dir || !/Microsoft/.test(dir), 'company name never appears in the directive');
});

test('onBossTurn strips a worn opener and feeds anti-repeat', () => {
  const s = createNaturalnessState();
  const cleaned = onBossTurn(s, 'Das ist interessant. Warum haben Sie gewechselt?');
  assert.equal(cleaned, 'Warum haben Sie gewechselt?');
});

test('anti-repeat surfaces in the directive after a repeated opening', () => {
  const s = createNaturalnessState();
  onBossTurn(s, 'Und wie haben Sie reagiert?');          // records opening signature
  onCandidateTurn(s, { text: 'Ich blieb ruhig und freundlich.' }, 0);
  const dir = buildBossDirective(s);
  assert.match(dir, /Beginne deine Antwort NICHT wieder mit/);
  assert.match(dir, /und wie haben/);
});

test('no directive when there is nothing to add yet', () => {
  const s = createNaturalnessState();
  onCandidateTurn(s, { text: 'Ja.' }, 0); // no claims, no history
  assert.equal(buildBossDirective(s), null);
});
