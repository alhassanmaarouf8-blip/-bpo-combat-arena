/**
 * assessmentRamp.mjs — deterministic adaptive question routing for the Diagnose-Interview (v2 Phase 1).
 *
 * WHAT THIS IS: the examiner's pacing hand. It replays the answers given so far and decides which
 * question tier to probe next — up when the candidate copes, confirm when they wobble, stop when
 * a breakdown is confirmed. Exactly what an elite examiner does in the room: probe upward until it
 * breaks, then work there.
 *
 * WHAT THIS IS NOT: a grader. Routing thresholds below pick QUESTIONS, they never touch the
 * learner-visible verdict — that stays with /assessment/analyze and its honest-when-thin clamps.
 * A mis-tuned threshold here shows an easier question; it can never show a wrong number.
 *
 * LAWS: pure + deterministic (same answers in → same plan out; no LLM, no network, no Date/random).
 * Slip-vs-system: ONE weak answer never ends the run — it triggers a confirm question at the same
 * tier (a slip is not a system). Two consecutive weak = confirmed breakdown.
 */

// ── Question bank ────────────────────────────────────────────────────────────────
// qids 1–5 are the shipped assessment questions (client/src/Assessment.jsx) verbatim — German and
// masri already live in prod. qids 6–8 are new; their `ar` is an OWNER-AR slot (never authored
// here — masri law). A client must render `de` when `ar` is empty.
export const RAMP_QUESTIONS = [
  { id: 1, tier: 0, band: 'A1 · A2', de: 'Stellen Sie sich kurz vor — Name, Herkunft, was Sie arbeiten.', ar: 'عرّف بنفسك باختصار — الاسم، إنت منين، وبتشتغل إيه.' },
  { id: 2, tier: 0, band: 'A2 · B1', de: 'Beschreiben Sie Ihren letzten Arbeitstag. Was haben Sie gemacht?', ar: 'احكِ عن آخر يوم شغل ليك. عملت إيه؟' },
  { id: 3, tier: 1, band: 'B1', de: 'Ein Kunde ist verärgert — seine Lieferung ist nicht angekommen. Was sagen Sie ihm?', ar: 'عميل زعلان لأن الشحنة متوصلتش. هتقول له إيه؟' },
  { id: 6, tier: 1, band: 'B1', de: 'Warum möchten Sie im Kundenservice arbeiten? Erklären Sie Ihre Gründe.', ar: '' /* OWNER-AR */ },
  { id: 4, tier: 2, band: 'B1 · B2', de: 'Erzählen Sie von einem Konflikt mit einem Kollegen und wie Sie ihn gelöst haben.', ar: 'احكِ عن خلاف حصل مع زميل وإزاي حليته.' },
  { id: 7, tier: 2, band: 'B1 · B2', de: 'Ein Kunde versteht Ihre Erklärung nicht und wird ungeduldig. Wie erklären Sie ihm das Problem auf eine andere Weise?', ar: '' /* OWNER-AR */ },
  { id: 5, tier: 3, band: 'B2 · C1', de: 'Warum sollten wir Sie einstellen und nicht jemand anderen? Begründen Sie mit Beispielen.', ar: 'ليه نعيّنك إنت بالذات مش حد تاني؟ اشرح بأمثلة.' },
  { id: 8, tier: 3, band: 'B2 · C1', de: 'Ihre Teamleiterin trifft eine Entscheidung, die Sie für falsch halten. Wie sprechen Sie das an, ohne den Konflikt zu verschärfen?', ar: '' /* OWNER-AR */ },
];

const TOP_TIER    = 3;
const MIN_ANSWERS = 3;  // an examiner never issues a verdict off 1–2 answers (D4 evidence floor)
const MAX_ANSWERS = 7;  // hard cap — an assessment must end
const BY_ID = new Map(RAMP_QUESTIONS.map((q) => [q.id, q]));

// Subordinating conjunctions = the cheapest deterministic "complex structure attempted" signal.
// Also the seed of Phase-2 avoidance detection: a B1-claiming candidate whose answers never
// contain ONE of these across a whole run is hiding from subordinate clauses.
const SUBORD = /\b(weil|dass|obwohl|wenn|als|damit|nachdem|bevor|während|falls|sodass|indem)\b/gi;

