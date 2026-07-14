import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksTruncatedDE, sessionSubstance, speakingEvidenceQuality, lowConfidenceWords, quoteHasLowConfidence, looksLikeTrustworthyCorrection } from './turnQuality.js';

test('truncated: the owner\'s real cut-off fragments are flagged', () => {
  // straight from the reported broken interview
  assert.equal(looksTruncatedDE('das war mit Python. Wir haben'), true);   // ends on hanging aux "haben"
  assert.equal(looksTruncatedDE('Wir haben'), true);
  assert.equal(looksTruncatedDE('Ich habe'), true);
  assert.equal(looksTruncatedDE('das war Kundendienst, das war Ja, also IT, das war mit'), true); // ends on prep "mit"
  assert.equal(looksTruncatedDE('und dann habe ich'), true);
  assert.equal(looksTruncatedDE('weil'), true);
});

test('complete: normal finished answers are NOT flagged (no false critique)', () => {
  assert.equal(looksTruncatedDE('Ich habe drei Jahre im Kundenservice gearbeitet.'), false);
  assert.equal(looksTruncatedDE('Ich habe drei Jahre im Kundenservice gearbeitet'), false); // STT often drops the period
  assert.equal(looksTruncatedDE('Guten Tag.'), false);
  assert.equal(looksTruncatedDE('Ich heiße Alhassan und bin vierundzwanzig Jahre alt.'), false);
  assert.equal(looksTruncatedDE('Mein Name ist Karim Hassan'), false);
});

test('complete: bare interjections are finished replies, not scraps', () => {
  assert.equal(looksTruncatedDE('Ja'), false);
  assert.equal(looksTruncatedDE('Nein'), false);
  assert.equal(looksTruncatedDE('Gerne'), false);
  assert.equal(looksTruncatedDE('Ja, gerne.'), false);
});

test('edge: empty / whitespace is not "truncated"', () => {
  assert.equal(looksTruncatedDE(''), false);
  assert.equal(looksTruncatedDE('   '), false);
  assert.equal(looksTruncatedDE(null), false);
});

test('sessionSubstance: a session of only cut-off fragments is too thin to judge', () => {
  const utts = [
    { text: 'Ja, hallo, ich heiße Alhassan. Ich habe', words: 7 },
    { text: 'Arbeit. Das war IT Fachkräfte', words: 5 },
    { text: 'das war mit Python. Wir haben', words: 6 },
  ];
  const s = sessionSubstance(utts);
  assert.equal(s.tooThinToJudge, true);
  assert.ok(s.truncatedShare >= 0.6, `expected mostly-truncated, got ${s.truncatedShare}`);
});

test('sessionSubstance: two real complete answers with enough words is judgeable', () => {
  const utts = [
    { text: 'Guten Tag, mein Name ist Karim Hassan und ich habe drei Jahre im Kundenservice gearbeitet.', words: 15 },
    { text: 'Ich habe einen wütenden Kunden zuerst ausreden lassen und dann eine konkrete Lösung angeboten.', words: 13 },
  ];
  const s = sessionSubstance(utts);
  assert.equal(s.tooThinToJudge, false);
  assert.equal(s.completeTurns, 2);
});

test('sessionSubstance: empty session is trivially too thin', () => {
  assert.equal(sessionSubstance([]).tooThinToJudge, true);
});

test('speaking evidence distinguishes a useful debrief from a reliable prescription packet', () => {
  const short = [
    { text: 'Ich heiße Karim und arbeite seit drei Jahren sehr gern mit anspruchsvollen Kunden im Service.', words: 15, stage: 0 },
    { text: 'Ich löse Beschwerden ruhig, erkläre den nächsten Schritt und dokumentiere danach die vereinbarte Lösung vollständig.', words: 15, stage: 1 },
  ];
  assert.equal(sessionSubstance(short).tooThinToJudge, false);
  assert.equal(speakingEvidenceQuality(short).prescriptionEligible, false);

  const diagnostic = Array.from({ length: 4 }, (_, index) => ({
    text: `Ich gebe eine vollständige berufliche Antwort mit einem konkreten Beispiel aus meiner bisherigen Arbeit Nummer ${index}.`,
    words: 21,
    stage: index < 2 ? 0 : 1,
  }));
  const quality = speakingEvidenceQuality(diagnostic);
  assert.equal(quality.prescriptionEligible, true);
  assert.equal(quality.highConfidence, false);
  assert.equal(quality.stageCoverage, 2);
});

