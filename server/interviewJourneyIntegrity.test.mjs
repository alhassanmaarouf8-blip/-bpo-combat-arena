import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoBossForLanguageLevel,
  bossAllowedForLanguageLevel,
  isLearnerHelpRequest,
} from './websocketManager.js';

test('auto interviewer never selects a persona shown as locked for the chosen language level', () => {
  assert.equal(autoBossForLanguageLevel(2, 'a2-b1'), 'yasmin');
  assert.equal(autoBossForLanguageLevel(8, 'a2-b1'), 'karim');
  assert.equal(autoBossForLanguageLevel(8, 'b2'), 'tarek');
  assert.equal(autoBossForLanguageLevel(8, 'c1'), 'frau-mona-adel');
  assert.equal(bossAllowedForLanguageLevel('lukas', 'a2-b1'), false);
  assert.equal(bossAllowedForLanguageLevel('lukas', 'c1'), true);
});

test('clarification and simplification requests are not interview answers', () => {
  assert.equal(isLearnerHelpRequest('Ich verstehe die Frage nicht. Bitte einfacher und mit einem Satzanfang.'), true);
  assert.equal(isLearnerHelpRequest('Bitte wiederholen Sie die Frage langsamer.'), true);
  assert.equal(isLearnerHelpRequest('Ich habe im Laden Kunden beraten und Reklamationen dokumentiert.'), false);
});
