/**
 * phase5.test.mjs — Free-Talk + the product-knowledge sales layer. Pins: product mapping + fact
 * sheet + masri/company laws, the free-talk partner turn (no scoring, ends on goodbye), and the
 * judge adding a verbatim-gated "produktwissen" skill ONLY for sales calls with a product.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { PRODUCTS, productForScenario, factSheet, getProduct } = await import('./products.js');
const { FREETALK_SCENARIO, freeTalkSystemPrompt, freeTalkTurn, freeTalkOpening } = await import('./freetalk.js');
const { judgeCall } = await import('./competency.js');
const { SCENARIOS } = await import('./scenarios.js');

// ── Products ──────────────────────────────────────────────────────────────────────────────────
test('products: every sales scenario maps to a product; fact sheet + key facts present', () => {
  const salesScenarios = SCENARIOS.filter((s) => s.quadrant === 'inbound_sales' || s.quadrant === 'outbound_sales');
  for (const s of salesScenarios) {
    const p = productForScenario(s.id);
    assert.ok(p, `${s.id} has no product`);
    assert.ok(p.facts_de.length >= 3 && p.keyFacts_de.length >= 2, `${p.id} thin`);
  }
  assert.equal(factSheet(getProduct('mobiltarif-m')).name_de, 'MobilTarif M');
  assert.equal(factSheet(null), null);
});

test('products: masri law (*_ar empty) + no real company names', () => {
  const forbidden = /\b(Telekom|Vodafone|O2|Deutsche Bank|Sparkasse|Commerzbank|N26|GmbH|AG)\b/i;
  for (const p of PRODUCTS) {
    assert.equal(p.name_ar, ''); assert.equal(p.type_ar, ''); assert.deepEqual(p.facts_ar, []);
    const text = [p.name_de, p.type_de, ...p.facts_de].join(' ');
    assert.ok(!forbidden.test(text), `${p.id} names a real company`);
  }
});

// ── Free-Talk ─────────────────────────────────────────────────────────────────────────────────
test('free-talk: synthetic scenario + prompt shape; masri slots empty', () => {
  assert.equal(FREETALK_SCENARIO.quadrant, 'freetalk');
  assert.equal(FREETALK_SCENARIO.title_ar, '');
  const p = freeTalkSystemPrompt('b1');
  assert.match(p, /KORRIGIERE NICHTS/);        // it must NOT correct in-conversation (harvest is silent, later)
  assert.match(p, /\[ENDE\]/);
  assert.equal(freeTalkOpening().end, false);
});

test('free-talk: partner turn keeps mood, strips control tokens, ends on goodbye', async () => {
  const fake = async () => ({ content: 'Schön! Und was machst du am Wochenende? [STIMMUNG:5]', provider: 'test:m', usage: null });
  const t = await freeTalkTurn({ history: [], prevMood: 4, userId: 'u', _chat: fake });
  assert.equal(t.mood, 4);                      // free-talk is not mood-scored; prev mood preserved
  assert.ok(!/\[/.test(t.text));
  assert.equal(t.end, false);
  const bye = await freeTalkTurn({ history: [], prevMood: 4, userId: 'u', _chat: async () => ({ content: 'Tschüss, bis bald! [ENDE]', provider: 'test:m' }) });
  assert.equal(bye.end, true);
});

// ── Product-knowledge scoring ─────────────────────────────────────────────────────────────────
test('judge: a SALES call with a product gets a verbatim-gated produktwissen skill', async () => {
  const scenario = SCENARIOS.find((s) => s.quadrant === 'inbound_sales');
  const product = productForScenario(scenario.id);
  const transcript = [
    { role: 'customer', text: 'Was kostet der Tarif denn?' },
    { role: 'agent', text: 'Der Tarif kostet 19,99 Euro im Monat bei 24 Monaten Laufzeit.' },
  ];
  const fake = async ({ messages }) => {
    // the product facts must reach the judge prompt
    assert.match(messages[0].content, /19,99 Euro/);
    assert.match(messages[0].content, /produktwissen/);
    return { provider: 'test:m', usage: null, content: JSON.stringify({
      skills: [{ key: 'produktwissen', score: 5, quote: 'Der Tarif kostet 19,99 Euro im Monat bei 24 Monaten Laufzeit', why_de: 'Fakten korrekt.' }],
      resolved: null, resolved_quote: '', summary_de: 'Gut.',
    }) };
  };
  const out = await judgeCall({ scenario, transcript, userId: 'u', product, _chat: fake });
  const pk = out.skills.find((s) => s.key === 'produktwissen');
  assert.ok(pk, 'produktwissen skill missing');
  assert.equal(pk.score, 5);
  assert.ok(pk.quote.includes('19,99 Euro'));   // verbatim quote survived the gate
});

test('judge: a NON-sales call ignores any product (no produktwissen skill)', async () => {
  const scenario = SCENARIOS.find((s) => s.quadrant === 'inbound_cs');
  const fake = async ({ messages }) => {
    assert.doesNotMatch(messages[0].content, /produktwissen/);
    return { provider: 'test:m', usage: null, content: JSON.stringify({
      skills: [{ key: 'deeskalation', score: 4, quote: 'Das prüfe ich', why_de: 'ok' }], resolved: null, resolved_quote: '', summary_de: 'ok' }) };
  };
  const transcript = [{ role: 'agent', text: 'Das prüfe ich sofort.' }];
  const out = await judgeCall({ scenario, transcript, userId: 'u', product: getProduct('mobiltarif-m'), _chat: fake });
  assert.equal(out.skills.find((s) => s.key === 'produktwissen'), undefined);
});
