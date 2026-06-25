/**
 * listening.js — LISTENING + LIVE DATA-CAPTURE drill (PAID). "The interview in reverse."
 *
 * WHY: real inbound BPO work is ~70% LISTENING, and the #1 reason a fluent-sounding candidate
 * gets rejected is that they freeze when a German native speaks fast and a key detail (a number,
 * name, order id, date, amount) is buried in the sentence. Our other features train SPEAKING;
 * this trains the half that actually fails people.
 *
 * HOW (zero added cost — no STT, no LLM, no paid TTS):
 *   - The BROWSER speaks a natural German line at full speed via speechSynthesis (free). The text
 *     is sent to the client ONLY to feed the speech engine; the client never DISPLAYS it — the
 *     whole point is to catch the detail by EAR.
 *   - The learner TYPES the detail they heard (exactly the real data-capture skill). Grading is
 *     DETERMINISTIC (normalize + compare) — no model, never inaccurate.
 *
 *   GET  /api/listening            → { items:[{id, type, audioText, question_de, question_ar, replays}] }
 *   POST /api/listening/grade      → { id, response } → { correct, expected, normalizedYou }
 *
 * Gated like other paid practice: requireAuth + active plan (planOf !== 'free').
 */
import express from 'express';
import { requireAuth, planOf } from './auth.js';

export const listeningRouter = express.Router();

const PER_SESSION = 5;
const REPLAYS     = 1;   // how many times the learner may replay before answering (1 = hear it twice total)

// Authored items. `answer` is the canonical capture; it stays SERVER-SIDE (never sent in GET).
// audioText is natural, native-speed German with the detail embedded mid-sentence.
const ITEMS = [
  { type: 'nummer', audioText: 'Guten Tag, hier ist Frau Schneider. Meine Kundennummer ist vier sieben zwei neun null eins, und ich rufe wegen meiner letzten Rechnung an.',
    question_de: 'Welche Kundennummer hat die Anruferin?', question_ar: 'إيه رقم العميلة اللي قالته؟', answer: '472901' },
  { type: 'nummer', audioText: 'Ja hallo, ich wollte fragen — meine Bestellnummer lautet acht drei sechs fünf zwei sieben, stimmt da etwas nicht mit der Lieferung?',
    question_de: 'Wie lautet die Bestellnummer?', question_ar: 'إيه رقم الطلب؟', answer: '836527' },
  { type: 'betrag', audioText: 'Also, auf meiner Rechnung steht ein Betrag von zweihundertneunundsechzig Euro und vierzig Cent, und das kann eigentlich nicht stimmen.',
    question_de: 'Welcher Betrag steht auf der Rechnung? (nur die Zahl, z. B. 269,40)', question_ar: 'إيه المبلغ اللي على الفاتورة؟ (الرقم بس)', answer: '269,40' },
  { type: 'name', audioText: 'Mein Name ist Maier — das schreibt man M, A, I, E, R, nicht mit Y am Ende.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب اسم العيلة؟', answer: 'maier' },
  { type: 'name', audioText: 'Ich heiße Krückeberg, also K, R, Ü, C, K, E, B, E, R, G.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب اسم العيلة؟', answer: 'krückeberg' },
  { type: 'datum', audioText: 'Die Lieferung war für den einundzwanzigsten März angekündigt, aber sie ist bis heute nicht da.',
    question_de: 'Für welchen Tag war die Lieferung angekündigt? (z. B. 21.03)', question_ar: 'الشحنة كانت متحددة لأنهي يوم؟', answer: '21.03' },
  { type: 'nummer', audioText: 'Sie erreichen mich am besten unter der Nummer null eins sieben fünf, drei drei zwei, acht null vier eins.',
    question_de: 'Welche Telefonnummer nennt der Kunde?', question_ar: 'إيه رقم التليفون اللي قاله؟', answer: '01753328041' },
  { type: 'adresse', audioText: 'Meine Adresse ist Lindenstraße siebzehn, in vierzig zwei sieben sieben Düsseldorf.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟ (5 أرقام)', answer: '40277' },
  { type: 'nummer', audioText: 'Guten Tag, meine Vertragsnummer ist neun null drei, sieben sechs, fünf vier. Es geht um eine Kündigung.',
    question_de: 'Wie lautet die Vertragsnummer?', question_ar: 'إيه رقم العقد؟', answer: '9037654' },
  { type: 'betrag', audioText: 'Sie haben mir hundertvierunddreißig Euro neunzig abgebucht, aber ich habe nur achtundneunzig Euro bestellt.',
    question_de: 'Welcher Betrag wurde abgebucht? (z. B. 134,90)', question_ar: 'إيه المبلغ اللي اتسحب؟', answer: '134,90' },
  { type: 'name', audioText: 'Mein Name ist Schäfer — mit ä, also S, C, H, Ä, F, E, R.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب الاسم؟', answer: 'schäfer' },
  { type: 'datum', audioText: 'Mein Termin war eigentlich am dritten Februar um vierzehn Uhr, aber niemand kam.',
    question_de: 'An welchem Tag war der Termin? (z. B. 03.02)', question_ar: 'إمتى كان الموعد؟', answer: '03.02' },
  { type: 'nummer', audioText: 'Die Sendungsnummer ist eins zwei drei, vier fünf sechs, sieben acht neun null.',
    question_de: 'Wie lautet die Sendungsnummer?', question_ar: 'إيه رقم الشحنة؟', answer: '1234567890' },
  { type: 'adresse', audioText: 'Bitte schicken Sie es an die Goethestraße dreiundvierzig, achtzig drei drei sieben München.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟', answer: '80337' },
];

