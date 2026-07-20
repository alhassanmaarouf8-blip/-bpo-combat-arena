import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, CATEGORY_IDS, ANSWER_LEVEL_CATEGORIES, normalizeCategory, normalizeSubcode, errorCode }
  from './errorTaxonomy.js';

test('all category ids are self-normalizing and labeled', () => {
  assert.ok(CATEGORY_IDS.length >= 18);
  for (const id of CATEGORY_IDS) {
    assert.equal(normalizeCategory(id), id);
    assert.ok(CATEGORIES[id].de.length > 2);
  }
});

test('normalizeCategory repairs umlauts, casing, spacing and known aliases', () => {
  assert.equal(normalizeCategory('KOHÄRENZ'), 'KOHAERENZ');
  assert.equal(normalizeCategory('kohärenz'), 'KOHAERENZ');
  assert.equal(normalizeCategory('Füllwörter'), 'FUELLWOERTER');
  assert.equal(normalizeCategory(' adj endung '), 'ADJ_ENDUNG');
  assert.equal(normalizeCategory('Verbstellung'), 'VERB_POSITION');
  assert.equal(normalizeCategory('SATZBAU'), 'SATZBAU_NEBENSATZ');
});

test('normalizeCategory refuses to guess unknowns', () => {
  assert.equal(normalizeCategory('IRGENDWAS_NEUES'), null);
  assert.equal(normalizeCategory(''), null);
  assert.equal(normalizeCategory(null), null);
});

test('normalizeSubcode: stable snake_case across day-to-day drift', () => {
  assert.equal(normalizeSubcode('Nach unbestimmtem Artikel, maskulin Akk.'), 'nach_unbestimmtem_artikel_maskulin_akk');
  assert.equal(normalizeSubcode('nach_unbestimmtem_artikel_maskulin_akk'), 'nach_unbestimmtem_artikel_maskulin_akk');
  // alias: the observed close variant maps onto the same canonical subcode
  assert.equal(normalizeSubcode('nach unbestimmten Artikel maskulin akk'), 'nach_unbestimmtem_artikel_maskulin_akk');
  // 'nebensatz_weil' is an aliased variant — canonical form wins
  assert.equal(normalizeSubcode('Verb am Ende (Nebensatz: weil)'), 'verb_am_ende_nach_weil');
});

test('normalizeSubcode: umlauts, caps, empty, overlength', () => {
  assert.equal(normalizeSubcode('Präposition für Dativ'), 'praeposition_fuer_dativ');
  assert.equal(normalizeSubcode(''), 'allgemein');
  assert.equal(normalizeSubcode(undefined), 'allgemein');
  assert.ok(normalizeSubcode('x'.repeat(200)).length <= 64);
});

test('errorCode composes CATEGORY/subcode', () => {
  assert.equal(errorCode('KASUS', 'Präposition mit Dativ'), 'KASUS/praeposition_mit_dativ');
});

test('answer-level categories are a subset of the taxonomy', () => {
  for (const c of ANSWER_LEVEL_CATEGORIES) assert.ok(CATEGORIES[c], c);
});