const tokenize = (s) => String(s || '').match(/\p{L}+/gu) || [];

// ── Per-answer measurement (pure; numbers feed ROUTING only, never a learner-visible score) ──
export function measureAnswer({ transcript = '', durationMs = 0, inputMode = 'typed' } = {}) {
  const words = tokenize(transcript);
  const wordCount = words.length;
  const unique = new Set(words.map((w) => w.toLowerCase())).size;
  SUBORD.lastIndex = 0;
  const subordCount = (String(transcript || '').match(SUBORD) || []).length;
  return {
    wordCount,
    subordCount,
    typeTokenRatio: wordCount >= 20 ? Math.round((unique / wordCount) * 1000) / 1000 : null,
    wpm: inputMode === 'voice' && durationMs >= 2000 ? Math.round(wordCount / (durationMs / 60000)) : null,
  };
}

// Coping = did the answer carry the tier? Higher tiers demand at least one attempted complex
// structure — length alone can be memorized A2 chunks.
export function classifyCoping(m, tier) {
  if (m.wordCount < 12) return 'weak';
  if (m.wordCount >= 25 && (tier < 2 || m.subordCount >= 1)) return 'strong';
  return 'mid';
}

/**
 * planNext(answers) → { done, reason, tier, next, trace }
 * answers: ordered [{ qid, transcript, durationMs, inputMode }] as actually asked/answered.
 * Throws TypeError on an unknown qid (a client can only ask questions this bank issued).
 */
export function planNext(answers = []) {
  if (!Array.isArray(answers)) throw new TypeError('answers_not_array');
  const trace = [];
  let tier = 0, weakStreak = 0, done = false, reason = null;

  for (const a of answers) {
    const q = BY_ID.get(a?.qid);
    if (!q) throw new TypeError(`unknown_qid:${String(a?.qid)}`);
    const m = measureAnswer(a);
    const coping = classifyCoping(m, q.tier);
    trace.push({ qid: q.id, tier: q.tier, coping, ...m });

    if (coping === 'strong') {
      weakStreak = 0;
      if (q.tier === TOP_TIER && trace.length >= MIN_ANSWERS) { done = true; reason = 'ceiling'; break; }
      tier = Math.min(q.tier + 1, TOP_TIER);
    } else if (coping === 'mid') {
      weakStreak = 0;
      tier = q.tier; // confirm at the same tier — the working level may be here
    } else {
      weakStreak += 1;
      if (weakStreak >= 2) {
        // Confirmed breakdown (system, not slip). Below the evidence floor we step DOWN instead
        // of stopping — let the candidate show what they CAN do before any run ends.
        if (trace.length >= MIN_ANSWERS) { done = true; reason = 'breakdown'; break; }
        tier = Math.max(q.tier - 1, 0);
      } else {
        tier = q.tier; // one weak answer = confirm question at the same tier
      }
    }
  }

  if (!done && trace.length >= MAX_ANSWERS) { done = true; reason = 'cap'; }

  let next = null;
  if (!done) {
    const asked = new Set(trace.map((t) => t.qid));
    next = RAMP_QUESTIONS.find((q) => q.tier === tier && !asked.has(q.id)) || null;
    // Tier exhausted below the evidence floor: don't end a 2-answer run — probe the nearest tier
    // (upward first: give them the chance to show more, exactly what an examiner does).
    if (!next && trace.length < MIN_ANSWERS) {
      for (const d of [1, 2, 3, -1, -2, -3]) {
        const t2 = tier + d;
        if (t2 < 0 || t2 > TOP_TIER) continue;
        next = RAMP_QUESTIONS.find((q) => q.tier === t2 && !asked.has(q.id)) || null;
        if (next) break;
      }
    }
    // Tier exhausted at/above the floor and no rule moved us: the working level is found — end.
    if (!next) { done = true; reason = trace.length ? 'tier_exhausted' : 'empty_bank'; }
  }

  return { done, reason, tier, next, trace };
}
