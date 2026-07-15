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
import { createHash, randomBytes } from 'crypto';
import { requireAuth, planOf, drillsUnlocked } from './auth.js';
import { loadUser, mutateUser, saveUser }  from './store.js';
import { isCleanGermanText, isCleanArabicOrGermanText } from './langGuard.js';
import { beginListeningPlayback, commitListeningGrade, finishListeningPlayback } from './listeningEvidence.js';
import { issueDrillEvidenceReceipt } from './drillEvidence.js';

export const listeningRouter = express.Router();

// Level → base playback speed. A beginner hears the SAME native line slower; an advanced learner
// faster — genuine difficulty scaling for listening (the within-session ramp is added on top).
function baseRateFor(level) {
  if (level === 'C1') return 1.25;
  if (level === 'B2') return 1.1;
  if (level === 'A1' || level === 'A2') return 0.9;
  return 1.0;   // B1 / unknown
}

const PER_SESSION = 5;
const REPLAYS     = 1;   // how many times the learner may replay before answering (1 = hear it twice total)

function evidenceContentHash(row, stored) {
  return createHash('sha256').update(JSON.stringify({
    kind: row.kind === 'verstehen' ? 'verstehen' : 'detail',
    type: typeof row.type === 'string' ? row.type : '',
    audioText: String(row.audioText || ''),
    question: String(row.question_de || ''),
    options: Array.isArray(row.options) ? row.options : [],
    expected: stored?.answer ?? stored?.correct ?? null,
  })).digest('hex');
}

// ── Distinct native-German voices (owner 07-04: every caller in a session must sound like a
// DIFFERENT German human — real inbound work is a parade of different voices, not one narrator).
// These are exactly the 7 Aura-2 German voices /api/tts-stream allows (transcribeRouter.js).
// Gender is inferred deterministically from the item's OWN wording (die Anruferin/Kundin/Frau …
// vs der Anrufer/Kunde/Herr …) so a caller the question names as a woman never speaks with a
// male voice. Unknown gender → alternate pools for maximum variety.
const VOICES_F = ['aura-2-elara-de', 'aura-2-viktoria-de', 'aura-2-aurelia-de', 'aura-2-kara-de', 'aura-2-lara-de'];
const VOICES_M = ['aura-2-julius-de', 'aura-2-fabian-de'];

export function inferSpeakerGender(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  if (/\b(anruferin|kundin)\b/u.test(t) || /\bfrau\s+\p{L}/u.test(t)) return 'f';
  if (/\b(anrufer|kunde|herr)\b/u.test(t)) return 'm';
  return null;
}

// Per-session voice picker: shuffled pools, no repeat until a pool is exhausted — so the five
// callers of a round are five DIFFERENT German humans (5 female + 2 male voices available).
export function makeVoicePicker() {
  const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  const pools = { f: shuffle(VOICES_F), m: shuffle(VOICES_M) };
  const used  = { f: 0, m: 0 };
  let flip = Math.random() < 0.5;
  const remaining = (g) => pools[g].length - used[g];
  return (genderHint) => {
    let g = genderHint;
    if (g !== 'f' && g !== 'm') {
      // Unknown gender: alternate for texture, but never burn a repeat while the OTHER pool
      // still has unheard voices (the male pool has only 2 — it runs dry first).
      g = flip ? 'f' : 'm'; flip = !flip;
      if (remaining(g) <= 0 && remaining(g === 'f' ? 'm' : 'f') > 0) g = (g === 'f' ? 'm' : 'f');
    }
    const v = pools[g][used[g] % pools[g].length];
    used[g] += 1;
    return v;
  };
}

// ── NOVEL-ITEM GENERATION (Groq llama-3.3-70b) ───────────────────────────────────
// WHY: a FIXED pool (~26 items) repeats once the learner finishes it — disrespectful "loops".
// So we GENERATE fresh German listening items each round; a learner who finishes and reopens
// gets new content. Same OpenAI-compatible Groq endpoint used everywhere else (no new service).
// Listening items need QUALITY (the audio must actually contain the answer to the question) — 8b produced
// mismatched/unanswerable items, so we use the strong model. When its free daily quota is exhausted the
// call 429s and we fall back to the CURATED fixed pool (correct content, may repeat) rather than show a
// bad generated item. GROQ_DRILL_MODEL lets the owner point it at the upgraded (uncapped) model.
const GEN_MODEL  = process.env.GROQ_DRILL_MODEL ?? process.env.GROQ_INTERVIEW_MODEL ?? 'llama-3.3-70b-versatile';
const GROQ_CHAT  = 'https://api.groq.com/openai/v1/chat/completions';
const GEN_TTL_MS = 90_000;        // brief per-user cache → dedupes rapid re-fetches, bounds cost
const TYPES      = ['nummer', 'betrag', 'name', 'datum', 'adresse'];
const AVOID_KEEP = 12;            // how many recent topics we ask the model to avoid

// In-memory, per-user generation cache. Keyed by account id → { ts, payload, active }.
// Short TTL so a quick double-load (StrictMode / retry / ?t= cache-bust) doesn't double-bill,
// while a genuine reopen later still produces NOVEL content.
const genCache = new Map();

