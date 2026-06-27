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
import { loadUser, saveUser }  from './store.js';

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
  { type: 'nummer', audioText: 'Guten Tag, meine Kundennummer ist drei fünf acht, zwei null, neun sieben. Ich habe eine Frage zur Rechnung.',
    question_de: 'Welche Kundennummer nennt der Anrufer?', question_ar: 'إيه رقم العميل؟', answer: '3582097' },
  { type: 'betrag', audioText: 'Auf meiner Rechnung stehen einhundertneunundachtzig Euro fünfzig, aber das stimmt nicht.',
    question_de: 'Welcher Betrag steht auf der Rechnung? (z. B. 189,50)', question_ar: 'إيه المبلغ على الفاتورة؟', answer: '189,50' },
  { type: 'name', audioText: 'Mein Name ist Böttcher — also B, Ö, T, T, C, H, E, R.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب الاسم؟', answer: 'böttcher' },
  { type: 'datum', audioText: 'Der Techniker sollte am siebten Mai kommen, aber er ist nicht erschienen.',
    question_de: 'An welchem Tag sollte der Techniker kommen? (z. B. 07.05)', question_ar: 'الفني كان المفروض ييجي إمتى؟', answer: '07.05' },
  { type: 'nummer', audioText: 'Sie erreichen mich unter null eins sechs zwei, vier vier acht, neun null drei eins.',
    question_de: 'Welche Telefonnummer nennt der Kunde?', question_ar: 'إيه رقم التليفون؟', answer: '01624489031' },
  { type: 'adresse', audioText: 'Ich wohne in der Hauptstraße neun, zehn vier neun sechs Berlin.',
    question_de: 'Wie lautet die Postleitzahl? (5 Ziffern)', question_ar: 'إيه الرقم البريدي؟', answer: '10496' },
  { type: 'betrag', audioText: 'Mir wurden zweihundertfünfzehn Euro zwanzig abgebucht, das ist zu viel.',
    question_de: 'Welcher Betrag wurde abgebucht? (z. B. 215,20)', question_ar: 'إيه المبلغ اللي اتسحب؟', answer: '215,20' },
  { type: 'nummer', audioText: 'Die Bestellnummer ist sieben sieben zwei, eins drei, vier acht. Es geht um eine Reklamation.',
    question_de: 'Wie lautet die Bestellnummer?', question_ar: 'إيه رقم الطلب؟', answer: '7721348' },
  { type: 'name', audioText: 'Ich heiße Wagner — ganz normal: W, A, G, N, E, R.',
    question_de: 'Wie wird der Nachname geschrieben?', question_ar: 'إزاي بيتكتب الاسم؟', answer: 'wagner' },
  { type: 'datum', audioText: 'Die Lieferung war für den neunzehnten Oktober geplant und kam nie an.',
    question_de: 'Für welchen Tag war die Lieferung geplant? (z. B. 19.10)', question_ar: 'الشحنة كانت لأنهي يوم؟', answer: '19.10' },
  { type: 'nummer', audioText: 'Meine Vertragsnummer lautet vier null sechs, acht eins, sieben drei.',
    question_de: 'Wie lautet die Vertragsnummer?', question_ar: 'إيه رقم العقد؟', answer: '4068173' },
  { type: 'betrag', audioText: 'Die Gesamtsumme beträgt dreihundertzweiundvierzig Euro neunzig.',
    question_de: 'Wie hoch ist die Gesamtsumme? (z. B. 342,90)', question_ar: 'إيه إجمالي المبلغ؟', answer: '342,90' },
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
function validItem(it) {
  if (!it || typeof it !== 'object') return false;
  if (!TYPES.includes(it.type)) return false;
  const audio = String(it.audioText ?? '').trim();
  const q     = String(it.question_de ?? '').trim();
  const ans   = String(it.answer ?? '').trim();
  if (audio.length < 12 || !q || !ans) return false;
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
  const n   = PER_SESSION;

  // Brief per-user cache: a rapid double-load returns the SAME set (no double Groq bill), but a real
  // reopen later (> TTL) regenerates → NOVEL content. listeningActive was already persisted, so grade works.
  const cached = genCache.get(uid);
  if (cached && Date.now() - cached.ts < GEN_TTL_MS) { res.json(cached.payload); return; }

  // ── Fail-safe fallback: the existing FIXED pool (never breaks the drill). Stores served items
  // in listeningActive so grading resolves them uniformly. Used when GROQ_API_KEY is missing or
  // generation fails/times out / returns nothing.
  const serveFixed = async () => {
    let baseRate = 1.0, picks, p = null;
    try {
      p = await loadUser(uid);
      baseRate = baseRateFor(p.assessmentResult?.estimatedLevel);
      const seen = Array.isArray(p.listeningSeen) ? p.listeningSeen : [];
      const r = pickAdaptive(p.listeningStats || null, seen, Math.min(n, ITEMS.length));
      picks = r.picks;
      p.listeningSeen   = r.reset ? picks.slice() : [...seen, ...picks];   // no-repeat until pool cycles
      p.listeningActive = {};
      for (const i of picks) p.listeningActive[String(i)] = { type: ITEMS[i].type, answer: ITEMS[i].answer };
      await saveUser(p);
    } catch {
      picks = pickAdaptive(null, [], Math.min(n, ITEMS.length)).picks;
    }
    const items = picks.map((i) => ({
      id: i, type: ITEMS[i].type, audioText: ITEMS[i].audioText,
      question_de: ITEMS[i].question_de, question_ar: ITEMS[i].question_ar, replays: REPLAYS,
    }));
    const payload = { items, baseRate };
    genCache.set(uid, { ts: Date.now(), payload });
    return res.json(payload);
  };

  let p;
  try { p = await loadUser(uid); } catch { p = null; }
  const level    = p?.assessmentResult?.estimatedLevel;
  const baseRate = baseRateFor(level);
  const stats    = p?.listeningStats || null;
  const avoid    = Array.isArray(p?.listeningTopics) ? p.listeningTopics : [];

  let generated;
  try {
    const types = chooseTypes(stats, n);
    generated = await generateItems({ level, types, avoid });
  } catch (e) {
    console.warn(`[listening] generation failed → fixed pool: ${e?.message || e}`);
    return serveFixed();
  }
  if (!generated || !generated.length) return serveFixed();

  // Build the served session. Generated items get string ids ("g<ts>-<k>"); if the model returned
  // fewer than a full session, pad the remaining slots from the fixed pool so UX stays a full round.
  const base   = Date.now().toString(36);
  const active = {};
  const items  = [];
  generated.slice(0, n).forEach((it, k) => {
    const id = `g${base}-${k}`;
    active[id] = { type: it.type, answer: it.answer };
    items.push({ id, type: it.type, audioText: it.audioText, question_de: it.question_de, question_ar: it.question_ar, replays: REPLAYS });
  });
  if (items.length < n) {
    const pad = pickAdaptive(stats, [], Math.min(n - items.length, ITEMS.length)).picks;
    for (const i of pad) {
      active[String(i)] = { type: ITEMS[i].type, answer: ITEMS[i].answer };
      items.push({ id: i, type: ITEMS[i].type, audioText: ITEMS[i].audioText, question_de: ITEMS[i].question_de, question_ar: ITEMS[i].question_ar, replays: REPLAYS });
    }
  }

  // NO-REPEAT across reopens: remember recent audio topics → pass them as `avoid` next time.
  const topics = [...generated.slice(0, n).map((it) => it.audioText.slice(0, 80)), ...avoid].slice(0, AVOID_KEEP);
  const payload = { items, baseRate };
  try {
    p = p || await loadUser(uid);
    p.listeningActive = active;       // grade resolves the model-authored answer from here
    p.listeningTopics = topics;
    await saveUser(p);
  } catch { /* persistence is best-effort; in-memory cache below still lets grade resolve this session */ }
  genCache.set(uid, { ts: Date.now(), payload, active });
  res.json(payload);
});

