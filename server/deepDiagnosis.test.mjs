import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeepAnalysis, computeAggregates, numberedTranscript, augmentFillerEvents, augmentRegisterEvents } from './deepDiagnosis.js';

test('augmentFillerEvents: a filler storm becomes a code-made event with a real de-filled correction', () => {
  const v = { answers: [
    { index: 1, original: 'Ähm also ähm ich denke also ähm wirklich.', errors: [] },
    { index: 2, original: 'Ich habe drei Jahre gearbeitet.', errors: [] },              // clean → untouched
    { index: 3, original: 'Ähm also ähm ja ähm gut.', errors: [{ kategorie: 'FUELLWOERTER', quote: 'x', korrektur: 'y' }] }, // model already filed → skip
  ] };
  augmentFillerEvents(v);
  assert.equal(v.answers[0].errors.length, 1);
  assert.equal(v.answers[0].errors[0].code, 'FUELLWOERTER/fuellwoerter_haeufung');
  assert.equal(v.answers[0].errors[0].deterministic, true);
  assert.ok(!v.answers[0].errors[0].korrektur.match(/ähm|also/i));
  assert.equal(v.answers[1].errors.length, 0);
  assert.equal(v.answers[2].errors.length, 1);
});

test('augmentRegisterEvents: du/Sie slip gets a safe word-level correction; Sie-form answers untouched', () => {
  const v = { answers: [
    { index: 1, original: 'Danke, dass du mir diese Frage stellst — kannst du mir mehr erzählen?', errors: [] },
    { index: 2, original: 'Ich danke Ihnen für die Frage und erzähle Ihnen gern mehr.', errors: [] },
    { index: 3, original: 'Ich bin geduldig und ruhig.', errors: [] },
  ] };
  augmentRegisterEvents(v);
  assert.equal(v.answers[0].errors.length, 1);
  const e = v.answers[0].errors[0];
  assert.equal(e.code, 'REGISTER_FORMALITAET/du_statt_sie');
  assert.equal(e.quote.toLowerCase(), 'kannst du');
  assert.equal(e.korrektur, 'können Sie');
  assert.equal(v.answers[1].errors.length, 0);
  assert.equal(v.answers[2].errors.length, 0);
});

const TURNS = [
  'Ich habe gearbeitet in einer Firma weil ich habe Erfahrung',   // A1 — planted errors
  'Ich bin einer regelmäßige Nutzer von diese Software',          // A2
  'und dann habe ich',                                            // A3 — truncated (aux + pronoun, no terminal)
];

function mkParsed(overrides = {}) {
  return {
    answers: [
      {
        index: 1, frage: 'Erzählen Sie von sich',
        errors: [
          { quote: 'gearbeitet in einer Firma', korrektur: 'in einer Firma gearbeitet', kategorie: 'VERB_POSITION',
            subcode: 'partizip am ende hauptsatz', schwere: 3, verstaendlichkeit: 2,
            erklaerung_de: 'Das Partizip steht am Satzende.', erklaerung_ar: 'x' },
          { quote: 'weil ich habe Erfahrung', korrektur: 'weil ich Erfahrung habe', kategorie: 'Verbstellung',
            subcode: 'Verb am Ende (Nebensatz: weil)', schwere: 9, verstaendlichkeit: 0,
            erklaerung_de: 'Nach weil steht das Verb am Ende.', erklaerung_ar: 'x' },
        ],
        alternativen: [
          { text: 'Ich habe drei Jahre in einer Firma gearbeitet, weil ich dort Erfahrung sammeln wollte.', wann_de: 'neutral', wann_ar: '' },
          { text: 'Ich habe gearbeitet in einer Firma weil ich habe Erfahrung', wann_de: 'identisch — muss rausfallen', wann_ar: '' },
        ],
        staerken: [
          { quote: 'in einer Firma', warum_de: 'Präposition korrekt', warum_ar: '' },
          { quote: 'nie gesagt worden', warum_de: 'erfunden — muss rausfallen', warum_ar: '' },
        ],
      },
      {
        index: 2, frage: 'Nutzen Sie die Software?',
        errors: [
          { quote: 'einer regelmäßige Nutzer', korrektur: 'ein regelmäßiger Nutzer', kategorie: 'ADJ_ENDUNG',
            subcode: 'nach unbestimmtem artikel maskulin nom', schwere: 2, verstaendlichkeit: 1,
            erklaerung_de: 'Nominativ maskulin: ein regelmäßiger Nutzer.', erklaerung_ar: 'x' },
          { quote: 'von diese Software', korrektur: 'von dieser Software', kategorie: 'KASUS',
            subcode: 'praeposition von dativ', schwere: 2, verstaendlichkeit: 1,
            erklaerung_de: 'von verlangt Dativ.', erklaerung_ar: 'x' },
          { quote: 'diese Software', korrektur: 'diese Software', kategorie: 'KASUS', subcode: 'x',
            erklaerung_de: 'keine echte Korrektur — muss rausfallen', erklaerung_ar: '' },
          { quote: 'total erfundenes Zitat', korrektur: 'egal', kategorie: 'KASUS', subcode: 'x',
            erklaerung_de: 'erfunden — muss rausfallen', erklaerung_ar: '' },
        ],
        alternativen: [],
        staerken: [],
      },
      {
        index: 3, frage: 'Und dann?',
        errors: [
          { quote: 'und dann habe ich', korrektur: 'Anschließend habe ich das Problem gelöst.', kategorie: 'ANTWORT_STRUKTUR',
            subcode: 'kein ergebnis', schwere: 3, verstaendlichkeit: 3,
            erklaerung_de: 'abgeschnitten — Struktur darf nicht bemängelt werden', erklaerung_ar: '' },
          { quote: 'habe ich', korrektur: 'habe ich gemacht', kategorie: 'UNBEKANNTE_KATEGORIE', subcode: 'x',
            erklaerung_de: 'unbekannte Kategorie — muss rausfallen', erklaerung_ar: '' },
        ],
        alternativen: [],
        staerken: [],
      },
      { index: 99, frage: 'gibt es nicht', errors: [{ quote: 'x', korrektur: 'y', kategorie: 'KASUS', subcode: 'x' }], alternativen: [], staerken: [] },
    ],
    cefr: { geschaetzt: 'b1', signale_de: 'Nebensätze versucht, Kasusfehler häufig.' },
    ...overrides,
  };
}