// Authored items. `answer` is the canonical capture; it stays SERVER-SIDE (never sent in GET).
// audioText is natural, native-speed German with the detail embedded mid-sentence.
export const ITEMS = [
  { type: 'nummer', audioText: 'Guten Tag, hier ist Frau Schneider. Meine Kundennummer ist vier sieben zwei neun null eins, und ich rufe wegen meiner letzten Rechnung an.',
    question_de: 'Welche Kundennummer hat die Anruferin?', question_ar: 'إيه رقم العميلة اللي قالته؟', answer: '472901' },
  { type: 'nummer', audioText: 'Ja hallo, ich wollte fragen — meine Bestellnummer lautet acht drei sechs fünf zwei sieben, stimmt da etwas nicht mit der Lieferung?',
    question_de: 'Wie lautet die Bestellnummer?', question_ar: 'إيه رقم الطلب؟', answer: '836527' },
  { type: 'betrag', audioText: 'Also, auf meiner Rechnung steht ein Betrag von zweihundertneunundsechzig Euro und vierzig Cent, und das kann eigentlich nicht stimmen.',
    question_de: 'Welcher Betrag steht auf der Rechnung? (nur die Zahl, z. B. 129,90)', question_ar: 'إيه المبلغ اللي على الفاتورة؟ (الرقم بس)', answer: '269,40' },
  { type: 'name', audioText: 'Mein Name ist Maier — das schreibt man M, A, I, E, R, nicht mit Y am Ende.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب اسم العيلة؟', answer: 'maier' },
  { type: 'name', audioText: 'Ich heiße Krückeberg, also K, R, Ü, C, K, E, B, E, R, G.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب اسم العيلة؟', answer: 'krückeberg' },
  { type: 'datum', audioText: 'Die Lieferung war für den einundzwanzigsten März angekündigt, aber sie ist bis heute nicht da.',
    question_de: 'Für welchen Tag war die Lieferung angekündigt? (z. B. 05.11)', question_ar: 'الشحنة كانت متحددة لأنهي يوم؟', answer: '21.03' },
  { type: 'nummer', audioText: 'Sie erreichen mich am besten unter der Nummer null eins sieben fünf, drei drei zwei, acht null vier eins.',
    question_de: 'Welche Telefonnummer nennt der Kunde?', question_ar: 'إيه رقم التليفون اللي قاله؟', answer: '01753328041' },
  { type: 'adresse', audioText: 'Meine Adresse ist Lindenstraße siebzehn, in vierzig zwei sieben sieben Düsseldorf.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟ (5 أرقام)', answer: '40277' },
  { type: 'nummer', audioText: 'Guten Tag, meine Vertragsnummer ist neun null drei, sieben sechs, fünf vier. Es geht um eine Kündigung.',
    question_de: 'Wie lautet die Vertragsnummer?', question_ar: 'إيه رقم العقد؟', answer: '9037654' },
  { type: 'betrag', audioText: 'Sie haben mir hundertvierunddreißig Euro neunzig abgebucht, aber ich habe nur achtundneunzig Euro bestellt.',
    question_de: 'Welcher Betrag wurde abgebucht? (z. B. 129,90)', question_ar: 'إيه المبلغ اللي اتسحب؟', answer: '134,90' },
  { type: 'name', audioText: 'Mein Name ist Schäfer — mit ä, also S, C, H, Ä, F, E, R.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب الاسم؟', answer: 'schäfer' },
  { type: 'datum', audioText: 'Mein Termin war eigentlich am dritten Februar um vierzehn Uhr, aber niemand kam.',
    question_de: 'An welchem Tag war der Termin? (z. B. 05.11)', question_ar: 'إمتى كان الموعد؟', answer: '03.02' },
  { type: 'nummer', audioText: 'Die Sendungsnummer ist eins zwei drei, vier fünf sechs, sieben acht neun null.',
    question_de: 'Wie lautet die Sendungsnummer?', question_ar: 'إيه رقم الشحنة؟', answer: '1234567890' },
  { type: 'adresse', audioText: 'Bitte schicken Sie es an die Goethestraße dreiundvierzig, achtzig drei drei sieben München.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟', answer: '80337' },
  { type: 'nummer', audioText: 'Guten Tag, meine Kundennummer ist drei fünf acht, zwei null, neun sieben. Ich habe eine Frage zur Rechnung.',
    question_de: 'Welche Kundennummer nennt der Anrufer?', question_ar: 'إيه رقم العميل؟', answer: '3582097' },
  { type: 'betrag', audioText: 'Auf meiner Rechnung stehen einhundertneunundachtzig Euro fünfzig, aber das stimmt nicht.',
    question_de: 'Welcher Betrag steht auf der Rechnung? (z. B. 129,90)', question_ar: 'إيه المبلغ على الفاتورة؟', answer: '189,50' },
  { type: 'name', audioText: 'Mein Name ist Böttcher — also B, Ö, T, T, C, H, E, R.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب الاسم؟', answer: 'böttcher' },
  { type: 'datum', audioText: 'Der Techniker sollte am siebten Mai kommen, aber er ist nicht erschienen.',
    question_de: 'An welchem Tag sollte der Techniker kommen? (z. B. 05.11)', question_ar: 'الفني كان المفروض ييجي إمتى؟', answer: '07.05' },
  { type: 'nummer', audioText: 'Sie erreichen mich unter null eins sechs zwei, vier vier acht, neun null drei eins.',
    question_de: 'Welche Telefonnummer nennt der Kunde?', question_ar: 'إيه رقم التليفون؟', answer: '01624489031' },
  { type: 'adresse', audioText: 'Ich wohne in der Hauptstraße neun, zehn vier neun sechs Berlin.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟', answer: '10496' },
  { type: 'betrag', audioText: 'Mir wurden zweihundertfünfzehn Euro zwanzig abgebucht, das ist zu viel.',
    question_de: 'Welcher Betrag wurde abgebucht? (z. B. 129,90)', question_ar: 'إيه المبلغ اللي اتسحب؟', answer: '215,20' },
  { type: 'nummer', audioText: 'Die Bestellnummer ist sieben sieben zwei, eins drei, vier acht. Es geht um eine Reklamation.',
    question_de: 'Wie lautet die Bestellnummer?', question_ar: 'إيه رقم الطلب؟', answer: '7721348' },
  { type: 'name', audioText: 'Ich heiße Wagner — ganz normal: W, A, G, N, E, R.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب الاسم؟', answer: 'wagner' },
  { type: 'datum', audioText: 'Die Lieferung war für den neunzehnten Oktober geplant und kam nie an.',
    question_de: 'Für welchen Tag war die Lieferung geplant? (z. B. 05.11)', question_ar: 'الشحنة كانت لأنهي يوم؟', answer: '19.10' },
  { type: 'nummer', audioText: 'Meine Vertragsnummer lautet vier null sechs, acht eins, sieben drei.',
    question_de: 'Wie lautet die Vertragsnummer?', question_ar: 'إيه رقم العقد؟', answer: '4068173' },
  { type: 'betrag', audioText: 'Die Gesamtsumme beträgt dreihundertzweiundvierzig Euro neunzig.',
    question_de: 'Wie hoch ist die Gesamtsumme? (z. B. 129,90)', question_ar: 'إيه إجمالي المبلغ؟', answer: '342,90' },
  // ── 07-04 expansion (+12): more callers, same standardized questions (Arabic strings are
  //    VERBATIM reuses of the approved pairs above — never newly authored). ──────────────────
  { type: 'nummer', audioText: 'Schönen guten Tag, Weber hier. Meine Kundennummer habe ich da — Moment — das ist die fünf acht drei, sieben null, zwei sechs.',
    question_de: 'Welche Kundennummer nennt der Anrufer?', question_ar: 'إيه رقم العميل؟', answer: '5837026' },
  { type: 'nummer', audioText: 'Es geht um meine Bestellung von letzter Woche — die Bestellnummer ist zwei neun vier, acht sechs, drei eins.',
    question_de: 'Wie lautet die Bestellnummer?', question_ar: 'إيه رقم الطلب؟', answer: '2948631' },
  { type: 'nummer', audioText: 'Am besten rufen Sie mich einfach zurück, meine Nummer ist null eins fünf sieben, neun neun, vier drei, acht sechs.',
    question_de: 'Welche Telefonnummer nennt der Kunde?', question_ar: 'إيه رقم التليفون؟', answer: '0157994386' },
  { type: 'nummer', audioText: 'Auf dem Schreiben steht meine Vertragsnummer, warten Sie — sechs eins acht, null drei, fünf sieben. Können Sie damit etwas anfangen?',
    question_de: 'Wie lautet die Vertragsnummer?', question_ar: 'إيه رقم العقد؟', answer: '6180357' },
  { type: 'betrag', audioText: 'Ich sehe hier eine Abbuchung über siebenundfünfzig Euro und dreißig Cent, die ich überhaupt nicht zuordnen kann.',
    question_de: 'Welcher Betrag wurde abgebucht? (z. B. 129,90)', question_ar: 'إيه المبلغ اللي اتسحب؟', answer: '57,30' },
  { type: 'betrag', audioText: 'In der Mahnung, die gestern kam, steht eine Gesamtsumme von vierhundertzwölf Euro fünfundachtzig — das kann unmöglich stimmen.',
    question_de: 'Wie hoch ist die Gesamtsumme? (z. B. 129,90)', question_ar: 'إيه إجمالي المبلغ؟', answer: '412,85' },
  { type: 'betrag', audioText: 'Auf der Rechnung stehen jetzt zusätzlich zwölf Euro neunzig für den Versand, obwohl mir Versandkostenfreiheit zugesagt worden war.',
    question_de: 'Welcher Betrag steht auf der Rechnung? (z. B. 129,90)', question_ar: 'إيه المبلغ على الفاتورة؟', answer: '12,90' },
  { type: 'name', audioText: 'Guten Tag, mein Name ist Petzold — P wie Paula, E, T, Z, O, L, D.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب الاسم؟', answer: 'petzold' },
  { type: 'name', audioText: 'Hier spricht Frau Öztürk — das schreibt sich Ö, Z, T, Ü, R, K.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب اسم العيلة؟', answer: 'öztürk' },
  { type: 'datum', audioText: 'Wir hatten den Umtausch fest für den vierzehnten Juni vereinbart, aber in Ihrem System steht offenbar nichts davon.',
    question_de: 'An welchem Tag war der Termin? (z. B. 05.11)', question_ar: 'إمتى كان الموعد؟', answer: '14.06' },
  { type: 'adresse', audioText: 'Die Rechnung ging noch an meine alte Adresse — ich wohne jetzt in der Mozartstraße zwölf, in fünf sechs null sieben null Koblenz.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟ (5 أرقام)', answer: '56070' },
  { type: 'adresse', audioText: 'Schicken Sie das Ersatzgerät bitte in die Bahnhofstraße fünf, vier sieben null fünf drei Duisburg.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟', answer: '47053' },

  // ── Floor language (KB §4/§8B, 2026-07-10): the learner must also understand their future TEAM
  // LEADER, not only customers — AHT, Servicelevel, Nachbearbeitung, Adhärenz are day-1 training
  // vocabulary on every real German account. Same capture contract as above.
  // question_ar mirrors German for now — OWNER-AR slots (never authored here).
  { type: 'nummer', audioText: 'Kurzes Team-Update: Unsere durchschnittliche Bearbeitungszeit, also die AHT, liegt aktuell bei sieben Minuten — das Ziel für diesen Monat sind sechs Minuten.',
    question_de: 'Wie viele Minuten beträgt die Ziel-AHT?', question_ar: 'كام دقيقة الـ AHT المطلوبة؟', answer: '6' },
  { type: 'nummer', audioText: 'Zur Erinnerung: Unser Servicelevel ist achtzig zwanzig — achtzig Prozent der Anrufe müssen innerhalb von zwanzig Sekunden angenommen werden.',
    question_de: 'Innerhalb wie vieler Sekunden müssen die Anrufe angenommen werden?', question_ar: 'لازم يترد على المكالمات في كام ثانية؟', answer: '20' },
  { type: 'nummer', audioText: 'Bitte haltet die Nachbearbeitungszeit unter neunzig Sekunden, sonst leidet unsere Erreichbarkeit in der Warteschleife.',
    question_de: 'Wie viele Sekunden Nachbearbeitungszeit sind maximal erlaubt?', question_ar: 'كام ثانية أقصى وقت مسموح بيه بعد المكالمة؟', answer: '90' },
  { type: 'nummer', audioText: 'Denkt bitte daran: Beschwerden zur Rechnung gehen ab sofort direkt an die Eskalationsstufe zwei, nicht mehr an Stufe eins.',
    question_de: 'An welche Eskalationsstufe gehen Rechnungsbeschwerden jetzt?', question_ar: 'شكاوى الفواتير بتتبعت لأنهي مستوى تصعيد دلوقتي؟', answer: '2' },
  { type: 'nummer', audioText: 'Diese Woche werden vier eurer Gespräche vom Qualitätsmonitoring bewertet — den Bewertungsbogen findet ihr wie immer im Portal.',
    question_de: 'Wie viele Gespräche werden vom Qualitätsmonitoring bewertet?', question_ar: 'كام مكالمة هيقيّمها فريق الجودة؟', answer: '4' },
  { type: 'nummer', audioText: 'Unsere Erstlösungsquote liegt im Moment bei zweiundsiebzig Prozent — das Ziel bleibt fünfundachtzig Prozent.',
    question_de: 'Wie hoch ist die Ziel-Erstlösungsquote in Prozent?', question_ar: 'كام في المية النسبة المطلوبة لحل المشكلة من أول مكالمة؟', answer: '85' },
  { type: 'datum', audioText: 'Dein Coaching-Gespräch mit dem Qualitätsteam ist am fünfzehnten April, direkt nach deiner Schicht.',
    question_de: 'An welchem Tag ist das Coaching-Gespräch? (z. B. 05.11)', question_ar: 'إمتى ميعاد جلسة الكوتشينج؟ (مثلاً 05.11)', answer: '15.04' },
  { type: 'nummer', audioText: 'Und bitte achtet auf eure Adhärenz, also die Einhaltung des Schichtplans: mindestens fünfundneunzig Prozent sind gefordert.',
    question_de: 'Wie viel Prozent Adhärenz ist gefordert?', question_ar: 'كام في المية الالتزام بالشيفت المطلوب؟', answer: '95' },
];