test('high-confidence speaking evidence requires all three stages and six complete answers', () => {
  const full = Array.from({ length: 6 }, (_, index) => ({
    text: `Ich beantworte diese Interviewfrage vollständig, begründe meine Entscheidung und nenne ein konkretes Ergebnis aus einer realistischen Kundensituation Nummer ${index}, damit meine Leistung unter Druck messbar bleibt.`,
    words: 31,
    stage: Math.floor(index / 2),
  }));
  const quality = speakingEvidenceQuality(full);
  assert.equal(quality.prescriptionEligible, true);
  assert.equal(quality.highConfidence, true);
  assert.equal(quality.stageCoverage, 3);
});

test('lowConfidenceWords: only sub-threshold words are flagged', () => {
  const words = [
    { word: 'ich', confidence: 0.98 }, { word: 'nutze', confidence: 0.95 },
    { word: 'Pariethon', confidence: 0.31 }, { word: 'täglich', confidence: 0.9 },
  ];
  assert.deepEqual(lowConfidenceWords(words), ['pariethon']);
  assert.deepEqual(lowConfidenceWords([]), []);
  assert.deepEqual(lowConfidenceWords(null), []);
});

test('quoteHasLowConfidence: a quote containing a mis-heard word is caught', () => {
  const set = new Set(['pariethon']);
  assert.equal(quoteHasLowConfidence('ich nutze Pariethon täglich', set), true);   // garbled → drop
  assert.equal(quoteHasLowConfidence('ich habe drei Jahre gearbeitet', set), false); // clean → keep
  assert.equal(quoteHasLowConfidence('anything', new Set()), false);                  // no low-conf data → keep
});

// ── looksLikeTrustworthyCorrection: the "Sag es richtig showed a broken correct-answer" bug ──
// (owner-reported 2026-07-02): grammarCheck.js patches only the ONE flagged span and reuses the
// rest of the utterance verbatim, so any OTHER defect (a stutter, a trailing-off clause) already
// in that utterance rides along into what gets shown/stored as the model answer.

test('looksLikeTrustworthyCorrection: rejects the EXACT owner-reported broken sentence', () => {
  const broken = 'Ja, leider, ich hab keinen Kündigungsrest. Ich bin nur 2 Wochen, bis ich bei euch ab ab anfangen, normalerweise ich';
  assert.equal(looksLikeTrustworthyCorrection(broken), false);
});

test('looksLikeTrustworthyCorrection: accepts a genuinely clean, complete corrected sentence', () => {
  assert.equal(looksLikeTrustworthyCorrection('Ich bin nur zwei Wochen bis ich bei euch anfange.'), true);
  assert.equal(looksLikeTrustworthyCorrection('Ich habe drei Jahre Erfahrung im Kundenservice.'), true);
});

test('looksLikeTrustworthyCorrection: rejects a raw disfluency stutter even without truncation', () => {
  assert.equal(looksLikeTrustworthyCorrection('Ich habe habe das Problem gelöst.'), false);
  assert.equal(looksLikeTrustworthyCorrection('Das ist ist wirklich schwierig.'), false);
});

test('looksLikeTrustworthyCorrection: rejects a cut-off sentence (reuses the truncation doctrine)', () => {
  assert.equal(looksLikeTrustworthyCorrection('Wir haben'), false);
  assert.equal(looksLikeTrustworthyCorrection('und dann habe ich'), false);
});

test('looksLikeTrustworthyCorrection: empty/whitespace is never trustworthy', () => {
  assert.equal(looksLikeTrustworthyCorrection(''), false);
  assert.equal(looksLikeTrustworthyCorrection('   '), false);
  assert.equal(looksLikeTrustworthyCorrection(null), false);
});
