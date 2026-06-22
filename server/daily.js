/**
 * daily.js — "Tägliches Training": a 3–5 minute text-only daily micro-session.
 *
 * Content is the user's OWN past mistakes (from the SRS store) plus a BPO "phrase of
 * the day". Grading is deterministic (checkAnswer) — ZERO API cost. A separate daily
 * streak increments only when the session is completed. Backend is the source of truth:
 * answers are never sent to the client; the client submits answers and the server grades.
 *
 *   GET  /api/daily            → today's session (questions without answers, phrase, streak)
 *   POST /api/daily/grade      → grade one answer { id, answer } → { correct, expected, note }
 *   POST /api/daily/complete   → mark today done, advance the streak → { streak, completedToday }
 */
import express from 'express';
import { loadUser, saveUser } from './store.js';
import { requireAuth, planOf } from './auth.js';
import { dueItems, grade, checkAnswer } from './srs.js';
import { BPO_PHRASES }        from './scenarios.js';
import { dayKey }             from './time.js';
import { generateDrillSet }   from './planGuide.js';

export const dailyRouter = express.Router();
const DAY = 24 * 60 * 60 * 1000;

// dayKey() (YYYY-MM-DD) is anchored to the audience's timezone (Cairo) via time.js,
// so "today/yesterday" match the learner's calendar day — not the UTC server clock.

// Level-appropriate BPO fallback drills when the user has no tracked mistakes yet.
// All "fix the sentence" style → a single correct answer, so grading is unambiguous.
const FALLBACK_DRILLS = [
  { id: 'fb:weil-end',    kind: 'fix',   prompt: 'Korrigiere den Satz: „Weil ich habe drei Jahre Erfahrung."', answer: 'Weil ich drei Jahre Erfahrung habe.', hint: 'Verb ans Satzende nach „weil".' },
  { id: 'fb:dass-end',    kind: 'fix',   prompt: 'Korrigiere: „Ich denke dass ich kann das gut machen."',      answer: 'Ich denke, dass ich das gut machen kann.', hint: 'Verb ans Ende im „dass"-Satz, Komma nicht vergessen.' },
  { id: 'fb:sein-perf',   kind: 'fix',   prompt: 'Korrigiere: „Ich habe gestern nach Hause gegangen."',         answer: 'Ich bin gestern nach Hause gegangen.', hint: '„gehen" bildet das Perfekt mit „sein".' },
  { id: 'fb:inversion',   kind: 'fix',   prompt: 'Korrigiere: „Deshalb ich rufe Sie morgen zurück."',           answer: 'Deshalb rufe ich Sie morgen zurück.', hint: 'Verb an Position 2 — Subjekt danach.' },
  { id: 'fb:hoeflich',    kind: 'fix',   prompt: 'Höflicher formulieren: „Geben Sie mir Ihre Kundennummer."',   answer: 'Könnten Sie mir bitte Ihre Kundennummer geben?', hint: 'Konjunktiv II + „bitte".' },
  { id: 'fb:kuemmern',    kind: 'fix',   prompt: 'Korrigiere die Präposition: „Ich kümmere mich über Ihr Problem."', answer: 'Ich kümmere mich um Ihr Problem.', hint: '„sich kümmern um" + Akkusativ.' },
  { id: 'fb:agree',       kind: 'fix',   prompt: 'Korrigiere: „Er gehen jeden Tag zur Arbeit."',                answer: 'Er geht jeden Tag zur Arbeit.', hint: 'Subjekt-Verb-Kongruenz (er → geht).' },
  { id: 'fb:obwohl',      kind: 'fix',   prompt: 'Korrigiere: „Trotzdem dass es spät war, ich habe geholfen."',  answer: 'Obwohl es spät war, habe ich geholfen.', hint: '„obwohl" leitet den Nebensatz ein.' },
];

function pickByDay(arr, salt = 0) {
  if (!arr.length) return null;
  const n = parseInt(dayKey().replace(/-/g, ''), 10) + salt;
  return arr[n % arr.length];
}