test('validateDeepAnalysis: keeps real errors, normalizes category+subcode, clamps scores', () => {
  const v = validateDeepAnalysis(mkParsed(), { candidateTurns: TURNS });
  assert.ok(v);
  const a1 = v.answers.find((a) => a.index === 1);
  assert.equal(a1.errors.length, 2);
  assert.equal(a1.errors[1].kategorie, 'VERB_POSITION');                       // alias repaired
  assert.equal(a1.errors[1].subcode, 'verb_am_ende_nach_weil');                // normalized + alias
  assert.equal(a1.errors[1].schwere, 5);                                       // clamped 9 → 5
  assert.equal(a1.errors[1].verstaendlichkeit, 1);                             // clamped 0 → 1
  assert.equal(a1.errors[0].code, 'VERB_POSITION/partizip_am_ende_hauptsatz');
});

test('validateDeepAnalysis: drops fabricated quotes, non-corrections, unknown categories', () => {
  const v = validateDeepAnalysis(mkParsed(), { candidateTurns: TURNS });
  const a2 = v.answers.find((a) => a.index === 2);
  assert.equal(a2.errors.length, 2);            // identical-correction + fabricated both dropped
  assert.ok(v.dropped >= 3);
});

test('validateDeepAnalysis: truncated turns never get answer-level blame; token errors stay possible', () => {
  const v = validateDeepAnalysis(mkParsed(), { candidateTurns: TURNS });
  const a3 = v.answers.find((a) => a.index === 3);
  assert.ok(a3.truncated);
  assert.equal(a3.errors.length, 0);            // ANTWORT_STRUKTUR dropped (truncated) + unknown category dropped
});

test('validateDeepAnalysis: out-of-range answer index dropped; identical alternative dropped; fabricated strength dropped', () => {
  const v = validateDeepAnalysis(mkParsed(), { candidateTurns: TURNS });
  assert.ok(!v.answers.some((a) => a.index === 99));
  const a1 = v.answers.find((a) => a.index === 1);
  assert.equal(a1.alternativen.length, 1);
  assert.equal(a1.staerken.length, 1);
});

test('validateDeepAnalysis: low-confidence STT words are never quoted back', () => {
  const v = validateDeepAnalysis(mkParsed(), { candidateTurns: TURNS, lowConfSet: new Set(['regelmäßige']) });
  const a2 = v.answers.find((a) => a.index === 2);
  assert.equal(a2.errors.length, 1);            // the ADJ_ENDUNG error quoting "regelmäßige" is gone
});

test('validateDeepAnalysis: hard shape failure returns null (retry signal)', () => {
  assert.equal(validateDeepAnalysis({ notAnswers: [] }, { candidateTurns: TURNS }), null);
  assert.equal(validateDeepAnalysis(null, { candidateTurns: TURNS }), null);
});

test('computeAggregates: counts come from code, never the model', () => {
  const v = validateDeepAnalysis(mkParsed(), { candidateTurns: TURNS });
  const agg = computeAggregates(v, TURNS.map((t) => ({ text: t })));
  assert.equal(agg.totalErrors, 4);
  assert.equal(agg.byCategory.VERB_POSITION, 2);
  assert.equal(agg.byCategory.ADJ_ENDUNG, 1);
  assert.equal(agg.byCategory.KASUS, 1);
  assert.equal(agg.byCode['VERB_POSITION/verb_am_ende_nach_weil'], 1);
  assert.equal(agg.cefrEstimate.geschaetzt, 'B1');
  assert.equal(agg.cefrEstimate.estimate, true);
  assert.equal(agg.answersAnalyzed, 3);
});

test('numberedTranscript: numbers candidate turns, marks truncation, keeps boss lines', () => {
  const dialogue = [
    { role: 'boss', text: 'Erzählen Sie von sich.' },
    { role: 'candidate', text: TURNS[0] },
    { role: 'boss', text: 'Und dann?' },
    { role: 'candidate', text: TURNS[2] },
  ];
  const { transcript, candidateTurns } = numberedTranscript(dialogue, []);
  assert.equal(candidateTurns.length, 2);
  assert.match(transcript, /^B: Erzählen Sie von sich\./);
  assert.match(transcript, /A1: Ich habe gearbeitet/);
  assert.match(transcript, /A2: und dann habe ich\s+⟨ABGEBROCHEN/);
});
