import test from 'node:test';
import assert from 'node:assert/strict';
import { roleplayTurnFactors, roleplayTurnSummary } from './roleplayTurnScoring.js';

const labels = (result) => result.factors.map((factor) => factor.label);

test('customer-service contradictions never earn empathy or ownership HP', () => {
  const result = roleplayTurnFactors('Das tut mir leid, aber das ist nicht unser Problem. Wir werden nichts tun.', 'customer_service');
  assert.equal(result.contradicted, true);
  assert.deepEqual(labels(result), ['widerspr\u00fcchliche Rollenhandlung']);
  assert.equal(result.factors[0].side, 'player');
});

test('technical support rewards diagnosis, not generic service phrases', () => {
  const technical = roleplayTurnFactors('Wenn ich Sie richtig verstehe, geht das WLAN seit dem Update nicht. Welche Fehlermeldung sehen Sie? Zuerst pr\u00fcfen wir die Verbindung.', 'technical_support');
  assert.deepEqual(labels(technical), ['Problem zusammengefasst', 'gezielte Diagnosefrage', 'sicherer Pr\u00fcfschritt']);
  const generic = roleplayTurnFactors('Das tut mir leid. Ich k\u00fcmmere mich darum.', 'technical_support');
  assert.deepEqual(generic.factors, []);
});

test('sales rewards needs discovery and blocks pressure tactics', () => {
  const good = roleplayTurnFactors('Ich verstehe Ihren Einwand. Darf ich fragen, welches Ziel Ihnen am wichtigsten ist?', 'sales');
  assert.deepEqual(labels(good), ['Einwand anerkannt', 'Bedarf gekl\u00e4rt']);
  const bad = roleplayTurnFactors('Sie m\u00fcssen heute kaufen, das ist Ihre letzte Chance.', 'sales');
  assert.equal(bad.contradicted, true);
  assert.equal(bad.factors[0].side, 'player');
});

test('sales consent safeguards are distinguished from affirmative consent bypasses', () => {
  const safe = roleplayTurnFactors('Danke f\u00fcr Ihre Offenheit. Darf ich fragen, was Ihnen wichtig ist? Ohne Ihre Zustimmung schlie\u00dfe ich keinen Vertrag ab.', 'sales');
  assert.equal(safe.contradicted, false);
  assert.deepEqual(labels(safe), ['Einwand anerkannt', 'Bedarf gekl\u00e4rt']);
  assert.equal(roleplayTurnFactors('Ohne Ihre Zustimmung schlie\u00dfe ich den Vertrag ab.', 'sales').contradicted, true);
  assert.equal(roleplayTurnFactors('Ohne Ihre Zustimmung biete ich keine Alternative an, aber ich schlie\u00dfe den Vertrag ab.', 'sales').contradicted, true);
});

test('retention rewards consent and respects cancellation', () => {
  const good = roleplayTurnFactors('Ich verstehe, dass Sie k\u00fcndigen. Darf ich fragen, warum? W\u00e4ren Sie offen f\u00fcr eine Alternative? Ich respektiere Ihre Entscheidung.', 'retention');
  assert.deepEqual(labels(good), ['K\u00fcndigungswunsch anerkannt', 'Grund gekl\u00e4rt', 'Erlaubnis vor Alternative', 'Entscheidung respektiert']);
  assert.equal(roleplayTurnFactors('Ich akzeptiere Ihre K\u00fcndigung nicht.', 'retention').contradicted, true);
});

test('retention consent safeguards are distinguished from unauthorized alternatives', () => {
  const safe = roleplayTurnFactors('Ich verstehe, dass Sie k\u00fcndigen, und das respektiere ich. Ohne Ihre Zustimmung biete ich keine Alternative an.', 'retention');
  assert.equal(safe.contradicted, false);
  assert.deepEqual(labels(safe), ['K\u00fcndigungswunsch anerkannt']);
  assert.equal(roleplayTurnFactors('Ohne Ihre Zustimmung biete ich Ihnen eine Alternative an.', 'retention').contradicted, true);
});

test('backoffice rewards source verification and blocks guessing', () => {
  const good = roleplayTurnFactors('Die Angaben widersprechen sich. Welche Quelle ist verbindlich? Ich dokumentiere den n\u00e4chsten Schritt.', 'backoffice');
  assert.deepEqual(labels(good), ['Datenkonflikt benannt', 'verbindliche Quelle erfragt', 'dokumentierter n\u00e4chster Schritt']);
  assert.equal(roleplayTurnFactors('Ich rate einfach die richtige Adresse.', 'backoffice').contradicted, true);
});

test('backoffice verification safeguards are distinguished from unverified changes', () => {
  const safe = roleplayTurnFactors('Die Angaben widersprechen sich. Ohne Pr\u00fcfung \u00e4ndere ich die Daten nicht. Welche Quelle ist verbindlich? Ich dokumentiere den Fall.', 'backoffice');
  assert.equal(safe.contradicted, false);
  assert.deepEqual(labels(safe), ['Datenkonflikt benannt', 'verbindliche Quelle erfragt', 'dokumentierter n\u00e4chster Schritt']);
  assert.equal(roleplayTurnFactors('Ohne Pr\u00fcfung \u00e4ndere ich die Daten.', 'backoffice').contradicted, true);
});

test('unknown roles fail closed', () => {
  assert.deepEqual(roleplayTurnFactors('Das tut mir leid.', 'admin'), { roleType: null, contradicted: false, factors: [] });
});

test('display summary is role-labelled, stage-bound, and contradiction-resistant', () => {
  const summary = roleplayTurnSummary([
    { stage: 1, text: 'Ich verstehe Ihren Einwand. Darf ich fragen, welches Ziel Ihnen wichtig ist?' },
    { stage: 2, text: 'Ich verstehe Ihren Einwand. Darf ich fragen, welches Ziel Ihnen am wichtigsten ist?' },
    { stage: 2, text: 'Ich respektiere Ihre Entscheidung. Vielen Dank f\u00fcr Ihre Zeit.' },
  ], 'sales');
  assert.equal(summary.label, 'Bedarf und Einwand');
  assert.equal(summary.observedActs, 3);
  assert.equal(summary.score, 75);
  const contradicted = roleplayTurnSummary([
    { stage: 2, text: 'Ich verstehe Ihren Einwand. Darf ich fragen, welches Ziel Ihnen wichtig ist?' },
    { stage: 2, text: 'Sie m\u00fcssen heute kaufen. Das ist Ihre letzte Chance und garantiert richtig.' },
  ], 'sales');
  assert.equal(contradicted.score, 0);
});
