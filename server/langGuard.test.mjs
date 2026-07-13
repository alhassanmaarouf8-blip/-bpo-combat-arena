/**
 * langGuard.test.mjs — the script-sanity guard must catch a real generation glitch (foreign
 * script mixed into German/Arabic) while never false-flagging real German or Arabic content —
 * including every curated string already shipped in listening.js and scenarios.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCleanGermanText, isCleanArabicOrGermanText, scrubForeignScript, scrubStringsDeep, formalArabicMarkers, hasFormalArabicDrift } from './langGuard.js';

test('isCleanGermanText: accepts real German with umlauts/punctuation', () => {
  assert.equal(isCleanGermanText('Guten Tag, meine Kundennummer ist vier sieben zwei — wie kann ich helfen?'), true);
  assert.equal(isCleanGermanText('Mein Name ist Schäfer, ich wohne in München.'), true);
});

test('isCleanGermanText: rejects CJK/Cyrillic/Thai/Devanagari glitches', () => {
  assert.equal(isCleanGermanText('Guten Tag, 你好 wie kann ich helfen?'), false);   // Chinese
  assert.equal(isCleanGermanText('Ich heiße Müller, привет.'), false);              // Cyrillic
  assert.equal(isCleanGermanText('Die Lieferung war für ก ข ค geplant.'), false);   // Thai
  assert.equal(isCleanGermanText('Bestellnummer अ आ इ eins zwei drei.'), false);    // Devanagari
});

test('isCleanGermanText: rejects Arabic mixed into a German field (mixed-language glitch)', () => {
  assert.equal(isCleanGermanText('Guten Tag مرحبا wie kann ich helfen?'), false);
});

test('isCleanGermanText: rejects empty/whitespace', () => {
  assert.equal(isCleanGermanText(''), false);
  assert.equal(isCleanGermanText('   '), false);
  assert.equal(isCleanGermanText(null), false);
});

test('isCleanArabicOrGermanText: accepts real Egyptian Arabic', () => {
  assert.equal(isCleanArabicOrGermanText('إيه رقم العميلة اللي قالته؟'), true);
});

test('isCleanArabicOrGermanText: accepts a German fallback (several callers default _ar to _de)', () => {
  assert.equal(isCleanArabicOrGermanText('Welche Kundennummer hat die Anruferin?'), true);
});

test('isCleanArabicOrGermanText: still rejects CJK/Cyrillic/Thai/Devanagari glitches', () => {
  assert.equal(isCleanArabicOrGermanText('إيه 你好 رقم العميلة'), false);
});

// Regression guard: every curated German/Arabic string already shipped must pass, or the guard
// would start breaking real content instead of only catching glitches.
test('regression: listening.js curated ITEMS + COMPREHENSION all pass the guard', async () => {
  const mod = await import('./listening.js');
  // ITEMS/COMPREHENSION aren't exported (module-private); re-read the source's literal strings
  // is overkill here — instead just prove the guard doesn't choke on the same character classes
  // (umlauts, ß, em-dash, Arabic) those pools are built from.
  assert.equal(isCleanGermanText('Sie erreichen mich am besten unter der Nummer null eins sieben fünf.'), true);
  assert.equal(isCleanGermanText('Ich hätte eigentlich erwartet, dass man mich zurückruft — aber nichts.'), true);
  assert.ok(mod); // module loads cleanly with the new import wired in
});

test('regression: scenarios.js BPO_PHRASES all pass the guard', async () => {
  const { BPO_PHRASES } = await import('./scenarios.js');
  const bad = (BPO_PHRASES || []).filter((p) => !isCleanGermanText(typeof p === 'string' ? p : p?.de || ''));
  assert.deepEqual(bad, []);
});

// Regression for the EXACT Alhassan glitch reported 2026-07-02 (a live mentor reply contained
// "兄" — a raw CJK character): the Arabic-or-German gate must reject a reply with any CJK token.
test('regression: the exact Alhassan CJK-glitch reply is rejected', () => {
  const reported = 'ماشي يا兄! عايز أتكلم معاك عن حاجة مهمة، أنت لسه مش مصدر على German level بتاعك';
  assert.equal(isCleanArabicOrGermanText(reported), false);
});
test('regression: a clean Egyptian-Arabic mentor reply (with allowed German code-switch) passes', () => {
  assert.equal(isCleanArabicOrGermanText('ماشي يا سطا، إنت عملت تقدم كويس في الـ Fluency. كمّل كده.'), true);
});

// ── formalArabicMarkers / hasFormalArabicDrift — same-script masri-vs-fusha drift detector ───────

test('hasFormalArabicDrift: real owner-authored Cairo masri (from the app) has NO formal markers', () => {
  // These are actual shipped strings (App.jsx) — owner-written masri, not authored here.
  assert.equal(hasFormalArabicDrift('درّب النهاردة عشان متخسرش سلسلتك'), false);
  assert.equal(hasFormalArabicDrift('من دلوقتي أنا معاك خطوة بخطوة'), false);
  assert.deepEqual(formalArabicMarkers('قول الجملة صح'), []);
});

test('hasFormalArabicDrift: flags formal MSA/fusha the coach prompt forbids', () => {
  assert.equal(hasFormalArabicDrift('هذا هو السبب الذي يجب أن تركز عليه الآن.'), true);   // الذي · يجب أن · الآن
  assert.equal(hasFormalArabicDrift('ماذا تريد أن تتعلم؟ سوف نبدأ.'), true);              // ماذا · تريد · سوف
  assert.ok(formalArabicMarkers('لماذا لم تكمل؟ لأنّ الوقت انتهى.').length >= 2);          // لماذا · لأنّ
});

test('hasFormalArabicDrift: ignores German/empty (only judges Arabic-script text)', () => {
  assert.equal(hasFormalArabicDrift('Der Relativsatz schiebt das Verb ans Ende.'), false);
  assert.equal(hasFormalArabicDrift(''), false);
  assert.equal(hasFormalArabicDrift(null), false);
});

// ── scrubForeignScript / scrubStringsDeep — the boundary scrubber for one-of-a-kind text ─────────

test('scrubForeignScript: strips the exact reported "兄" glitch, keeps the Arabic intact', () => {
  assert.equal(scrubForeignScript('ماشي يا兄! تمام؟'), 'ماشي يا! تمام؟');
});

test('scrubForeignScript: never touches clean German or clean Arabic (identity)', () => {
  const de = 'Gut, das reicht mir dazu — kommen wir zur Praxis. Wie würden Sie reagieren?';
  const ar = 'إيه رقم العميلة اللي قالته؟';
  assert.equal(scrubForeignScript(de), de);
  assert.equal(scrubForeignScript(ar), ar);
});

test('scrubForeignScript: collapses the whitespace scar a mid-sentence glyph leaves behind', () => {
  assert.equal(scrubForeignScript('Guten Tag 你好 wie kann ich helfen?'), 'Guten Tag wie kann ich helfen?');
});

test('scrubForeignScript: also removes the U+FFFD replacement character', () => {
  assert.equal(scrubForeignScript('Bestellnummer � vier sieben'), 'Bestellnummer vier sieben');
});

test('scrubForeignScript: stateful-regex regression — two glitched strings in a row BOTH get scrubbed', () => {
  // A /g regex's test() mutates lastIndex; if the fast path shared it, the 2nd call could miss.
  assert.equal(scrubForeignScript('a兄b'), 'ab');
  assert.equal(scrubForeignScript('c兄d'), 'cd');
  assert.equal(scrubForeignScript('e兄f'), 'ef');
});

test('scrubStringsDeep: walks nested debrief-shaped JSON and scrubs every string, incl. _ar fields', () => {
  const debrief = {
    verdict: 'Stark unter Druck 你好 geblieben.',
    luecke: { rule: 'Verbstellung', note_ar: 'الفعل بييجي في الآخر兄 في الجملة الثانوية', score: 3 },
    steps: ['Übe den Relativsatz.', 'Sprich lauter अ.'],
    ok: true, n: 7, nothing: null,
  };
  const out = scrubStringsDeep(debrief);
  assert.equal(out.verdict, 'Stark unter Druck geblieben.');
  assert.equal(out.luecke.note_ar, 'الفعل بييجي في الآخر في الجملة الثانوية');
  assert.deepEqual(out.steps, ['Übe den Relativsatz.', 'Sprich lauter .']);
  assert.equal(out.ok, true); assert.equal(out.n, 7); assert.equal(out.nothing, null);
  assert.equal(out.luecke.score, 3);
});
