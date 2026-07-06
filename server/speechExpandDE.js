/**
 * speechExpandDE.js — deterministic German speech expansion for TTS (ROADMAP #20).
 *
 * Digits, currency, times and common abbreviations reach the voice engines raw on every
 * path ("19,99 €", "24h", "z. B.") and the engine decides how to read them — sometimes in
 * English, sometimes awkwardly. This module expands them into the exact German words a
 * human interviewer would say, so what the learner HEARS is never engine luck.
 *
 * Pure, $0, no dependencies, unit-tested. Applied centrally in cleanForTTS (all TTS paths).
 * Deliberately conservative: anything ambiguous (ordinals like "am 2. Juli", digits glued
 * to letters like "v2") is left for the engine — expansion must never make speech WORSE.
 * Known limit: pre-2000 years read as cardinals ("1999" → "eintausend…", not
 * "neunzehnhundert…") — acceptable; boss content doesn't reference 19xx years.
 */

const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

function below100(n, oneWord) {
  if (n < 20) return n === 1 ? oneWord : ONES[n];
  const t = Math.floor(n / 10), u = n % 10;
  if (!u) return TENS[t];
  return `${u === 1 ? 'ein' : ONES[u]}und${TENS[t]}`;
}

function below1000(n, oneWord) {
  const h = Math.floor(n / 100), r = n % 100;
  if (!h) return below100(r, oneWord);
  const head = `${h === 1 ? 'ein' : ONES[h]}hundert`;
  return r ? head + below100(r, 'eins') : head;
}

/** Cardinal 0…999999 → German words ("eins" standalone; compounds use "ein…"). */
export function numberToWordsDE(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n >= 1_000_000) return String(n);   // out of scope — leave the digits to the engine
  if (n < 1000) return below1000(n, 'eins');
  const t = Math.floor(n / 1000), r = n % 1000;
  const head = `${t === 1 ? 'ein' : below1000(t, 'ein')}tausend`;
  return r ? head + below1000(r, 'eins') : head;
}

// "1" needs its adjectival form before a noun: "ein Euro", "eine Stunde" — never "eins Euro".
const euroWords = (n) => (n === 1 ? 'ein Euro' : `${numberToWordsDE(n)} Euro`);
const centWords = (n) => (n === 1 ? 'ein Cent' : `${numberToWordsDE(n)} Cent`);

// Unambiguous spoken abbreviations only (case-sensitive; plain replacement — a lost
// sentence-final dot after "usw." costs a pause, digits read in English cost trust).
const ABBREV = [
  [/\bz\.\s?B\./g, 'zum Beispiel'],
  [/\bd\.\s?h\./g, 'das heißt'],
  [/\bu\.\s?a\./g, 'unter anderem'],
  [/\bbzw\./g, 'beziehungsweise'],
  [/\bca\./g, 'circa'],
  [/\busw\./g, 'und so weiter'],
  [/\bggf\./g, 'gegebenenfalls'],
  [/\bevtl\./g, 'eventuell'],
  [/\binkl\./g, 'inklusive'],
  [/\bzzgl\./g, 'zuzüglich'],
  [/\bNr\./g, 'Nummer'],
  [/\bStd\./g, 'Stunden'],
  [/\bMin\./g, 'Minuten'],
];

/** Expand digits/€/%/times/abbreviations into spoken German. Idempotent on expanded text. */
export function expandForSpeechDE(text) {
  let t = String(text || '');
  if (!/[\d]|[A-Za-zäöü]\./.test(t)) return t;   // fast path: nothing expandable

  t = t.replace(/\b24\s*\/\s*7\b/g, 'rund um die Uhr');

  // Currency — normalize the "€ 19,99" prefix form, then cents form, then whole euros.
  t = t.replace(/€\s*(\d{1,6}(?:,\d{1,2})?)/g, '$1 €');
  t = t.replace(/\b(\d{1,6}),(\d{2})\s*(?:€|Euro\b)/g, (_, e, c) =>
    (+c) ? `${euroWords(+e)} und ${centWords(+c)}` : euroWords(+e));
  t = t.replace(/\b(\d{1,6})\s*(?:€|Euro\b)/g, (_, e) => euroWords(+e));

  t = t.replace(/\b(\d{1,6})\s*%/g, (_, n) => `${numberToWordsDE(+n)} Prozent`);

  // Times: "14:30 Uhr" / "14:30" → "vierzehn Uhr dreißig" (a boss says appointments, not ratios).
  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(\s*Uhr)?\b/g, (_, h, m) =>
    (+m) ? `${numberToWordsDE(+h)} Uhr ${numberToWordsDE(+m)}` : `${numberToWordsDE(+h)} Uhr`);

  // Hour shorthand: "24h" / "24 h" → spoken hours.
  t = t.replace(/\b(\d{1,3})\s*h\b/g, (_, n) =>
    (+n === 1) ? 'eine Stunde' : `${numberToWordsDE(+n)} Stunden`);

  // Decimal comma (non-currency, already-consumed forms excluded): "3,5" → "drei Komma fünf".
  t = t.replace(/\b(\d{1,4}),(\d{1,4})\b/g, (_, i, d) =>
    `${numberToWordsDE(+i)} Komma ${d.split('').map((x) => ONES[+x]).join(' ')}`);

  // Standalone integers — but never digits before a dot (ordinal "am 2. Juli" stays for the
  // engine, which reads German ordinals correctly), a decimal, a time colon, or more digits.
  t = t.replace(/\b(\d{1,6})\b(?!\.|,\d|:\d|\d)/g, (_, n) => numberToWordsDE(+n));

  for (const [re, word] of ABBREV) t = t.replace(re, word);
  return t;
}
