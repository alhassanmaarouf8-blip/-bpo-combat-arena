/**
 * satzbauSchmiede.js — SATZBAU-SCHMIEDE word-order builder drill (PAID).
 *
 * WHY: verb-final subordinate-clause order (weil/dass/wenn/obwohl/nachdem/damit…) is the single
 * highest-leverage German structure for an Arabic-L1 speaker — Arabic clauses don't push the verb
 * to the end, so this is where a fluent-sounding candidate suddenly stumbles in the real interview.
 *
 * HOW (zero added cost — no STT, no LLM, no TTS required to grade):
 *   - A CURATED, FIXED pool of C1-level BPO-context sentences, each built around one subordinating
 *     connector. The server shuffles the sentence's own words into tiles; the learner taps them back
 *     into the correct order against the clock.
 *   - Grading is a DETERMINISTIC, position-by-position order check (never a model) — see gradeSatzbau().
 *     "Tolerant" means the comparison normalizes case/punctuation per token (so "Ich"/"ich" or a
 *     trailing comma never causes a false miss) — but the ORDER itself must be exact, since word
 *     order is the entire point of the drill.
 *
 *   GET  /api/satzbau        → { items:[{id, level, connector, cue_de, cue_ar, tiles:[string]}] }
 *   POST /api/satzbau/grade  → { id, tokens:[string] } → { correct, matchedCount, total,
 *                                firstMismatchIndex, target }
 *
 * Gated like the other drills: requireAuth + active plan (planOf !== 'free', reverts an expired
 * plan to free automatically). Sessions are unlimited, no interview-minute gating (it's a drill).
 */
import express from 'express';
import { requireAuth, drillsUnlocked } from './auth.js';
import { loadUser, saveUser }          from './store.js';

export const satzbauRouter = express.Router();

const PER_SESSION = 6;

