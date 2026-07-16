import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGrammarSources, attachGrammarProvenance } from './grammarProvenance.js';

const rule = (name, wrong, right) => ({
  rule: name,
  examples: [{ wrong, right }],
});

test('merged grammar keeps legacy LLM-first ordering and reports both real sources', () => {
  const result = mergeGrammarSources({
    languageTool: [rule('LT rule', 'Ich habe Zeit.', 'Ich habe Zeit.')],
    llm: [rule('LLM rule', 'weil ich habe Zeit', 'weil ich Zeit habe')],
  });

  assert.deepEqual(result.grammar.map((entry) => entry.rule), ['LLM rule', 'LT rule']);
  assert.equal(result.grammar[0].correctionSource, 'llm');
  assert.equal(result.grammar[0].examples[0].correctionSource, 'llm');
  assert.equal(result.grammar[1].correctionSource, 'languagetool');
  assert.equal(result.grammarSource, 'merged');
  assert.deepEqual(result.grammarProvenance.correctionSources, ['llm', 'languagetool']);
  assert.equal(result.grammarUnavailable, false);
});

test('duplicate LLM correction is removed without stealing LanguageTool provenance', () => {
  const shared = rule('shared', 'Ich bin motiviert.', 'Ich bin sehr motiviert.');
  const result = mergeGrammarSources({ languageTool: [shared], llm: [shared] });

  assert.equal(result.grammar.length, 1);
  assert.equal(result.grammar[0].correctionSource, 'languagetool');
  assert.equal(result.grammarSource, 'languagetool');
  assert.deepEqual(result.grammarProvenance.correctionSources, ['languagetool']);
});

test('empty successful check differs from provider unavailability', () => {
  const checked = mergeGrammarSources({ languageTool: [], llm: null });
  assert.equal(checked.grammarSource, 'none');
  assert.equal(checked.grammarUnavailable, false);
  assert.equal(checked.grammarProvenance.providers.languagetool.status, 'available');

  const unavailable = mergeGrammarSources({ languageTool: null, llm: null });
  assert.equal(unavailable.grammarSource, 'none');
  assert.equal(unavailable.grammarUnavailable, true);
});

test('LLM-only fallback never impersonates LanguageTool', () => {
  const result = mergeGrammarSources({
    languageTool: null,
    llm: [rule('Verb final', 'weil ich habe Zeit', 'weil ich Zeit habe')],
  });
  const payload = attachGrammarProvenance({}, result);

  assert.equal(payload.grammarSource, 'llm');
  assert.equal(payload.grammarUnavailable, false);
  assert.equal(payload.grammarProvenance.providers.languagetool.status, 'unavailable');
});
