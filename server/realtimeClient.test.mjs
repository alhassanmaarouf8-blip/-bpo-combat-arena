/**
 * realtimeClient.test.mjs — the mechanical thread-following backstop must stay bounded:
 * it fires ONLY on substantive answers that opened a NEW thread, only in Teil 1–2, at most
 * 3× per session, never back-to-back, and never when a rescue/correction owns the turn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { threadNudge, firstSentenceBoundary, earlySafeSentence, sanitizeOneTurn } from './realtimeClient.js';

const base = { freshTerms: ['Reiseleiterin'], wordCount: 20, stageIdx: 0, used: 0, cooldown: 0, busy: false };

test('threadNudge: substantive answer with a fresh term → nudge names the term', () => {
  const n = threadNudge(base);
  assert.ok(n && n.includes('Reiseleiterin'), `got: ${n}`);
  assert.ok(n.includes('FADEN'), `got: ${n}`);
});

test('threadNudge: no fresh terms → no nudge (an answer that stays on known ground opens nothing)', () => {
  assert.equal(threadNudge({ ...base, freshTerms: [] }), null);
});

test('threadNudge: short answers never nudge (a 5-word reply is not an opened thread)', () => {
  assert.equal(threadNudge({ ...base, wordCount: 5 }), null);
});

test('threadNudge: roleplay stage stands down (the customer follows its own script)', () => {
  assert.equal(threadNudge({ ...base, stageIdx: 2 }), null);
});

test('threadNudge: session cap of 3 and cooldown block further nudges', () => {
  assert.equal(threadNudge({ ...base, used: 3 }), null);
  assert.equal(threadNudge({ ...base, cooldown: 1 }), null);
});

test('threadNudge: rescue/correction turns are never doubled up', () => {
  assert.equal(threadNudge({ ...base, busy: true }), null);
});

test('threadNudge: at most two terms are quoted', () => {
  const n = threadNudge({ ...base, freshTerms: ['Reiseleiterin', 'Stromanbieter', 'Kündigung'] });
  assert.ok(n.includes('Reiseleiterin') && n.includes('Stromanbieter') && !n.includes('Kündigung'), `got: ${n}`);
});

// ── Sentence-streaming: the early first sentence must be found safely or not at all ──

test('firstSentenceBoundary: finds the first finished sentence once the next one starts', () => {
  const cut = firstSentenceBoundary('Gut. Warum genau haben Sie gewechselt?');
  assert.equal('Gut. Warum genau haben Sie gewechselt?'.slice(0, cut).trim(), 'Gut.');
});

test('firstSentenceBoundary: a question first sentence works too', () => {
  const t = 'Und warum genau? Erzählen Sie mehr davon.';
  const cut = firstSentenceBoundary(t);
  assert.equal(t.slice(0, cut).trim(), 'Und warum genau?');
});

test('firstSentenceBoundary: never cuts at a stream tail (boundary needs following text)', () => {
  assert.equal(firstSentenceBoundary('Gut.'), -1);              // stream may still be mid-line
  assert.equal(firstSentenceBoundary('Gut. '), -1);             // whitespace but no next word yet
});

test('firstSentenceBoundary: German abbreviations do not end a sentence', () => {
  assert.equal(firstSentenceBoundary('Wir brauchen z. B. mehr Beispiele aus dem Alltag'), -1);
  assert.equal(firstSentenceBoundary('Sprechen Sie mit Dr. Weber darüber bitte'), -1);
});

test('firstSentenceBoundary: a lowercase continuation is not a new sentence', () => {
  assert.equal(firstSentenceBoundary('Sie sagten ca. drei Jahre und dann'), -1);
});

test('earlySafeSentence: real sentences pass, guard-trigger lines never speak early', () => {
  assert.equal(earlySafeSentence('Das klingt nach einer spannenden Erfahrung!'), true);
  assert.equal(earlySafeSentence('Ich habe Sie akustisch nicht verstanden.'), false);
  assert.equal(earlySafeSentence('Kandidat: Ich bin bereit.'), false);
  assert.equal(earlySafeSentence('…'), false);
});

// ── sanitizeOneTurn: the self-answer/ramble backstop (owner-reported 2026-07-02, "responded to
// itself") — a legitimate short HR turn must survive untouched; a labeled OR unlabeled hallucinated
// candidate answer tacked onto the end must be cut.

test('sanitizeOneTurn: a normal short reaction + one question passes through unchanged', () => {
  const t = 'Gut, das war konkret. Was war das Ergebnis?';
  assert.equal(sanitizeOneTurn(t), t);
});

test('sanitizeOneTurn: a legitimate 4-sentence Teil-3 transition announcement survives', () => {
  const t = 'So, jetzt machen wir etwas Praktisches. Ich bin ab jetzt ein verärgerter Kunde am Telefon. Sie nehmen den Anruf an. Also, hören Sie zu.';
  assert.equal(sanitizeOneTurn(t), t);
});

test('sanitizeOneTurn: an explicit "Kandidat:" labeled hallucination is still cut (regression)', () => {
  const t = 'Was war das Ergebnis?\nKandidat: Ich habe das Problem gelöst.';
  assert.equal(sanitizeOneTurn(t), 'Was war das Ergebnis?');
});

test('sanitizeOneTurn: an UNLABELED hallucinated candidate answer tacked onto a real turn is cut by the length cap', () => {
  const t = 'Verstehe. Und wie sind Sie da vorgegangen? Ich habe zuerst mit dem Kunden gesprochen. Dann habe ich die Situation geprüft. Danach habe ich eine Lösung vorgeschlagen. Am Ende war der Kunde zufrieden.';
  const out = sanitizeOneTurn(t);
  assert.equal(out, 'Verstehe. Und wie sind Sie da vorgegangen? Ich habe zuerst mit dem Kunden gesprochen. Dann habe ich die Situation geprüft.');
  assert.ok(!out.includes('Am Ende war der Kunde zufrieden'), 'the hallucinated tail must be gone');
});

test('sanitizeOneTurn: two questions in one turn still keeps only the first (regression)', () => {
  const t = 'Warum wollen Sie hier arbeiten? Und was reizt Sie daran?';
  assert.equal(sanitizeOneTurn(t), 'Warum wollen Sie hier arbeiten?');
});

test('sanitizeOneTurn: a leading self-label is still stripped (regression)', () => {
  assert.equal(sanitizeOneTurn('Frau Mona Adel: Kommen wir zum Schluss.'), 'Kommen wir zum Schluss.');
});

// ── sanitizeOneTurn roleplay mode: the angry customer's rant is the emotional climax of Teil 3 —
// the default 1-question/4-sentence caps were amputating the final threat of EVERY scripted
// CS opening (audit 2026-07-04). Roleplay breathes (2 questions, 6 sentences); backstops stay.
test('sanitizeOneTurn roleplay: every scripted CS opening survives intact (with announcement prefix)', async () => {
  const { CS_SCENARIOS } = await import('./scenarios.js');
  for (const cs of CS_SCENARIOS) {
    const full = 'Gut. Wechseln wir die Rolle — ich bin jetzt ein Kunde am Telefon. ' + cs.opening;
    assert.equal(sanitizeOneTurn(full, { roleplay: true }), full, `CS opening amputated: ${cs.id}`);
  }
});

test('sanitizeOneTurn roleplay: a two-question customer rant stays whole, a third question is cut', () => {
  const rant = 'Was soll das? Ich warte seit zwei Wochen auf meine Lieferung und niemand meldet sich!';
  assert.equal(sanitizeOneTurn(rant, { roleplay: true }), rant);
  assert.equal(sanitizeOneTurn('Was? Wieso? Und wann kommt endlich jemand?', { roleplay: true }), 'Was? Wieso?');
});

test('sanitizeOneTurn roleplay: the self-answer newline-marker backstop still fires', () => {
  assert.equal(sanitizeOneTurn('Gute Frage.\nKandidat: Meine Stärke ist Teamarbeit.', { roleplay: true }), 'Gute Frage.');
});

test('sanitizeOneTurn default (interview stages): still one question max — roleplay laxness must not leak', () => {
  assert.equal(sanitizeOneTurn('Was war Ihre Rolle? Und was haben Sie gelernt?'), 'Was war Ihre Rolle?');
});