// Live streak: counts only if the last completion was today or yesterday, else it's broken.
export function dailyStatus(profile) {
  const today = dayKey();
  const yest  = dayKey(Date.now() - DAY);
  const streak = (profile.lastDailyDate === today || profile.lastDailyDate === yest)
    ? (profile.dailyStreak || 0) : 0;
  return { streak, completedToday: profile.lastDailyDate === today, best: profile.dailyBest || 0 };
}

// Build today's session: the user's due mistakes (topped up with fallback drills to ≥3),
// plus the phrase of the day. Answers are NOT included.
function buildDaily(profile) {
  const due = dueItems(profile, Date.now(), 8);
  const fromMistakes = due.map((i) => ({
    id:     i.id,
    kind:   i.type === 'vocab' ? 'vocab' : 'fix',
    prompt: i.prompt,
    hint:   i.example?.wrong ? `Dein Satz: „${i.example.wrong}"` : (i.type === 'vocab' ? 'Produziere das deutsche Wort.' : null),
    source: 'mistake',
  }));

  let questions = fromMistakes.slice(0, 5);
  const source = questions.length ? 'mistakes' : 'fallback';
  if (questions.length < 3) {
    // Top up deterministically (stable per day) without repeating ids.
    const used = new Set(questions.map((q) => q.id));
    const start = parseInt(dayKey().replace(/-/g, ''), 10) % FALLBACK_DRILLS.length;
    for (let k = 0; k < FALLBACK_DRILLS.length && questions.length < 4; k++) {
      const fb = FALLBACK_DRILLS[(start + k) % FALLBACK_DRILLS.length];
      if (!used.has(fb.id)) { used.add(fb.id); questions.push({ id: fb.id, kind: fb.kind, prompt: fb.prompt, hint: fb.hint, source: 'drill' }); }
    }
  }

  const phrase = pickByDay(BPO_PHRASES) ?? BPO_PHRASES[0];
  return { date: dayKey(), ...dailyStatus(profile), source, phrase, questions };
}

// How many generated-drill answers we retain on the profile so /daily/grade can resolve
// them. Bounded so unlimited sets never grow the record without limit (~3 recent sets).
const GEN_KEEP = 12;

// Build a FRESH drill set on demand (paid users → unlimited). Tries the cheap gpt-4o-mini
// path for genuinely new items; on ANY failure falls back to a ROTATING slice of the
// built-in drills so the endpoint always returns a non-empty set. Generated answers are
// stored on profile.dailyGen so grading stays deterministic (the model never grades).
// Does NOT advance the daily streak — pulling extra sets must not let a user farm streaks.
async function buildFreshSet(profile) {
  const level = profile.sessions?.slice(-1)[0]?.level === 'b2' ? 'b2' : 'a2-b1';
  const avoid = (profile.dailyGen || []).map((d) => d.prompt).filter(Boolean);

  let questions = [];
  let source = 'generated';
  try {
    const drills = await generateDrillSet({ count: 4, level, avoid });
    if (drills.length) {
      profile.dailyGen = Array.isArray(profile.dailyGen) ? profile.dailyGen : [];
      const stamp = Date.now().toString(36);
      questions = drills.map((d, i) => {
        const id = `gen:${stamp}:${i}`;
        profile.dailyGen.push({ id, prompt: d.prompt, answer: d.answer, hint: d.hint || null });
        return { id, kind: 'fix', prompt: d.prompt, hint: d.hint || null, source: 'generated' };
      });
      if (profile.dailyGen.length > GEN_KEEP) profile.dailyGen = profile.dailyGen.slice(-GEN_KEEP);
    }
  } catch (e) {
    console.error('[daily] fresh-set generation failed:', e.message);
  }

  // Fallback (no AI / failure): rotate through the built-in drills — never an empty set.
  if (!questions.length) {
    source = 'fallback';
    const rot   = Number.isInteger(profile.dailyRot) ? profile.dailyRot : 0;
    const start = rot % FALLBACK_DRILLS.length;
    for (let k = 0; k < 4; k++) {
      const fb = FALLBACK_DRILLS[(start + k) % FALLBACK_DRILLS.length];
      questions.push({ id: fb.id, kind: fb.kind, prompt: fb.prompt, hint: fb.hint, source: 'drill' });
    }
    profile.dailyRot = (start + 4) % FALLBACK_DRILLS.length;
  }

  const phrase = pickByDay(BPO_PHRASES, profile.dailyRot || 0) ?? BPO_PHRASES[0];
  return { date: dayKey(), ...dailyStatus(profile), source, fresh: true, phrase, questions };
}