// ── COMPREHENSION items (owner's #1): understand COMPLEX native German, not just catch a number. ──
// Each `audioText` is a real call-center utterance at B2–C1: subordinate clauses (weil/obwohl/nachdem/
// wenn/dass) with the verbs piled at the END the way Germans actually speak. The learner hears it and
// answers ONE meaning question as multiple choice → graded deterministically on the correct index (honest,
// never fabricated). `q` = question, `opts` = {de,ar} choices, `correct` = index into opts.
export const COMPREHENSION = [
  { audioText: 'Ich hätte eigentlich erwartet, dass man mich zurückruft, nachdem ich das Formular, das Sie mir zugeschickt hatten, längst ausgefüllt zurückgesendet habe — aber passiert ist bis heute nichts.',
    q_de: 'Was erwartet der Kunde?', q_ar: 'العميل مستني إيه؟',
    opts: [{ de: 'einen Rückruf', ar: 'مكالمة ترجعله' }, { de: 'ein neues Formular', ar: 'استمارة جديدة' }, { de: 'eine Rückerstattung', ar: 'استرداد فلوس' }, { de: 'einen Termin vor Ort', ar: 'ميعاد في الفرع' }], correct: 0 },
  { audioText: 'Es kann doch nicht sein, dass ich, obwohl ich den Vertrag fristgerecht gekündigt habe, weiterhin Rechnungen bekomme, die ich eigentlich längst nicht mehr bezahlen müsste.',
    q_de: 'Worüber beschwert sich der Kunde?', q_ar: 'العميل بيشتكي من إيه؟',
    opts: [{ de: 'Er bekommt trotz Kündigung noch Rechnungen', ar: 'لسه بتيجيله فواتير رغم الإلغاء' }, { de: 'Er konnte den Vertrag nicht kündigen', ar: 'مقدرش يلغي العقد' }, { de: 'Er hat zu wenig bezahlt', ar: 'دفع أقل من اللازم' }, { de: 'Er möchte einen neuen Vertrag', ar: 'عايز عقد جديد' }], correct: 0 },
  { audioText: 'Wenn Sie mir jetzt nicht garantieren können, dass das Gerät, das ich vorletzte Woche eingeschickt habe, bis Freitag repariert bei mir ankommt, dann muss ich mir das mit dem Vertrag ernsthaft überlegen.',
    q_de: 'Was verlangt der Kunde?', q_ar: 'العميل بيطلب إيه؟',
    opts: [{ de: 'eine Reparatur bis Freitag', ar: 'تصليح قبل الجمعة' }, { de: 'sofort ein neues Gerät', ar: 'جهاز جديد حالًا' }, { de: 'sein Geld zurück', ar: 'فلوسه ترجع' }, { de: 'eine schriftliche Entschuldigung', ar: 'اعتذار مكتوب' }], correct: 0 },
  { audioText: 'Mir wurde am Telefon zugesichert, dass die Gebühr, die man mir letzten Monat berechnet hatte, wieder gutgeschrieben werde — gesehen habe ich davon allerdings bisher überhaupt nichts.',
    q_de: 'Was wurde dem Kunden versprochen?', q_ar: 'العميل اتوعد بإيه؟',
    opts: [{ de: 'die Gebühr zurückzubekommen', ar: 'إن الرسوم ترجعله' }, { de: 'einen Rabatt auf den nächsten Kauf', ar: 'خصم على الشراء الجاي' }, { de: 'eine schnellere Lieferung', ar: 'توصيل أسرع' }, { de: 'ein kostenloses Upgrade', ar: 'ترقية مجانية' }], correct: 0 },
  { audioText: 'Ich rufe an, weil die Bestellung, von der man mir versprochen hatte, sie werde noch am selben Tag verschickt, inzwischen seit über einer Woche einfach nicht angekommen ist.',
    q_de: 'Was ist das Problem?', q_ar: 'المشكلة إيه؟',
    opts: [{ de: 'Die Bestellung ist nicht angekommen', ar: 'الطلب موصلش' }, { de: 'Die Bestellung war beschädigt', ar: 'الطلب وصل مكسور' }, { de: 'Er hat das Falsche bestellt', ar: 'طلب حاجة غلط' }, { de: 'Er möchte die Bestellung stornieren', ar: 'عايز يلغي الطلب' }], correct: 0 },
  { audioText: 'Können Sie mir vielleicht erklären, warum ich, nachdem ich mich dreimal durch Ihr Menü gehangelt und zweimal in der Leitung gehangen habe, immer noch mit niemandem sprechen konnte, der mir tatsächlich weiterhilft?',
    q_de: 'Worüber ärgert sich die Kundin?', q_ar: 'العميلة زعلانة من إيه؟',
    opts: [{ de: 'Sie erreicht niemanden, der ihr hilft', ar: 'مبتوصلش لحد يساعدها' }, { de: 'Das Produkt ist zu teuer', ar: 'المنتج غالي' }, { de: 'Die Lieferung ist zu langsam', ar: 'التوصيل بطيء' }, { de: 'Die Rechnung ist falsch', ar: 'الفاتورة غلط' }], correct: 0 },
  { audioText: 'Ich würde vorschlagen, dass wir die Sache so regeln: Sie erstatten mir die Versandkosten, die ich zu Unrecht gezahlt habe, und im Gegenzug behalte ich den Artikel trotz des kleinen Kratzers.',
    q_de: 'Was schlägt der Kunde vor?', q_ar: 'العميل بيقترح إيه؟',
    opts: [{ de: 'Versandkosten zurück, dafür behält er den Artikel', ar: 'ترجعوله مصاريف الشحن ويحتفظ بالمنتج' }, { de: 'den Artikel komplett zurückgeben', ar: 'يرجّع المنتج كله' }, { de: 'einen neuen Artikel ohne Kratzer', ar: 'منتج جديد من غير خربشة' }, { de: 'den vollen Kaufpreis zurück', ar: 'كامل تمن الشراء يرجع' }], correct: 0 },
  { audioText: 'Bevor ich mich entscheide zu verlängern, müsste ich schon genau wissen, ob die Konditionen, die Sie mir damals beim Abschluss versprochen hatten, auch für das nächste Jahr weiterhin gelten werden.',
    q_de: 'Was möchte der Kunde wissen?', q_ar: 'العميل عايز يعرف إيه؟',
    opts: [{ de: 'ob die alten Konditionen weiter gelten', ar: 'هل نفس الشروط هتفضل سارية' }, { de: 'wie er kündigen kann', ar: 'إزاي يلغي' }, { de: 'wann die Lieferung kommt', ar: 'الشحنة هتيجي إمتى' }, { de: 'wo er sich beschweren kann', ar: 'يشتكي فين' }], correct: 0 },
  { audioText: 'Es geht mir gar nicht so sehr um das Geld, sondern vielmehr darum, dass mir niemand Bescheid gegeben hat, obwohl man mir fest zugesagt hatte, man werde mich informieren, sobald sich etwas ändert.',
    q_de: 'Was stört den Kunden am meisten?', q_ar: 'أكتر حاجة مضايقة العميل إيه؟',
    opts: [{ de: 'dass ihn niemand informiert hat', ar: 'إن محدش خبّره' }, { de: 'dass es zu teuer war', ar: 'إنها كانت غالية' }, { de: 'dass die Qualität schlecht war', ar: 'إن الجودة وحشة' }, { de: 'dass er zu lange warten musste', ar: 'إنه استنى كتير' }], correct: 0 },
  { audioText: 'Ich verstehe ja, dass es zu Verzögerungen kommen kann, aber was ich nicht akzeptieren kann, ist, dass man mir zweimal ein Lieferdatum genannt hat, das dann beide Male einfach nicht eingehalten wurde.',
    q_de: 'Was akzeptiert der Kunde nicht?', q_ar: 'العميل مش قابل إيه؟',
    opts: [{ de: 'dass zugesagte Liefertermine nicht eingehalten wurden', ar: 'إن مواعيد التسليم المتفق عليها ماتحترمتش' }, { de: 'dass es überhaupt Verzögerungen gibt', ar: 'إن في تأخير أصلًا' }, { de: 'dass der Preis gestiegen ist', ar: 'إن السعر زاد' }, { de: 'dass er umsonst angerufen hat', ar: 'إنه اتصل ببلاش' }], correct: 0 },
  { audioText: 'Nachdem ich nun schon dreimal geschrieben und jedes Mal nur eine automatische Antwort erhalten habe, hätte ich langsam wirklich gern einmal einen Menschen, der sich meines Anliegens ernsthaft annimmt.',
    q_de: 'Was wünscht sich die Kundin?', q_ar: 'العميلة نفسها في إيه؟',
    opts: [{ de: 'mit einem echten Menschen zu sprechen', ar: 'تكلم حد حقيقي' }, { de: 'eine schnellere automatische Antwort', ar: 'رد آلي أسرع' }, { de: 'eine Rückerstattung', ar: 'استرداد فلوس' }, { de: 'eine E-Mail-Adresse', ar: 'إيميل' }], correct: 0 },
  { audioText: 'Ich möchte mich nicht streiten, aber Sie werden verstehen, dass ich, solange die Reklamation, die ich eingereicht habe, nicht bearbeitet worden ist, die offene Rechnung erst einmal nicht begleichen werde.',
    q_de: 'Was macht der Kunde, bis seine Reklamation bearbeitet ist?', q_ar: 'العميل هيعمل إيه لحد ما الشكوى تتحل؟',
    opts: [{ de: 'die offene Rechnung nicht bezahlen', ar: 'مش هيدفع الفاتورة المفتوحة' }, { de: 'den Vertrag sofort kündigen', ar: 'يلغي العقد فورًا' }, { de: 'eine Anwältin einschalten', ar: 'يجيب محامي' }, { de: 'eine schlechte Bewertung schreiben', ar: 'يكتب تقييم وحش' }], correct: 0 },
  // ── 07-04 expansion (+6). q_ar strings are VERBATIM reuses of the approved pairs above; the
  //    option `ar` fields intentionally repeat the German (same fallback the GENERATED items use —
  //    ar ||= de) because new masri is never authored here. OWNER-AR may replace them later. ──
  { audioText: 'Eigentlich wollte ich nur meinen Zählerstand durchgeben, aber jedes Mal, wenn ich die Nummer wähle, die auf Ihrem Schreiben steht, lande ich in einer Warteschleife, die nach zwanzig Minuten einfach abbricht.',
    q_de: 'Was ist das Problem?', q_ar: 'المشكلة إيه؟',
    opts: [{ de: 'Er erreicht telefonisch niemanden', ar: 'Er erreicht telefonisch niemanden' }, { de: 'Sein Zählerstand ist falsch', ar: 'Sein Zählerstand ist falsch' }, { de: 'Das Schreiben ist nie angekommen', ar: 'Das Schreiben ist nie angekommen' }, { de: 'Er möchte eine neue Nummer', ar: 'Er möchte eine neue Nummer' }], correct: 0 },
  { audioText: 'Dass Fehler passieren, verstehe ich ja, aber dass man mir, nachdem ich das defekte Gerät zurückgeschickt hatte, einfach dasselbe Modell mit genau demselben Defekt noch einmal zuschickt, finde ich schon bemerkenswert.',
    q_de: 'Worüber beschwert sich der Kunde?', q_ar: 'العميل بيشتكي من إيه؟',
    opts: [{ de: 'Er hat wieder ein defektes Gerät bekommen', ar: 'Er hat wieder ein defektes Gerät bekommen' }, { de: 'Die Rücksendung war zu teuer', ar: 'Die Rücksendung war zu teuer' }, { de: 'Das Gerät ist nie angekommen', ar: 'Das Gerät ist nie angekommen' }, { de: 'Er wollte ein anderes Modell', ar: 'Er wollte ein anderes Modell' }], correct: 0 },
  { audioText: 'Ich bestehe darauf, dass mir schriftlich bestätigt wird, dass der Vertrag, den ich am Telefon angeblich abgeschlossen haben soll, nie zustande gekommen ist.',
    q_de: 'Was verlangt der Kunde?', q_ar: 'العميل بيطلب إيه؟',
    opts: [{ de: 'eine schriftliche Bestätigung', ar: 'eine schriftliche Bestätigung' }, { de: 'einen neuen Vertrag', ar: 'einen neuen Vertrag' }, { de: 'ein persönliches Gespräch', ar: 'ein persönliches Gespräch' }, { de: 'eine Entschädigung', ar: 'eine Entschädigung' }], correct: 0 },
  { audioText: 'Bevor ich Ihnen irgendwelche Kontodaten gebe, hätte ich schon ganz gern gewusst, woher Sie eigentlich meine Handynummer haben, wenn ich sie Ihnen doch nie gegeben habe.',
    q_de: 'Was möchte der Kunde wissen?', q_ar: 'العميل عايز يعرف إيه؟',
    opts: [{ de: 'woher die Firma seine Nummer hat', ar: 'woher die Firma seine Nummer hat' }, { de: 'wie er sein Konto wechseln kann', ar: 'wie er sein Konto wechseln kann' }, { de: 'warum die Rechnung so hoch ist', ar: 'warum die Rechnung so hoch ist' }, { de: 'wann der Vertrag endet', ar: 'wann der Vertrag endet' }], correct: 0 },
  { audioText: 'Wissen Sie, ich wäre ja schon zufrieden, wenn mir einfach mal jemand sagen würde, wann der Techniker nun wirklich kommt, statt mir jede Woche ein neues Zeitfenster zu nennen, das dann doch nicht gehalten wird.',
    q_de: 'Was wünscht sich die Kundin?', q_ar: 'العميلة نفسها في إيه؟',
    opts: [{ de: 'einen verlässlichen Termin', ar: 'einen verlässlichen Termin' }, { de: 'einen anderen Techniker', ar: 'einen anderen Techniker' }, { de: 'ihr Geld zurück', ar: 'ihr Geld zurück' }, { de: 'ein neues Gerät', ar: 'ein neues Gerät' }], correct: 0 },
  { audioText: 'Die Abbuchung, die Sie doch storniert haben wollten, ist gestern trotzdem noch einmal erfolgt, sodass ich jetzt doppelt belastet worden bin, obwohl man mir am Montag versichert hatte, das sei technisch ausgeschlossen.',
    q_de: 'Was ist das Problem?', q_ar: 'المشكلة إيه؟',
    opts: [{ de: 'Es wurde doppelt abgebucht', ar: 'Es wurde doppelt abgebucht' }, { de: 'Die Stornierung dauert zu lange', ar: 'Die Stornierung dauert zu lange' }, { de: 'Seine Karte wurde gesperrt', ar: 'Seine Karte wurde gesperrt' }, { de: 'Der Betrag war zu niedrig', ar: 'Der Betrag war zu niedrig' }], correct: 0 },
];

