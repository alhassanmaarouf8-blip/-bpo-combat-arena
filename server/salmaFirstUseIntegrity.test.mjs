import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SALMA_COPY, salmaLine, salmaRole } from '../client/src/salmaCopy.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('first-use Salma launches the live spoken diagnosis without a self-report admission gate', async () => {
  const takeover = await read('client/src/SalmaTakeover.jsx');

  assert.match(takeover, /useState\(resumeTick > 0 \? 'checking' : 'welcome'\)/u);
  assert.match(takeover, /bubbles\.push\(say\('screening_invite'\)\)/u);
  assert.match(takeover, /onClick=\{\(\) => \{ stopSpeech\(\); onBookFight\(null\); \}\}/u);
  assert.doesNotMatch(takeover, /onStartScreening/u);
  assert.doesNotMatch(takeover, /setBeat\('gate'\)|beat === 'gate'|gate_b1_yes|gate_b1_no/u);
  assert.doesNotMatch(takeover, /name_goal|intro_trial|saveProfile|salma_name_saved/u);
});

test('A2 is routed through measured foundation work rather than rejected from training', async () => {
  const takeover = await read('client/src/SalmaTakeover.jsx');
  assert.match(takeover, /ASSESS_LEVEL_MAP = \{[^\n]*A2: 'a2-b1'/u);
  assert.match(takeover, /ASSESS_BOSS_MAP = \{[^\n]*A2: 'yasmin'/u);
  assert.match(salmaLine('verdict_below_b1', 'de', { level: 'A2' }), /Aufbauaufgabe/u);
  assert.doesNotMatch(salmaLine('verdict_below_b1', 'de', { level: 'A2' }), /bewirb dich.*wieder|kein Zugang|abgelehnt/u);
});

test('reachable tutor copy names simulations honestly and contains no fixed invented dose', () => {
  const german = Object.values(SALMA_COPY).map((entry) => entry.de).join('\n');

  assert.equal(salmaRole('de'), 'Persönliche Interviewtrainerin');
  assert.doesNotMatch(german, /echte Interviews|echtes Interview|im echten Gespräch/u);
  assert.doesNotMatch(german, /15 Minuten heute|unter 5 Grammatik-Fehler|ich melde mich nach jedem/u);
  assert.doesNotMatch(german, /Du brauchst keine Anfängerrunde|Dein Niveau ist stark/u);
  assert.match(salmaLine('intro_welcome', 'de'), /BrainGuide wählt deinen nächsten Schritt/u);
  assert.match(salmaLine('rank_ready', 'de'), /keine Arbeitgeberentscheidung/u);
});

test('the one-time tutor introduction remains silent unless the learner presses listen', async () => {
  const takeover = await read('client/src/SalmaTakeover.jsx');
  const calls = takeover.match(/salmaSpeak\(/gu) || [];

  assert.equal(calls.length, 1);
  assert.match(takeover, /aria-label="Salma anhören" onClick=\{\(\) => \{/u);
  assert.doesNotMatch(takeover, /useEffect\([\s\S]{0,500}salmaSpeak\(/u);
  assert.doesNotMatch(takeover, /salma-talk\.jpg|mouth-talk|mouth-image|className=["'{][^\n]*mouth/u);
});

test('unapproved Masri still fails closed to the reviewed German source', async () => {
  const copy = await read('client/src/salmaCopy.js');
  assert.match(copy, /let s = entry\.de/u);
  assert.doesNotMatch(copy, /lang === 'ar'/u);
  assert.equal(salmaLine('intro_welcome', 'ar'), salmaLine('intro_welcome', 'de'));
});