// Grade ONE answer. SRS items advance the schedule; fallback + generated drills just grade.
function gradeDailyItem(profile, id, answer) {
  if (String(id).startsWith('fb:')) {
    const fb = FALLBACK_DRILLS.find((d) => d.id === id);
    if (!fb) return { error: 'unknown_item' };
    const { correct, note, note_ar } = checkAnswer(answer, fb.answer);
    return { correct, note, note_ar, expected: fb.answer };
  }
  if (String(id).startsWith('gen:')) {
    const g = (profile.dailyGen || []).find((d) => d.id === id);
    if (!g) return { error: 'unknown_item' };
    const { correct, note, note_ar } = checkAnswer(answer, g.answer);
    return { correct, note, note_ar, expected: g.answer };
  }
  const item = (profile.srs || []).find((i) => i.id === id);
  if (!item) return { error: 'unknown_item' };
  const { correct, note, note_ar } = checkAnswer(answer, item.answer);
  grade(profile, id, correct, Date.now());   // advance/reset the spaced-repetition schedule
  return { correct, note, note_ar, expected: item.answer };
}

// Mark today complete and advance the streak (idempotent within a day).
function completeDaily(profile) {
  const today = dayKey();
  if (profile.lastDailyDate !== today) {
    const yest = dayKey(Date.now() - DAY);
    profile.dailyStreak  = (profile.lastDailyDate === yest) ? (profile.dailyStreak || 0) + 1 : 1;
    profile.lastDailyDate = today;
    if (profile.dailyStreak > (profile.dailyBest || 0)) profile.dailyBest = profile.dailyStreak;
    // Record today for the UNIFIED practice streak (any practice keeps the flame alive).
    profile.dailyDays = Array.isArray(profile.dailyDays) ? profile.dailyDays : [];
    if (!profile.dailyDays.includes(today)) profile.dailyDays.push(today);
    if (profile.dailyDays.length > 120) profile.dailyDays = profile.dailyDays.slice(-120);
  }
  return dailyStatus(profile);
}

dailyRouter.get('/daily', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    res.json(buildDaily(p));
  } catch (err) { console.error('[daily] get error:', err.message); res.status(500).json({ error: 'daily_failed' }); }
});

// Request ANOTHER drill set after finishing the current one. Active paid users (basic/elite,
// not expired) get a FRESH set every call — genuinely unlimited, no one-per-day cap. A
// free/expired user is held to the normal single daily set (GET /daily) → 402. planOf()
// already reverts an expired plan to 'free', so expiry is handled here automatically. This
// touches ONLY text drills; the 7-minute live-voice cap (websocketManager) is untouched.
dailyRouter.post('/daily/next', requireAuth, async (req, res) => {
  try {
    if (planOf(req.account) === 'free') {
      return res.status(402).json({ error: 'plan_required', reason: 'unlimited_drills_are_paid' });
    }
    const p   = await loadUser(req.account.id);
    const set = await buildFreshSet(p);
    await saveUser(p);   // persist generated answers + rotation cursor so grading can resolve them
    res.json(set);
  } catch (err) { console.error('[daily] next error:', err.message); res.status(500).json({ error: 'daily_failed' }); }
});

dailyRouter.post('/daily/grade', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    const { id, answer } = req.body || {};
    if (!id || typeof answer !== 'string') return res.status(400).json({ error: 'bad_request' });
    const result = gradeDailyItem(p, id, answer);
    if (result.error) return res.status(404).json(result);
    await saveUser(p);   // persist SRS advancement
    res.json(result);
  } catch (err) { console.error('[daily] grade error:', err.message); res.status(500).json({ error: 'daily_failed' }); }
});

dailyRouter.post('/daily/complete', requireAuth, async (req, res) => {
  try {
    const p = await loadUser(req.account.id);
    const status = completeDaily(p);
    await saveUser(p);
    res.json(status);
  } catch (err) { console.error('[daily] complete error:', err.message); res.status(500).json({ error: 'daily_failed' }); }
});