function paidOnly(req, res) {
  if (planOf(req.account) === 'free') { res.status(402).json({ error: 'plan_required', reason: 'listening_is_paid' }); return false; }
  return true;
}

// Deterministic normalization for comparison. Numbers → digits only; text → lowercased,
// spaces/punctuation stripped (umlauts kept). A comma in a money amount is preserved.
function normalize(s, type) {
  const raw = String(s ?? '').toLowerCase().trim();
  if (type === 'betrag') {
    // keep digits and a single decimal separator (comma or dot → comma)
    return raw.replace(/[^0-9.,]/g, '').replace(/\./g, ',').replace(/,(?=.*,)/g, '');
  }
  if (type === 'nummer' || type === 'datum' || type === 'adresse') {
    return raw.replace(/[^0-9.]/g, '');   // digits (+ dots for dates) only
  }
  return raw.normalize('NFC').replace(/[^a-zäöüß]/g, '');   // names: letters only
}

function pick(n) {
  const idx = ITEMS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, n);
}

// GET a fresh session — audioText included (for the browser's speech engine) but the client
// MUST NOT display it; the answer is never sent.
listeningRouter.get('/listening', requireAuth, (req, res) => {
  if (!paidOnly(req, res)) return;
  const items = pick(Math.min(PER_SESSION, ITEMS.length)).map((i) => ({
    id: i, type: ITEMS[i].type, audioText: ITEMS[i].audioText,
    question_de: ITEMS[i].question_de, question_ar: ITEMS[i].question_ar, replays: REPLAYS,
  }));
  res.json({ items });
});

// POST a typed capture → deterministic correct/incorrect (no model).
listeningRouter.post('/listening/grade', express.json({ limit: '8kb' }), requireAuth, (req, res) => {
  if (!paidOnly(req, res)) return;
  const id = parseInt(req.body?.id, 10);
  if (!Number.isInteger(id) || id < 0 || id >= ITEMS.length) return res.status(400).json({ error: 'bad_item' });
  const item = ITEMS[id];
  const you  = normalize(req.body?.response, item.type);
  const want = normalize(item.answer, item.type);
  const correct = you.length > 0 && you === want;
  console.log(`[listening] user=${req.account.id} id=${id} type=${item.type} correct=${correct}`);
  res.json({ correct, expected: item.answer, normalizedYou: you });
});
