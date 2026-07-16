/**
 * l1Errors.test.mjs — Arabic-L1 pattern detectors (ROADMAP #3): detection, the
 * false-positive guards, the honesty gates, and the ONE-pattern debrief hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectL1Patterns, topL1Pattern } from './l1Errors.js';

const utt = (text, extra = {}) => ({ text, words: text.split(/\s+/).length, ...extra });

// ── Detector 1: verb-second in subordinate clauses ─────────────────────────────

test('flags "weil ich habe keine Zeit" (V2 in subordinate clause)', () => {
  const found = detectL1Patterns([utt('Ich komme später, weil ich habe keine Zeit heute.')]);
  const vf = found.find((f) => f.key === 'verb-final');
  assert.ok(vf, 'pattern not detected');
  assert.equal(vf.count, 1);
  assert.ok(vf.examples[0].quote.startsWith('weil ich habe'));
});

test('suggests the deterministic verb-final rewrite for a simple clause', () => {
  const found = detectL1Patterns([utt('weil ich habe keine Zeit')]);
  const vf = found.find((f) => f.key === 'verb-final');
  assert.equal(vf.examples[0].better, 'weil ich keine Zeit habe');
});

test('does NOT flag correct verb-final order', () => {
  const found = detectL1Patterns([
    utt('Ich bleibe ruhig, weil ich viel Erfahrung habe.'),
    utt('Ich denke, dass wir eine Lösung finden.'),
  ]);
  assert.ok(!found.find((f) => f.key === 'verb-final'));
});

test('does NOT flag a clause-final verb ("weil ich arbeite.")', () => {
  const found = detectL1Patterns([utt('Ich habe wenig Zeit, weil ich arbeite.')]);
  assert.ok(!found.find((f) => f.key === 'verb-final'));
});

test('does NOT flag "wenn Sie möchten, …" (Sie-form is not in the subject set by design)', () => {
  const found = detectL1Patterns([utt('Wenn Sie möchten, können wir morgen sprechen.')]);
  assert.ok(!found.find((f) => f.key === 'verb-final'));
});

test('no fabricated rewrite when the clause is complex', () => {
  const found = detectL1Patterns([
    utt('weil ich habe gestern mit dem Kunden und dem Kollegen über alles gesprochen und dann'),
  ]);
  const vf = found.find((f) => f.key === 'verb-final');
  assert.ok(vf);
  assert.equal(vf.examples[0].better, null);
});

test('human-corpus guard: an incomplete one-token tail is detected but never rewritten', () => {
  const found = detectL1Patterns([utt('weil wir machen in')]);
  const vf = found.find((f) => f.key === 'verb-final');
  assert.ok(vf);
  assert.equal(vf.count, 1);
  assert.equal(vf.examples.length, 0);
});

test('human-corpus guard: missing punctuation before a bitte request never moves the main clause', () => {
  const found = detectL1Patterns([utt('Wenn du suchst bitte ruf mich an schnell')]);
  const vf = found.find((f) => f.key === 'verb-final');
  assert.ok(vf);
  assert.equal(vf.examples[0].better, null);
});

// ── Detector 2: subject–verb agreement ────────────────────────────────────────

test('flags explicit pronoun–verb disagreement and suggests the closed-paradigm form', () => {
  const cases = [
    ['ich sind bereit', 'ich bin'],
    ['du haben Zeit', 'du hast'],
    ['wir ist ein Team', 'wir sind'],
  ];
  for (const [text, better] of cases) {
    const pattern = detectL1Patterns([utt(text)]).find((item) => item.key === 'subject-verb');
    assert.ok(pattern, `agreement pattern not detected: ${text}`);
    assert.equal(pattern.examples[0].better, better);
  }
});

test('does NOT flag correct closed-paradigm agreement', () => {
  const found = detectL1Patterns([
    utt('ich bin bereit'),
    utt('du hast Zeit'),
    utt('wir können morgen sprechen'),
  ]);
  assert.ok(!found.find((item) => item.key === 'subject-verb'));
});

test('does NOT guess ambiguous sie/Sie or ihr agreement', () => {
  const found = detectL1Patterns([
    utt('sie sind bereit'),
    utt('Sie ist bereit'),
    utt('ihr haben Zeit'),
  ]);
  assert.ok(!found.find((item) => item.key === 'subject-verb'));
});

test('does NOT rewrite an infinitive governed by a later modal', () => {
  const found = detectL1Patterns([
    utt('weil ich haben möchte'),
    utt('weil ich arbeiten können muss'),
  ]);
  assert.ok(!found.find((item) => item.key === 'subject-verb'));
});

test('subject–verb evidence overlapping a low-confidence word is counted but not quoted', () => {
  const pattern = detectL1Patterns([
    utt('ich sind bereit', { lowConf: new Set(['sind']) }),
  ]).find((item) => item.key === 'subject-verb');
  assert.equal(pattern.count, 1);
  assert.equal(pattern.examples.length, 0);
});

// ── Detector 3: article–gender ─────────────────────────────────────────────────

test('flags "die Problem" and suggests "das Problem"', () => {
  const found = detectL1Patterns([utt('Ich habe die Problem gelöst.')]);
  const ag = found.find((f) => f.key === 'article-gender');
  assert.ok(ag);
  assert.equal(ag.examples[0].better, 'das Problem');
});

test('flags "eine Problem" (eine impossible for neuter)', () => {
  const found = detectL1Patterns([utt('Das war eine Problem für mich.')]);
  const pattern = found.find((f) => f.key === 'article-gender');
  assert.ok(pattern);
  assert.equal(pattern.examples[0].better, 'ein Problem');
});

test('preserves case and definiteness when the article replacement is unambiguous', () => {
  const cases = [
    ['nach dem Arbeit', 'der Arbeit'],
    ['mit einem Lösung', 'einer Lösung'],
    ['für einen Problem', 'ein Problem'],
  ];
  for (const [text, better] of cases) {
    const pattern = detectL1Patterns([utt(text)]).find((item) => item.key === 'article-gender');
    assert.ok(pattern, `article pattern not detected: ${text}`);
    assert.equal(pattern.examples[0].better, better);
  }
});

test('counts but does not rewrite when case cannot be recovered safely', () => {
  const pattern = detectL1Patterns([utt('Ich habe eine Beruf')])
    .find((item) => item.key === 'article-gender');
  assert.ok(pattern);
  assert.equal(pattern.count, 1);
  assert.equal(pattern.examples[0].better, null);
});

test('does NOT treat the modifier of a spaced nominal compound as the article head', () => {
  const found = detectL1Patterns([utt('welche Vorteile das Sprache Sprechen bringt')]);
  assert.ok(!found.find((item) => item.key === 'article-gender'));
});

test('does NOT flag correct case morphology ("mit der Frage" = dative)', () => {
  const found = detectL1Patterns([
    utt('Ich beginne mit der Frage nach dem Termin.'),
    utt('Ich habe den Kunden angerufen und das Problem gelöst.'),
  ]);
  assert.ok(!found.find((f) => f.key === 'article-gender'), 'correct German was flagged');
});

test('does NOT flag unknown nouns (no lexicon entry = no opinion)', () => {
  const found = detectL1Patterns([utt('die Selbstverständlichkeit war groß')]);
  assert.ok(!found.find((f) => f.key === 'article-gender'));
});

// ── Detector 4: P→B transcript artifacts ───────────────────────────────────────

test('detects "Broblem" as a P/B artifact with the intended word', () => {
  const found = detectL1Patterns([utt('Das Broblem war die Lieferung.')]);
  const pb = found.find((f) => f.key === 'p-b');
  assert.ok(pb);
  assert.equal(pb.examples[0].better, 'Problem');
});

test('normal German words never match the P/B list', () => {
  const found = detectL1Patterns([utt('Ich bin bereit und bleibe beim Beispiel.')]);
  assert.ok(!found.find((f) => f.key === 'p-b'));
});

// ── Honesty gates ──────────────────────────────────────────────────────────────

test('a truncated utterance is COUNTED but never QUOTED', () => {
  const found = detectL1Patterns([
    { text: 'weil ich habe keine', words: 4, lowConf: new Set() },   // looksTruncatedDE → no quote
  ]);
  const vf = found.find((f) => f.key === 'verb-final');
  assert.ok(vf);
  assert.equal(vf.count, 1);
  assert.equal(vf.examples.length, 0);
});

test('an example overlapping low-confidence words is dropped', () => {
  const found = detectL1Patterns([
    utt('Ich sage das, weil ich habe keine Zeit heute.', { lowConf: new Set(['habe']) }),
  ]);
  const vf = found.find((f) => f.key === 'verb-final');
  assert.equal(vf.count, 1);
  assert.equal(vf.examples.length, 0);
});

// ── topL1Pattern: the ONE-pattern debrief hook ─────────────────────────────────

test('returns null below the pattern threshold (1 occurrence is an accident)', () => {
  assert.equal(topL1Pattern([utt('weil ich habe keine Zeit heute')]), null);
});

test('names the MOST FREQUENT pattern with German copy and an OWNER-AR slot', () => {
  const p = topL1Pattern([
    utt('weil ich habe keine Zeit heute'),
    utt('dass er hat viele Fragen gestellt'),
    utt('Das Broblem war klein.'),
  ]);
  assert.ok(p);
  assert.equal(p.key, 'verb-final');
  assert.equal(p.count, 2);
  assert.ok(p.title.length > 5 && p.explain.length > 20);
  assert.equal(p.note_ar, '');
  assert.ok(p.example && p.example.better, 'should carry a corrected example');
});

test('returns null on empty/garbage input without throwing', () => {
  assert.equal(topL1Pattern([]), null);
  assert.equal(topL1Pattern(null), null);
  assert.equal(topL1Pattern([{ text: '' }, {}]), null);
});
