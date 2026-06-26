/**
 * srs.js
 * Spaced repetition for the specific grammar rules and words a user got wrong.
 * Expanding schedule: 1 → 3 → 7 → 14 → 30 days. New lapses reset to the front.
 *
 * Items are PRODUCTION tasks (the user must produce the German, not just recognize it),
 * graded with lenient string matching so near-perfect production counts.
 */
export const INTERVALS_DAYS = [1, 3, 7, 14, 30];
const DAY = 24 * 60 * 60 * 1000;

// A SPEAKER cannot produce a comma, a capital letter, or a hyphen by voice — so punctuation/casing/
// spelling rules are NOT drillable in a spoken trainer. Scrub them from due items + the due count so
// they never become "your weakness" or a spoken drill (also retro-fixes already-stored comma items).
const PUNCT_RULE = /komma|zeichensetzung|interpunktion|anführung|bindestrich|apostroph|schreibung|getrennt.{0,8}zusammen|leerzeichen|typograf/i;
const drillable = (i) => i.type !== 'grammar' || !PUNCT_RULE.test(String(i.content || ''));

export function srsKey(type, content) {
  return `${type}:${String(content).toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60)}`;
}

/**
 * Add a new SRS item, or — if the user erred on something already tracked — pull it
 * back one stage so it resurfaces sooner. New items are due immediately (first review
 * happens in the next session), then expand on each successful recall.
 */
export function addItem(profile, { type, content, prompt, answer, example }, now = Date.now()) {
  const id = srsKey(type, content);
  let item = profile.srs.find((i) => i.id === id);
  if (item) {
    item.stage     = Math.max(0, item.stage - 1);
    item.due       = now;
    item.mastered  = false;
    item.lapses    = (item.lapses || 0) + 1;
    if (prompt) item.prompt = prompt;
    if (answer) item.answer = answer;
    return item;
  }
  item = {
    id, type, content,
    prompt:  prompt ?? content,
    answer:  answer ?? content,
    example: example ?? null,
    stage:   0,
    due:     now,           // first review in the next session
    reps:    0,
    lapses:  0,
    mastered: false,
    createdAt: now,
    lastResult: null,
  };
  profile.srs.push(item);
  return item;
}

export function dueItems(profile, now = Date.now(), limit = 8) {
  return (profile.srs || [])
    .filter((i) => !i.mastered && i.due <= now && drillable(i))
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
}

export function dueCount(profile, now = Date.now()) {
  return (profile.srs || []).filter((i) => !i.mastered && i.due <= now && drillable(i)).length;
}

/** Apply a recall result and advance/reset the schedule. Returns the updated item. */
export function grade(profile, id, correct, now = Date.now()) {
  const item = (profile.srs || []).find((i) => i.id === id);
  if (!item) return null;
  item.reps      += 1;
  item.lastResult = correct ? 'correct' : 'wrong';
  if (correct) {
    item.stage = Math.min(INTERVALS_DAYS.length - 1, item.stage + 1);
    item.due   = now + INTERVALS_DAYS[item.stage] * DAY;
    // Cleared the whole schedule with enough successful reps → mastered.
    if (item.stage >= INTERVALS_DAYS.length - 1 && item.reps >= INTERVALS_DAYS.length) {
      item.mastered = true;
    }
  } else {
    item.stage  = 0;
    item.due    = now + INTERVALS_DAYS[0] * DAY;
    item.lapses += 1;
  }
  return item;
}

// ── Production grading — ONE consistent rule ─────────────────────────────────────
//
// Canonical form used for EVERY comparison: same normalization every time, so identical
// words can never be marked wrong by an encoding/whitespace/quote quirk.
//   • NFC Unicode  → ä ö ü ß (and pre/de-composed umlauts) always compare equal
//   • curly/typographic quotes & apostrophes → straight equivalents
//   • collapse internal whitespace, trim both ends
// Case is PRESERVED here (lower-casing happens only for the verdict) so we can detect a
// capitalization-only slip and echo the exact correct spelling.
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[‘’ʼ´`]/g, "'")   // ‘ ’ ʼ ´ ` → '
    .replace(/[“”„«»″]/g, '"') // “ ” „ « » ″ → "
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}

/**
 * THE single grading rule. Returns { correct, note }.
 *   correct: case-INSENSITIVE exact match, OR a single-character typo on a word of 4+
 *            letters (so "alternativ" ≈ "Alternative"; short words must match exactly,
 *            which prevents a 1-edit slip from accepting a genuinely different word).
 *   note:    when correct but the user wrote a capitalized noun in lower case, a gentle
 *            "Achtung: Nomen großschreiben → <correct form>" nudge.
 */
export function checkAnswer(answer, expected) {
  const aRaw = normalize(answer);     // case preserved
  const eRaw = normalize(expected);
  if (!aRaw || !eRaw) return { correct: false, note: '' };

  const a = aRaw.toLowerCase();       // case-folded for the verdict
  const e = eRaw.toLowerCase();

  const correct = a === e || (e.length >= 4 && levenshtein(a, e) <= 1);

  // German nouns are capitalized: right answer, but written lower-case → accept + nudge.
  const capFix  = correct && /^[A-ZÄÖÜ]/.test(eRaw) && /^[a-zäöüß]/.test(aRaw);
  const note    = capFix ? `Achtung: Nomen großschreiben → ${eRaw}` : '';
  const note_ar = capFix ? `انتبه: تُكتب الأسماء بحرف كبير ← ${eRaw}` : '';

  return { correct, note, note_ar };
}

/** Backward-compatible boolean wrapper — same single rule as checkAnswer(). */
export function isCorrect(answer, expected) {
  return checkAnswer(answer, expected).correct;
}

/**
 * Seed BPO call-center phrases into SRS as production tasks.
 * Safe to call multiple times — won't duplicate already-tracked items.
 * Called at session-end (after debrief) so candidates get phrase drills
 * between sessions rather than only grammar-rule drills.
 *
 * @param {object} profile  - the user's stored profile (has profile.srs array)
 * @param {Array}  phrases  - BPO_PHRASES array from scenarios.js
 */
export function seedBPOPhrases(profile, phrases) {
  if (!Array.isArray(profile?.srs)) profile.srs = [];
  if (!Array.isArray(phrases)) return;
  for (const p of phrases) {
    const id = srsKey('phrase', p.de);
    const already = profile.srs.find((i) => i.id === id);
    if (already) continue;  // already tracked — don't overwrite progress
    profile.srs.push({
      id,
      type:      'phrase',
      content:   p.de,
      prompt:    p.en,          // shown to the candidate: "produce the German for..."
      answer:    p.de,
      example:   p.drill ?? null,
      stage:     0,
      due:       Date.now(),    // due immediately in next session
      reps:      0,
      lapses:    0,
      mastered:  false,
      createdAt: Date.now(),
      lastResult: null,
    });
  }
}