function paidOnly(req, res) {
  if (!drillsUnlocked(req.account)) { res.status(402).json({ error: 'plan_required', reason: 'listening_is_paid' }); return false; }
  return true;
}

// Curated comprehension items, no-repeat until the pool cycles (like the detail pool).
function pickCuratedComp(seen, n) {
  const seenSet = new Set(Array.isArray(seen) ? seen : []);
  let pool = COMPREHENSION.map((_, i) => i).filter((i) => !seenSet.has(i));
  let reset = false;
  if (pool.length < n) { pool = COMPREHENSION.map((_, i) => i); reset = true; }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return { picks: pool.slice(0, n), reset };
}

// Shuffle a comprehension item's options each serve, so the right answer is never predictably in the
// same slot (the curated pool authors it first). Returns the shuffled options + the new correct index.
function shuffledComp(it) {
  const order = it.opts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { opts: order.map((i) => it.opts[i]), correct: order.indexOf(it.correct) };
}

// Validate a generated comprehension item: complex sentence + a question + 3–4 options + a valid correct index.
// SCRIPT SANITY (langGuard.js): a small model occasionally emits a stray foreign-script token under
// generation pressure — reject the WHOLE item rather than show a learner text that isn't German/Arabic.
function validComp(it) {
  if (!it || typeof it !== 'object') return false;
  const audio = String(it.audioText ?? '').trim();
  const q = String(it.q_de ?? '').trim();
  const opts = Array.isArray(it.opts) ? it.opts : [];
  if (audio.length < 25 || !q || opts.length < 3 || opts.length > 4) return false;
  if (!opts.every((o) => o && String(o.de ?? '').trim())) return false;
  if (!isCleanGermanText(audio) || !isCleanGermanText(q)) return false;
  if (it.q_ar && !isCleanArabicOrGermanText(it.q_ar)) return false;
  if (!opts.every((o) => isCleanGermanText(o.de) && (!o.ar || isCleanArabicOrGermanText(o.ar)))) return false;
  return Number.isInteger(it.correct) && it.correct >= 0 && it.correct < opts.length;
}