// Curated C1/B2 BPO-context sentences, one per subordinating connector, verb pushed to the clause
// end the way real spoken German requires. `cue_de` frames the communicative task (what the learner
// is producing, not just "translate"); `cue_ar` is left EMPTY — an owner slot, never authored here
// (see the hard rule: no Egyptian-Arabic written by the builder). The client falls back to German
// when cue_ar is empty, same pattern as note_ar / youtubeId_ar elsewhere in this codebase.
export const SENTENCES = [
  { id: 0,  level: 'B2', connector: 'weil',     cue_de: 'Erkläre höflich, warum du gerade nicht länger sprechen kannst.',
    sentence: 'Ich rufe Sie gleich zurück, weil ich gerade in einem anderen Gespräch bin.' },
  { id: 1,  level: 'B2', connector: 'dass',     cue_de: 'Sichere dem Kunden zu, dass sein Anliegen bearbeitet wird.',
    sentence: 'Ich kann Ihnen versichern, dass wir uns sofort um Ihr Anliegen kümmern.' },
  { id: 2,  level: 'B2', connector: 'wenn',     cue_de: 'Erkläre, was passiert, wenn die Zahlung nicht ankommt.',
    sentence: 'Wenn die Zahlung bis Freitag nicht eingeht, wird der Vertrag automatisch pausiert.' },
  { id: 3,  level: 'C1', connector: 'obwohl',   cue_de: 'Erkläre höflich einen Widerspruch bei der Lieferung.',
    sentence: 'Obwohl die Lieferung pünktlich verschickt wurde, ist sie leider nicht angekommen.' },
  { id: 4,  level: 'C1', connector: 'nachdem',  cue_de: 'Erkläre den nächsten Schritt nach dem Formular.',
    sentence: 'Nachdem Sie das Formular ausgefüllt haben, erhalten Sie eine Bestätigung per E-Mail.' },
  { id: 5,  level: 'B2', connector: 'damit',    cue_de: 'Erkläre den Zweck, warum du die Anfrage weiterleitest.',
    sentence: 'Ich leite Ihre Anfrage weiter, damit ein Kollege sich schnell darum kümmert.' },
  { id: 6,  level: 'C1', connector: 'sodass',   cue_de: 'Erkläre die Folge einer technischen Störung.',
    sentence: 'Der Server war überlastet, sodass die Bestellung zweimal übermittelt wurde.' },
  { id: 7,  level: 'C1', connector: 'bevor',    cue_de: 'Erkläre, was vor einer Rückerstattung geprüft werden muss.',
    sentence: 'Bevor ich Ihnen eine Rückerstattung anbieten kann, muss ich die Reklamation prüfen.' },
  { id: 8,  level: 'B2', connector: 'während',  cue_de: 'Erkläre, was der Kunde tun kann, während der Techniker unterwegs ist.',
    sentence: 'Während der Techniker unterwegs ist, können Sie das Gerät ausgeschaltet lassen.' },
  { id: 9,  level: 'C1', connector: 'seitdem',  cue_de: 'Erkläre eine Verbesserung seit einer Systemumstellung.',
    sentence: 'Seitdem wir das neue System nutzen, dauert die Bearbeitung deutlich kürzer.' },
  { id: 10, level: 'B2', connector: 'falls',    cue_de: 'Biete Erreichbarkeit für Rückfragen an.',
    sentence: 'Falls Sie Fragen haben, können Sie mich jederzeit unter dieser Nummer erreichen.' },
  { id: 11, level: 'B2', connector: 'weil',     cue_de: 'Erkläre, warum der Kunde verärgert war.',
    sentence: 'Der Kunde war verärgert, weil seine Bestellung dreimal storniert wurde.' },
  { id: 12, level: 'B2', connector: 'dass',     cue_de: 'Zeige Verständnis für die Unzufriedenheit des Kunden.',
    sentence: 'Ich habe Verständnis dafür, dass Sie mit der Wartezeit unzufrieden sind.' },
  { id: 13, level: 'B2', connector: 'wenn',     cue_de: 'Erkläre, was du mit der Kundennummer tun kannst.',
    sentence: 'Wenn Sie mir Ihre Kundennummer nennen, kann ich den Vorgang sofort öffnen.' },
  { id: 14, level: 'C1', connector: 'obwohl',   cue_de: 'Erkläre einen Widerspruch bei der Fehlersuche.',
    sentence: 'Obwohl ich alles überprüft habe, konnte ich den Fehler leider nicht finden.' },
  { id: 15, level: 'C1', connector: 'nachdem',  cue_de: 'Erkläre, wie ein wiederholtes Problem gelöst wurde.',
    sentence: 'Nachdem der Kunde dreimal angerufen hatte, wurde das Problem endlich gelöst.' },
  { id: 16, level: 'B2', connector: 'damit',    cue_de: 'Erkläre den Zweck einer Adressbestätigung.',
    sentence: 'Bitte bestätigen Sie Ihre Adresse, damit wir das Paket korrekt zustellen können.' },
  { id: 17, level: 'C1', connector: 'sodass',   cue_de: 'Erkläre die Folge einer gestörten Leitung.',
    sentence: 'Die Leitung war gestört, sodass das Gespräch mehrmals unterbrochen wurde.' },
  { id: 18, level: 'C1', connector: 'bevor',    cue_de: 'Erkläre, was vor einer Kontoschließung zu klären ist.',
    sentence: 'Bevor wir das Konto schließen, sollten wir alle offenen Punkte klären.' },
  { id: 19, level: 'B2', connector: 'während',  cue_de: 'Bitte um kurze Geduld während einer Datenabfrage.',
    sentence: 'Während ich Ihre Daten aufrufe, bitte ich Sie um einen kurzen Moment Geduld.' },
  { id: 20, level: 'C1', connector: 'seitdem',  cue_de: 'Erkläre die Wirkung einer neuen Regelung.',
    sentence: 'Seitdem die neue Regelung gilt, melden sich deutlich weniger Kunden mit diesem Problem.' },
  { id: 21, level: 'C1', connector: 'falls',    cue_de: 'Erkläre eine automatische Gutschrift bei erneuter Verspätung.',
    sentence: 'Falls die Lieferung erneut verspätet ankommt, erhalten Sie automatisch eine Gutschrift.' },
  { id: 22, level: 'C1', connector: 'dass',     cue_de: 'Entschuldige dich für zusätzlichen Aufwand.',
    sentence: 'Es tut mir leid, dass Ihnen durch diesen Fehler zusätzlicher Aufwand entstanden ist.' },
  { id: 23, level: 'C1', connector: 'weil',     cue_de: 'Erkläre höflich, warum ein Rabatt nicht mehr gilt.',
    sentence: 'Ich kann Ihnen diesen Rabatt leider nicht gewähren, weil die Aktion bereits letzte Woche beendet wurde.' },
  { id: 24, level: 'C1', connector: 'obwohl',   cue_de: 'Erkläre einen erneut aufgetretenen Fehler trotz Meldung.',
    sentence: 'Obwohl der Techniker das Problem als gelöst gemeldet hatte, trat der Fehler am nächsten Tag erneut auf.' },
  { id: 25, level: 'C1', connector: 'nachdem',  cue_de: 'Erkläre die Entscheidung nach einer gründlichen Prüfung.',
    sentence: 'Nachdem wir die Reklamation gründlich geprüft hatten, haben wir uns für eine vollständige Rückerstattung entschieden.' },
];

// Split a sentence into its literal tiles (whitespace-delimited; trailing comma/period stays attached
// to the preceding word, exactly as it reads). This is BOTH the tile set the client sees (shuffled)
// AND the target order the grader checks against.
export function splitTokens(sentence) {
  return String(sentence || '').trim().split(/\s+/).filter(Boolean);
}

// Deterministic per-token normalization for grading: lowercase + strip punctuation. This is the
// "tolerant" part — a sentence-initial capitalized article/pronoun ("Ich"/"ich") or a trailing comma
// never causes a false miss. It does NOT change the fact that ORDER must match position-for-position;
// tolerance is about token spelling, not about word order (that stays exact — it's the whole drill).
function normalizeToken(t) {
  return String(t || '').toLowerCase().normalize('NFC').replace(/[^a-zäöüß0-9-]/g, '');
}

