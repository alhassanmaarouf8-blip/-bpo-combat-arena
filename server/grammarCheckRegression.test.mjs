import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrammar } from './grammarCheck.js';

test('LanguageTool NACH_7_TAGE is named from the learner context, not its misleading internal example', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ matches: [{
      message: 'Hier scheint ein Buchstabe zu fehlen.', shortMessage: '', offset: 23, length: 5,
      replacements: [{ value: 'Jahren' }],
      rule: { id: 'NACH_7_TAGE', issueType: 'uncategorized', category: { id: 'GRAMMAR', name: 'Grammatik' } },
    }] }),
  });
  try {
    const grammar = await buildGrammar([{ text: 'obgleich ich seit drei Jahre nicht mehr in einem Callcenter tätig war.', words: 11 }]);
    assert.equal(grammar.length, 1);
    assert.match(grammar[0].rule, /seit/u);
    assert.doesNotMatch(grammar[0].rule, /nach 7 Tage/u);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
