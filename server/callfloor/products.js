/**
 * callfloor/products.js — Phase 5: deliberately simple FICTIONAL products for sales calls, each
 * with a one-screen fact sheet the learner reviews before the call, and the key facts the
 * competency judge checks they used CORRECTLY (knowing the product is a real, scored job skill).
 *
 * Laws: no real company/brand name (generic product names only); no masri authored (fact_ar +
 * name_ar are empty OWNER-AR slots); German runs through german-check. Kept simple on purpose —
 * the skill is SELLING, not memorizing a tariff.
 */

export const PRODUCTS = [
  {
    id: 'mobiltarif-m', name_de: 'MobilTarif M', name_ar: '', type_de: 'Mobilfunk-Tarif', type_ar: '',
    facts_de: [
      '12 GB Datenvolumen pro Monat im schnellen Netz.',
      'Unbegrenzt telefonieren und SMS innerhalb Deutschlands.',
      '19,99 Euro pro Monat, 24 Monate Laufzeit.',
      'EU-Roaming ist inklusive, ohne Aufpreis.',
      'Außerhalb der EU fallen zusätzliche Gebühren an.',
    ],
    facts_ar: [], // OWNER-AR slots
    // Facts the agent should use CORRECTLY (the judge checks usage, not memorization).
    keyFacts_de: ['12 GB', '19,99 Euro', '24 Monate', 'EU-Roaming inklusive'],
  },
  {
    id: 'girobasis', name_de: 'GiroBasis', name_ar: '', type_de: 'Girokonto', type_ar: '',
    facts_de: [
      'Kostenlose Kontoführung ab 1.200 Euro Geldeingang im Monat, sonst 4,90 Euro pro Monat.',
      'Kostenlose Debitkarte inklusive, auch kontaktlos.',
      'Bargeld abheben in Deutschland kostenlos an vielen Automaten.',
      'Im Ausland 0,50 Euro pro Fremdwährungs-Abhebung.',
      'Kein Dispokredit im ersten Monat.',
    ],
    facts_ar: [],
    keyFacts_de: ['1.200 Euro Geldeingang', '4,90 Euro', 'kostenlose Debitkarte', '0,50 Euro'],
  },
];

const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
export const getProduct = (id) => byId.get(String(id || '')) || null;

// Which sales scenarios sell which product (deterministic map; sales seats only).
export const SCENARIO_PRODUCT = {
  'isa-tarif-upgrade': 'mobiltarif-m',
  'isa-neukundin-unsicher': 'girobasis',
  'osa-kaltakquise-buero': 'mobiltarif-m',
  'osa-bestandskunde-zusatz': 'mobiltarif-m',
};
export const productForScenario = (scenarioId) => getProduct(SCENARIO_PRODUCT[String(scenarioId || '')]);

/** The client fact sheet payload (safe to show before a sales call). */
export function factSheet(product) {
  if (!product) return null;
  return { id: product.id, name_de: product.name_de, name_ar: product.name_ar,
    type_de: product.type_de, type_ar: product.type_ar, facts_de: product.facts_de, facts_ar: product.facts_ar };
}

export default { PRODUCTS, getProduct, productForScenario, factSheet, SCENARIO_PRODUCT };
