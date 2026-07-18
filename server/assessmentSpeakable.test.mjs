/**
 * assessmentSpeakable.test.mjs — class-B regression: the free assessment verdict is SPOKEN aloud by
 * Salma, so a punctuation/casing/spelling "blocker" (which a speaker cannot produce) must never
 * survive normalizeResult. Guards the 2026-07-18 journey-test finding.
 *
 * normalizeResult isn't exported, so we exercise the guarantee through the module's public contract
 * by importing the shared filter it now uses and asserting the source wires it on all three sinks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSpeakableRule } from './grammarCheck.js';

const src = await readFile(new URL('./assessment.js', import.meta.url), 'utf8');

test('assessment imports and applies the speakable-rule filter', () => {
  assert.match(src, /import \{ isSpeakableRule \}\s+from '\.\/grammarCheck\.js'/);
  // blockers filtered on rule AND explanation
  assert.match(src, /isSpeakableRule\(b\.rule\)/);
  assert.match(src, /isSpeakableRule\(b\.explanation_de\)/);
  // recommendedFocus (the line Salma voices) gated
  assert.match(src, /isSpeakableRule\(d\.recommendedFocus\?\.de\)/);
  // prompt carries the orthography-exclusion instruction
  assert.match(src, /NIEMALS Rechtschreibung, Zeichensetzung/);
});

test('the filter itself drops orthography and keeps spoken rules', () => {
  for (const bad of ['Kommasetzung', 'Zeichensetzung', 'Groß- und Kleinschreibung', 'Rechtschreibung', 'Bindestrich', 'Getrennt- und Zusammenschreibung']) {
    assert.equal(isSpeakableRule(bad), false, `${bad} must be filtered out of a spoken verdict`);
  }
  for (const good of ['Verbstellung im Nebensatz', 'Wortschatz', 'Dativ statt Akkusativ', 'Satzbau']) {
    assert.equal(isSpeakableRule(good), true, `${good} is a real spoken weakness and must survive`);
  }
});