// POST a typed capture → deterministic correct/incorrect (no model). Records per-type accuracy so the
// NEXT session can bias toward what this student keeps missing.
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
  let item = null, p = null;
  const cached = genCache.get(uid);
  if (cached?.active && Object.prototype.hasOwnProperty.call(cached.active, key)) item = cached.active[key];
  if (!item) {
    try {
      p = await loadUser(uid);
      const active = p?.listeningActive || {};
      if (Object.prototype.hasOwnProperty.call(active, key)) item = active[key];
    } catch { /* fall through to fixed */ }
  }
  if (!item) {
    const idx = parseInt(rawId, 10);
    if (Number.isInteger(idx) && idx >= 0 && idx < ITEMS.length) item = ITEMS[idx];
  }
  if (!item || !item.answer || !TYPES.includes(item.type)) return res.status(400).json({ error: 'bad_item' });

  const you  = normalize(req.body?.response, item.type);
  const want = normalize(item.answer, item.type);
  const correct = you.length > 0 && you === want;   // deterministic, against the generated answer

  // Record per-type accuracy (best-effort; never block the grade response).
  try {
    if (!p) p = await loadUser(uid);
    p.listeningStats = p.listeningStats || {};
    const s = p.listeningStats[item.type] || { seen: 0, correct: 0 };
    s.seen += 1; if (correct) s.correct += 1;
    p.listeningStats[item.type] = s;
    await saveUser(p);
  } catch { /* stats are best-effort */ }
  console.log(`[listening] user=${uid} id=${key} type=${item.type} correct=${correct}`);
  res.json({ correct, expected: item.answer, normalizedYou: you });
});