// DETERMINISTIC word-order grader — no model, ever. Compares the learner's submitted tile order to
// the sentence's real order, position by position, after tolerant per-token normalization.
// Returns matchedCount/total/firstMismatchIndex so the client can show PARTIAL progress (which tiles
// are already right) instead of only pass/fail.
export function gradeSatzbau(targetTokens, submittedTokens) {
  const target    = (Array.isArray(targetTokens) ? targetTokens : []).map(normalizeToken);
  const submitted = (Array.isArray(submittedTokens) ? submittedTokens : []).map(normalizeToken);
  const total = target.length;
  let matchedCount = 0;
  let firstMismatchIndex = null;
  const n = Math.max(target.length, submitted.length);
  for (let i = 0; i < n; i++) {
    if (i < target.length && i < submitted.length && target[i] === submitted[i]) {
      matchedCount++;
    } else if (firstMismatchIndex === null) {
      firstMismatchIndex = i;
    }
  }
  const correct = total > 0 && submitted.length === target.length && matchedCount === total;
  return { correct, matchedCount, total, firstMismatchIndex };
}

function paidOnly(req, res) {
  if (!drillsUnlocked(req.account)) { res.status(402).json({ error: 'plan_required', reason: 'satzbau_is_paid' }); return false; }
  return true;
}

// Fisher-Yates shuffle of a sentence's own tiles into a serving order that is NOT already the answer
// (re-shuffles once if a short sentence happens to land in its own correct order by chance).
function shuffledTiles(sentence) {
  const tokens = splitTokens(sentence);
  const shuffle = () => {
    const arr = tokens.slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  };
  let tiles = shuffle();
  if (tokens.length > 2 && tiles.every((t, i) => t === tokens[i])) tiles = shuffle();
  return tiles;
}

// UNSEEN-first selection (never repeat until the pool cycles), same idiom as shadowing/listening.
function pickUnseen(seen, n) {
  const idx = SENTENCES.map((s) => s.id);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const seenSet = new Set(Array.isArray(seen) ? seen : []);
  let unseen = idx.filter((i) => !seenSet.has(i));
  let reset = false;
  if (unseen.length < n) { unseen = idx; reset = true; }
  return { ids: unseen.slice(0, n), reset };
}

// GET a fresh session — unseen items, sorted shortest→longest so the round itself is the difficulty
// ramp (easier word-order first, longer C1 clause-chains later, all against the client-side clock).
satzbauRouter.get('/satzbau', requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  res.set('Cache-Control', 'no-store');
  const uid = req.account.id;
  try {
    const u = await loadUser(uid);
    const seen = Array.isArray(u.satzbauSeen) ? u.satzbauSeen : [];
    const { ids, reset } = pickUnseen(seen, PER_SESSION);
    const byId = new Map(SENTENCES.map((s) => [s.id, s]));
    const picked = ids.map((id) => byId.get(id)).sort((a, b) => splitTokens(a.sentence).length - splitTokens(b.sentence).length);
    const items = picked.map((s) => ({
      id: s.id, level: s.level, connector: s.connector,
      cue_de: s.cue_de, cue_ar: '',
      tiles: shuffledTiles(s.sentence),
    }));
    u.satzbauSeen = reset ? ids.slice() : [...seen, ...ids];
    await saveUser(u);
    return res.json({ items });
  } catch {
    const { ids } = pickUnseen([], PER_SESSION);
    const byId = new Map(SENTENCES.map((s) => [s.id, s]));
    const items = ids.map((id) => byId.get(id)).sort((a, b) => splitTokens(a.sentence).length - splitTokens(b.sentence).length)
      .map((s) => ({ id: s.id, level: s.level, connector: s.connector, cue_de: s.cue_de, cue_ar: '', tiles: shuffledTiles(s.sentence) }));
    return res.json({ items });
  }
});

// POST the learner's assembled tile order → deterministic grade. The target is resolved server-side
// from the fixed pool by id (never trusts a client-sent sentence).
satzbauRouter.post('/satzbau/grade', express.json({ limit: '8kb' }), requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  res.set('Cache-Control', 'no-store');
  const id = parseInt(req.body?.id, 10);
  const item = Number.isInteger(id) ? SENTENCES.find((s) => s.id === id) : null;
  if (!item) return res.status(400).json({ error: 'bad_item' });
  const submitted = Array.isArray(req.body?.tokens) ? req.body.tokens.map(String) : [];
  const target = splitTokens(item.sentence);
  const result = gradeSatzbau(target, submitted);
  console.log(`[satzbau] user=${req.account.id} id=${id} correct=${result.correct} matched=${result.matchedCount}/${result.total}`);
  res.json({ ...result, target: item.sentence });
});