// GENERATE novel COMPREHENSION items (Groq). Self-consistent: the model writes the sentence, the question,
// the options AND which one is correct — we grade the learner deterministically against that index, so a
// learner is never marked wrong against an answer the model didn't author.
async function generateComprehension({ level, avoid }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('no_api_key');
  console.log(`[ai] ${GEN_MODEL} · listening COMPREHENSION gen (level=${level || 'B2'})`);
  const sys = `Du erstellst deutsche HÖRVERSTEHENS-Aufgaben für ein Callcenter (eingehende Kundenanrufe).
Schreibe je einen NATÜRLICHEN, KOMPLEXEN Anrufer-Satz auf Niveau ${level === 'C1' ? 'C1–C2' : level === 'A2' || level === 'A1' ? 'B1–B2' : 'B2–C1'}:
- echte gesprochene Sprache, wie Deutsche wirklich am Telefon reden,
- mit NEBENSÄTZEN (weil/obwohl/nachdem/wenn/dass/sodass) und mehreren Verben AM SATZENDE (z. B. „…, das ich eingeschickt hatte, repariert zurückgeschickt werden sollte."),
- verschiedene Callcenter-Themen (Reklamation, Kündigung, Rechnung, Lieferung, Vertrag, Termin, Rückruf, Erstattung) — abwechslungsreich.
Zu JEDEM Satz stellst du EINE Verständnisfrage nach dem SINN (nicht nach einer Zahl) und lieferst 4 kurze Antwortoptionen, von denen GENAU EINE korrekt ist. Die falschen Optionen müssen plausibel, aber eindeutig falsch sein.
Gib AUSSCHLIESSLICH JSON zurück.`;
  const userMsg = `Erzeuge 4 Items. Vermeide Themen, die diesen ähneln (NICHT wiederholen):
${avoid && avoid.length ? avoid.map((a) => `- ${a}`).join('\n') : '- (keine)'}
Jedes Item: { "audioText" (komplexer deutscher Anrufer-Satz), "q_de" (kurze Sinn-Frage auf Deutsch), "q_ar" (dieselbe Frage auf ägyptischem Arabisch), "opts" (4 Optionen, je { "de", "ar" }), "correct" (Index 0–3 der richtigen Option) }.
Antworte als JSON: { "items": [ ... ] }`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(GROQ_CHAT, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: GEN_MODEL, temperature: 0.85, max_tokens: 1800, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }),
    });
    if (!res.ok) throw new Error(`comp gen ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    const raw = Array.isArray(parsed.items) ? parsed.items : [];
    return raw.map((it) => ({
      audioText: String(it?.audioText ?? '').trim(),
      q_de: String(it?.q_de ?? '').trim(),
      q_ar: String(it?.q_ar ?? '').trim() || String(it?.q_de ?? '').trim(),
      opts: (Array.isArray(it?.opts) ? it.opts : []).slice(0, 4).map((o) => ({ de: String(o?.de ?? '').trim(), ar: String(o?.ar ?? '').trim() || String(o?.de ?? '').trim() })),
      correct: it?.correct,
    })).filter(validComp);
  } finally { clearTimeout(timer); }
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

// Adaptive selection: bias toward the data-TYPE the student keeps missing (e.g. they nail names but
// miss amounts → serve more amounts). Only kicks in once a type is demonstrably weak (≥2 seen, <80%
// accuracy) — otherwise pure variety. Honest: driven by their REAL per-type accuracy, never faked.
function pickAdaptive(stats, seen, n) {
  const idx = ITEMS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  // Demonstrably-weak data-type → bias to the front (you keep missing amounts → more amounts).
  let weakest = null;
  if (stats) {
    const acc = {};
    for (const [type, s] of Object.entries(stats)) if (s && s.seen >= 2) acc[type] = s.correct / s.seen;
    const w = Object.keys(acc).sort((a, b) => acc[a] - acc[b])[0];
    if (w && acc[w] < 0.8) weakest = w;
  }
  // NEVER REPEAT until the whole pool is exhausted: serve UNSEEN items first; only when fewer than a
  // full session remain do we reset and start a fresh cycle. `reset` tells the caller to wipe the seen list.
  const seenSet = new Set(seen);
  let pool = idx.filter((i) => !seenSet.has(i));
  let reset = false;
  if (pool.length < n) { pool = idx; reset = true; }
  if (weakest) pool = [...pool].sort((a, b) => (ITEMS[a].type === weakest ? 0 : 1) - (ITEMS[b].type === weakest ? 0 : 1));
  return { picks: pool.slice(0, n), reset };
}

// Content-difficulty bucket from the learner's level (separate from playback speed in baseRateFor).
function difficultyFor(level) {
  if (level === 'C1') return 'C1 — lange, komplexe Sätze mit Nebensätzen; das Detail tief eingebettet, mit Ablenkungen und Zusatzinfos; schnelle, natürliche Umgangssprache.';
  if (level === 'B2') return 'B2 — natürliche, mittellange Sätze; das Detail mitten im Satz, mit etwas Tempo.';
  return 'A2–B1 — kürzere, klare Sätze; das Detail gut hörbar, aber echtes, natürliches Deutsch.';
}

// Decide the TYPE plan for a session — keeps the SAME adaptivity as the fixed pool: bias toward the
// data-type the learner demonstrably keeps missing (≥2 seen, <80%). Otherwise variety.
function chooseTypes(stats, n) {
  let weakest = null;
  if (stats) {
    const acc = {};
    for (const [t, s] of Object.entries(stats)) if (s && s.seen >= 2) acc[t] = s.correct / s.seen;
    const w = Object.keys(acc).sort((a, b) => acc[a] - acc[b])[0];
    if (w && acc[w] < 0.8) weakest = w;
  }
  const pool = [...TYPES];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = [];
  if (weakest) { out.push(weakest, weakest); }   // serve MORE of the weak type
  for (const t of pool) { if (out.length >= n) break; out.push(t); }
  while (out.length < n) out.push(pool[out.length % pool.length]);
  return out.slice(0, n);
}

// Validate a generated item: must have the full shape AND an answer whose FORMAT matches its type
// (so the deterministic normalizer can grade it). Malformed → dropped. This also reduces the chance
// of an audio/answer mismatch slipping through.
// SCRIPT SANITY (langGuard.js): reject any item whose spoken/shown text contains a foreign script —
// a generation glitch, never a real German sentence — before it ever reaches a learner.
function validItem(it) {
  if (!it || typeof it !== 'object') return false;
  if (!TYPES.includes(it.type)) return false;
  const audio = String(it.audioText ?? '').trim();
  const q     = String(it.question_de ?? '').trim();
  const ans   = String(it.answer ?? '').trim();
  if (audio.length < 12 || !q || !ans) return false;
  if (!isCleanGermanText(audio) || !isCleanGermanText(q)) return false;
  if (it.question_ar && !isCleanArabicOrGermanText(it.question_ar)) return false;
  if (it.type === 'name' && !isCleanGermanText(ans)) return false;   // a name IS shown/spoken raw
  const nAns = normalize(ans, it.type);
  if (it.type === 'adresse') return nAns.length === 5;        // PLZ = exactly 5 digits
  if (it.type === 'name')    return nAns.length >= 2;          // letters only
  if (it.type === 'datum')   return /\d{1,2}[.,]\d{1,2}/.test(ans) || nAns.length >= 3;
  return nAns.length >= 2;                                     // nummer / betrag: ≥2 digits
}

// ── The generator: ONE Groq call → N NOVEL items in the SAME shape as ITEMS ──────────
// DOCTRINE (self-consistency): the model authors BOTH the question AND its OWN correct answer.
// We store that authored answer and grade the learner deterministically against it — so a learner
// can NEVER be told "wrong" against an answer the model didn't write.
async function generateItems({ level, types, avoid }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('no_api_key');
  console.log(`[ai] ${GEN_MODEL} · listening gen (${types.length} items, level=${level || 'B1'})`); // cost audit

  const sys = `Du bist Trainer für deutsche HÖRVERSTEHENS-Übungen in einem Callcenter (eingehende Kundenanrufe).
Erzeuge realistische Anrufer-Sätze auf NATÜRLICHEM Deutsch, in denen GENAU EIN Detail eingebettet ist.
Schwierigkeit: ${difficultyFor(level)}
KRITISCH: Du lieferst zu jedem Satz die Frage UND die korrekte Antwort SELBST. Die "answer" MUSS exakt das sein,
was im Satz ("audioText") gesagt wird — niemals erfunden, niemals im Widerspruch zum Satz.
Antwort-FORMAT je Typ (genau so):
- nummer  : nur Ziffern, z. B. "472901" (Telefon-/Kunden-/Bestell-/Vertrags-/Sendungsnummern als reine Ziffernfolge)
- betrag  : Zahl mit Komma, z. B. "269,40"
- datum   : "TT.MM", z. B. "21.03"
- adresse : NUR die 5-stellige Postleitzahl als Ziffern, z. B. "40277" (die Frage fragt nach der PLZ)
- name    : der Nachname in Kleinbuchstaben, z. B. "schäfer" (im Satz wird er natürlich buchstabiert)
Im "audioText" dürfen Zahlen als WÖRTER oder Ziffern vorkommen, so wie ein Mensch es am Telefon sagt.
Gib AUSSCHLIESSLICH JSON zurück.`;

  const userMsg = `Erzeuge ${types.length} Items, je EINES für diese Typen in DIESER Reihenfolge: ${types.join(', ')}.
Sei abwechslungsreich. Vermeide Themen/Sätze, die diesen schon benutzten ähneln (NICHT wiederholen):
${avoid && avoid.length ? avoid.map((a) => `- ${a}`).join('\n') : '- (keine)'}
Jedes Item: { "type", "audioText" (deutscher Anrufer-Satz), "question_de" (kurze Frage auf Deutsch),
"question_ar" (DIESELBE Frage auf ägyptischem Arabisch), "answer" (im o. g. Format) }.
Antworte als JSON: { "items": [ ... ] }`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(GROQ_CHAT, {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:           GEN_MODEL,
        temperature:     0.85,            // higher → more variety across rounds
        max_tokens:      1600,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) throw new Error(`listening gen ${res.status} ${await res.text().catch(() => '')}`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    const raw = Array.isArray(parsed.items) ? parsed.items : [];
    // Keep only well-formed items; coerce fields, default Arabic to the German question.
    return raw
      .map((it) => ({
        type:        it?.type,
        audioText:   String(it?.audioText ?? '').trim(),
        question_de: String(it?.question_de ?? '').trim(),
        question_ar: String(it?.question_ar ?? '').trim() || String(it?.question_de ?? '').trim(),
        answer:      String(it?.answer ?? '').trim(),
      }))
      .filter(validItem);
  } finally {
    clearTimeout(timer);
  }
}

// GET a fresh session — UNSEEN items (no repeats until the pool cycles), a level-scaled baseRate, and
// a bias toward the student's weakest data-type. audioText feeds the browser's speech engine (never
// displayed); the answer is never sent.
listeningRouter.get('/listening', requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  res.set('Cache-Control', 'no-store');
  const uid = req.account.id;

  const cached = genCache.get(uid);
  const cacheStillUnused = cached?.active && !Object.values(cached.active).some((item) => item?.gradeResult);
  if (cached && cacheStillUnused && Date.now() - cached.ts < GEN_TTL_MS) { res.json(cached.payload); return; }
  if (cached && !cacheStillUnused) genCache.delete(uid);

  let p = null;
  try { p = await loadUser(uid); } catch { p = null; }
  const level    = p?.assessmentResult?.estimatedLevel;
  const baseRate = baseRateFor(level);
  const stats    = p?.listeningStats || null;
  const base     = Date.now().toString(36);
  const active   = {};
  const items    = [];
  const pickVoice = makeVoicePicker();   // 5 items → 5 different German humans

  // ── 1) COMPREHENSION (PRIMARY — owner's #1: understand COMPLEX native German, verb-final clusters,
  //       not just catch a number). Generator → curated pool fallback (no-repeat). Never blocks the round. ──
  const N_COMP = 3;
  let comp = [];
  try { comp = await generateComprehension({ level, avoid: Array.isArray(p?.listeningCompTopics) ? p.listeningCompTopics : [] }); } catch { comp = []; }
  let compSeenUpdate = null, compReset = false;
  if (!comp.length) {
    const r = pickCuratedComp(p?.listeningCompSeen, N_COMP);
    compSeenUpdate = r.picks; compReset = r.reset;
    comp = r.picks.map((i) => COMPREHENSION[i]);
  }
  comp.slice(0, N_COMP).forEach((it, k) => {
    const sh = shuffledComp(it);   // never leave the correct answer in a predictable slot
    const id = `v${base}-${k}`;
    active[id] = { kind: 'verstehen', correct: sh.correct };
    items.push({ id, kind: 'verstehen', audioText: it.audioText, question_de: it.q_de, question_ar: it.q_ar, options: sh.opts, replays: REPLAYS,
      voice: pickVoice(inferSpeakerGender(`${it.audioText} ${it.q_de}`)) });
  });

  // ── 2) DETAIL (secondary — number/name/date capture) fills the remaining slots. ──
  const N_DET = Math.max(0, PER_SESSION - items.length);
  let detGen = [];
  if (N_DET > 0) {
    try { detGen = await generateItems({ level, types: chooseTypes(stats, N_DET), avoid: Array.isArray(p?.listeningTopics) ? p.listeningTopics : [] }); } catch { detGen = []; }
  }
  detGen.slice(0, N_DET).forEach((it, k) => {
    const id = `g${base}-${k}`;
    active[id] = { type: it.type, answer: it.answer };
    items.push({ id, kind: 'detail', type: it.type, audioText: it.audioText, question_de: it.question_de, question_ar: it.question_ar, replays: REPLAYS,
      voice: pickVoice(inferSpeakerGender(`${it.audioText} ${it.question_de}`)) });
  });
  // Pad any remaining detail slots from the fixed pool so a round is always full.
  if (items.length < PER_SESSION) {
    const pad = pickAdaptive(stats, [], Math.min(PER_SESSION - items.length, ITEMS.length)).picks;
    for (const i of pad) {
      active[String(i)] = { type: ITEMS[i].type, answer: ITEMS[i].answer };
      items.push({ id: i, kind: 'detail', type: ITEMS[i].type, audioText: ITEMS[i].audioText, question_de: ITEMS[i].question_de, question_ar: ITEMS[i].question_ar, replays: REPLAYS,
        voice: pickVoice(inferSpeakerGender(`${ITEMS[i].audioText} ${ITEMS[i].question_de}`)) });
    }
  }

  // Bind every item to one server-issued attempt. This does not touch audio generation or playback;
  // it only makes later accuracy, replay-dependence, and response-latency evidence auditable.
  const issuedAt = Date.now();
  for (const [index, row] of items.entries()) {
    const stored = active[String(row.id)];
    if (!stored) continue;
    Object.assign(stored, {
      attemptId: randomBytes(12).toString('hex'),
      itemHash: evidenceContentHash(row, stored),
      issuedAt,
      maxPlays: Math.max(1, Math.min(2, Number(row.replays || 0) + 1)),
      playCount: 0,
      playStartedAt: null,
      playCompletedAt: null,
      playbackRate: Math.min(1.7, baseRate + index * 0.12),
      gradeResult: null,
    });
  }

  // Persist active (both kinds) + no-repeat memory for comprehension and detail.
  const payload = { items, baseRate };
  try {
    p = p || await loadUser(uid);
    p.listeningActive     = active;
    p.listeningTopics     = [...detGen.slice(0, N_DET).map((it) => it.audioText.slice(0, 80)), ...(Array.isArray(p.listeningTopics) ? p.listeningTopics : [])].slice(0, AVOID_KEEP);
    p.listeningCompTopics = [...comp.slice(0, N_COMP).map((it) => it.audioText.slice(0, 80)), ...(Array.isArray(p.listeningCompTopics) ? p.listeningCompTopics : [])].slice(0, AVOID_KEEP);
    if (compSeenUpdate) p.listeningCompSeen = compReset ? compSeenUpdate.slice() : [...(Array.isArray(p.listeningCompSeen) ? p.listeningCompSeen : []), ...compSeenUpdate];
    await saveUser(p);
  } catch { /* best-effort; genCache still resolves grade this session */ }
  genCache.set(uid, { ts: Date.now(), payload, active });
  res.json(payload);
});

// POST a typed capture → deterministic correct/incorrect (no model). Records per-type accuracy so the
// NEXT session can bias toward what this student keeps missing.
// A playback must be acknowledged by the server before the unchanged native-audio path begins.
// Completion is separate, so a failed audio request can never become measurement evidence.
listeningRouter.post('/listening/play', express.json({ limit: '2kb' }), requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  try {
    const result = await mutateUser(req.account.id, (profile) => ({
      value: beginListeningPlayback(profile, req.body?.id),
    }));
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.code || 'listening_play_failed' });
  }
});

listeningRouter.post('/listening/play/complete', express.json({ limit: '2kb' }), requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  try {
    const result = await mutateUser(req.account.id, (profile) => ({
      value: finishListeningPlayback(profile, req.body?.id, {
        playNumber: req.body?.playNumber,
        completed: req.body?.completed === true,
      }),
    }));
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.code || 'listening_play_complete_failed' });
  }
});

listeningRouter.post('/listening/grade', express.json({ limit: '8kb' }), requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  const uid = req.account.id;
  const rawId = req.body?.id;
  const key = String(rawId);

  // Resolve the served item — generated OR fixed — and its MODEL-AUTHORED answer. Order:
  //  1) in-memory session cache (survives a failed saveUser),
  //  2) persisted listeningActive (survives a server restart),
  //  3) the fixed ITEMS pool by numeric index (legacy / fallback sessions).
  // DOCTRINE: `item.answer` here is the answer the model itself wrote for this exact question, so
  // grading the learner against it is self-consistent — never "wrong" against an answer we invented.
  try {
    const result = await mutateUser(uid, (p) => {
      const item = p?.listeningActive?.[key];
      if (!item || typeof item !== 'object') {
        const error = new Error('bad_item'); error.code = 'bad_item'; error.status = 400; throw error;
      }

  // COMPREHENSION (MCQ): grade the CHOSEN option index against the authored correct index (self-consistent —
  // the model/curated item wrote both the options and which is right, so the learner is never marked wrong
  // against something we invented).
      if (item.kind === 'verstehen') {
        const chosen = parseInt(req.body?.response, 10);
        const proposedCorrect = Number.isInteger(chosen) && chosen === item.correct;
        const committed = commitListeningGrade(p, key, { correct: proposedCorrect });
        if (!committed.replayed) {
          p.listeningStats = p.listeningStats || {};
          const stat = p.listeningStats.verstehen || { seen: 0, correct: 0 };
          stat.seen += 1; if (committed.correct) stat.correct += 1;
          p.listeningStats.verstehen = stat;
        }
        return { value: { correct: committed.correct, kind: 'verstehen', correctIndex: item.correct, replayed: committed.replayed } };
      }

  // DETAIL: deterministic normalize + compare against the authored answer.
      if (!item.answer || !TYPES.includes(item.type)) {
        const error = new Error('bad_item'); error.code = 'bad_item'; error.status = 400; throw error;
      }

      const you = normalize(req.body?.response, item.type);
      const want = normalize(item.answer, item.type);
      const proposedCorrect = you.length > 0 && you === want;

  // Record per-type accuracy (best-effort; never block the grade response).
      const committed = commitListeningGrade(p, key, { correct: proposedCorrect });
      if (!committed.replayed) {
        p.listeningStats = p.listeningStats || {};
        const stat = p.listeningStats[item.type] || { seen: 0, correct: 0 };
        stat.seen += 1; if (committed.correct) stat.correct += 1;
        p.listeningStats[item.type] = stat;
      }
      return { value: { correct: committed.correct, expected: item.answer,
        ...(committed.replayed ? {} : { normalizedYou: you }), replayed: committed.replayed } };
    });
    console.log(`[listening] user=${uid} id=${key} correct=${result.correct} replayed=${result.replayed}`);
    res.set('Cache-Control', 'no-store');
    const evidenceReceipt = result.replayed ? null : issueDrillEvidenceReceipt(uid, {
      drill: 'hoer-check', correct: result.correct === true,
    });
    res.json({ ...result, ...(evidenceReceipt ? { evidenceReceipt } : {}) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.code || 'listening_grade_failed' });
  }
});

