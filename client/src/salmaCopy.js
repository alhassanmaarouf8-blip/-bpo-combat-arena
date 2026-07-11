/**
 * salmaCopy.js — every word "Salma" (the recruiter) ever says, as FIXED owner-authorable templates.
 *
 * THE LAW (El-Captain precedent, deleted 2026-07-10): none of her lines are ever LLM-generated.
 * Each template is {de:'…', ar:''} on ONE line with an OWNER-AR marker + EN gloss, so
 * scripts/owner-ar-sheet.mjs extracts them all into the owner's one-sitting masri fill sheet.
 * Empty ar falls back to de at runtime — a raw placeholder can never render.
 *
 * {slots} carry REAL backend values only; the source field is named beside every slotted key.
 * Her ~12 slot-free ceremonial lines are also listed in docs/SALMA-VOICE-SCRIPT.md for the owner's
 * optional one-time voice-clip generation (v1 ships silent).
 */

export const SALMA = {
  name: 'Salma',
  nameAr: '', // OWNER-AR · EN: Arabic spelling of her name (renders "Salma" until filled)
  role: { de: 'Deine Recruiterin', ar: '' }, // OWNER-AR · EN: "Your recruiter"
};

export const SALMA_COPY = {
  // ── cold-open · variant "new" ─────────────────────────────────────────────────────────────
  intro_welcome: { de: 'Willkommen! Ich bin Salma, deine Recruiterin. Ab heute gehst du in kein Interview mehr allein: ich bereite dich vor, und ich buche deine Termine.', ar: '' }, // OWNER-AR · EN: "Welcome! I'm Salma, your recruiter. From today you never walk into an interview alone: I prepare you, and I book your appointments."
  // {days} ← auth.account.entitlement.trial.daysLeft
  intro_trial: { de: 'Deine ersten {days} Tage sind komplett frei — echte Interviews inklusive.', ar: '' }, // OWNER-AR · EN: "Your first {days} days are fully free — real interviews included."
  name_ask: { de: 'Zuerst: Wie soll ich dich nennen?', ar: '' }, // OWNER-AR · EN: "First: what should I call you?"
  name_label: { de: 'Dein Name', ar: '' }, // OWNER-AR · EN: "Your name" (input label)
  goal_ask: { de: 'Und was ist dein Ziel?', ar: '' }, // OWNER-AR · EN: "And what is your goal?"
  goal_bpo: { de: 'Einen deutschen BPO-Job', ar: '' }, // OWNER-AR · EN: "A German BPO job" (chip, value bpo-job)
  goal_german: { de: 'Besseres Deutsch', ar: '' }, // OWNER-AR · EN: "Better German" (chip, value better-german)
  goal_other: { de: 'Etwas anderes', ar: '' }, // OWNER-AR · EN: "Something else" (chip, value other)
  screening_invite: { de: 'Bevor ich dich vermitteln kann, muss ich dich hören. Fünf kurze Fragen, du sprichst frei — das ist dein Screening. Danach sage ich dir ehrlich, wo du stehst.', ar: '' }, // OWNER-AR · EN: "Before I can place you, I need to hear you. Five short questions, you speak freely — that's your screening. Then I tell you honestly where you stand."
  screening_cta: { de: 'Screening starten', ar: '' }, // OWNER-AR · EN: "Start screening" (button)

  // ── cold-open · verdict + booking ─────────────────────────────────────────────────────────
  // {level} ← GET /api/assessment/status → result.estimatedLevel · {focus} ← result.recommendedFocus (verbatim)
  verdict_summary: { de: 'Dein Screening ist ausgewertet: Niveau {level}. Woran wir zuerst arbeiten: {focus}', ar: '' }, // OWNER-AR · EN: "Your screening is in: level {level}. What we work on first: {focus}"
  // {quote} ← result.blockers[0] own-words example (substring-verified upstream — never invented)
  verdict_blocker: { de: 'Aus deiner eigenen Antwort notiert: „{quote}“ — genau da setzen wir an.', ar: '' }, // OWNER-AR · EN: "Noted from your own answer: '{quote}' — exactly where we start."
  booking_yasmin: { de: 'Ich habe deinen ersten Termin gebucht: Yasmin, Junior-Recruiterin. Sie ist die Freundlichste im Haus — genau richtig für den Anfang.', ar: '' }, // OWNER-AR · EN: "I've booked your first appointment: Yasmin, junior recruiter. The friendliest in the building — exactly right to start."
  booking_cta: { de: 'Zum Interview', ar: '' }, // OWNER-AR · EN: "To the interview" (the one orange CTA)
  no_verdict: { de: 'Dein Screening ist noch nicht fertig — kein Problem. Du entscheidest, wie wir weitermachen.', ar: '' }, // OWNER-AR · EN: "Your screening isn't finished yet — no problem. You decide how we continue."
  no_verdict_resume: { de: 'Screening fortsetzen', ar: '' }, // OWNER-AR · EN: "Continue screening" (button)
  no_verdict_direct: { de: 'Direkt ins Interview', ar: '' }, // OWNER-AR · EN: "Straight to the interview" (button)

  // ── cold-open · variant "returning" ───────────────────────────────────────────────────────
  returning_welcome: { de: 'Kurz vorstellen: Ich bin Salma, ab heute deine Recruiterin. Ich habe deine Akte schon gelesen.', ar: '' }, // OWNER-AR · EN: "Quick intro: I'm Salma, your recruiter from today. I've already read your file."
  // {name} ← GET /api/guide/profile → name
  returning_welcome_named: { de: '{name} — schön, dich zu sehen. Ich bin Salma, ab heute deine Recruiterin. Deine Akte habe ich schon gelesen.', ar: '' }, // OWNER-AR · EN: "{name} — good to see you. I'm Salma, your recruiter from today. I've already read your file."
  returning_handoff: { de: 'Meine Notizen zu dir findest du ab jetzt direkt auf deinem Startbildschirm — mit deinem nächsten Schritt. Ich melde mich nach jedem Interview.', ar: '' }, // OWNER-AR · EN: "You'll find my notes on your home screen from now on — with your next step. I'll follow up after every interview."
  returning_cta: { de: 'Verstanden', ar: '' }, // OWNER-AR · EN: "Understood" (button)

  // ── shared cold-open controls ─────────────────────────────────────────────────────────────
  continue_label: { de: 'Weiter', ar: '' }, // OWNER-AR · EN: "Continue" (button)
  skip_label: { de: 'Überspringen', ar: '' }, // OWNER-AR · EN: "Skip" (quiet link, always available)
  later_label: { de: 'Später', ar: '' }, // OWNER-AR · EN: "Later" (quiet link)

  // ── home card notes (Phase B) ─────────────────────────────────────────────────────────────
  // {rule} ← /api/progress topWeakness.rule (through ruleLabel) · {lapses} ← topWeakness.lapses
  note_weakness: { de: 'Meine Notiz aus deiner Akte: {rule} — zuletzt {lapses}× aufgefallen.', ar: '' }, // OWNER-AR · EN: "My note from your file: {rule} — flagged {lapses}x recently."
  // {days} ← auth.account.entitlement.trial.daysLeft
  note_trial: { de: 'Dein freier Zugang läuft noch {days} Tage — nutze sie.', ar: '' }, // OWNER-AR · EN: "Your free access runs {days} more days — use them."

  // ── pipeline board + rival (post-v1) ──────────────────────────────────────────────────────
  pipeline_label: { de: 'Deine Termine bei mir', ar: '' }, // OWNER-AR · EN: "Your appointments with me" (pipeline heading)
  // {name} ← /api/progress nextBoss.name · {tier} ← nextBoss.tier (the real org ladder)
  pipeline_next: { de: 'Als Nächstes buche ich dir: {name} · {tier}.', ar: '' }, // OWNER-AR · EN: "Next I book you: {name} · {tier}."
  pipeline_top: { de: 'Du hast die ganze Leiter vor dir — jede Stufe ist ein echtes Interview.', ar: '' }, // OWNER-AR · EN: "The whole ladder is ahead of you — every rung is a real interview."
  // {masked} ← /api/leaderboard entry.masked (server-masked email) · {sessions} ← entry.liveSessions
  note_rival_ahead: { de: 'Kandidat {masked} liegt direkt vor dir — {sessions} Live-Interviews diese Woche. Der Platz ist zu holen.', ar: '' }, // OWNER-AR · EN: "Candidate {masked} is right ahead of you — {sessions} live interviews this week. The spot is takeable."
  note_rival_leader: { de: 'Du führst mein Kandidaten-Feld diese Woche an — halte den Platz.', ar: '' }, // OWNER-AR · EN: "You lead my candidate field this week — hold the spot."
  // {count} ← entries.length · {masked}/{sessions} ← the current leader
  note_rival_field: { de: '{count} Kandidaten trainieren diese Woche — {masked} führt mit {sessions} Interviews.', ar: '' }, // OWNER-AR · EN: "{count} candidates are training this week — {masked} leads with {sessions} interviews."

  // ── paywall (Phase C) ─────────────────────────────────────────────────────────────────────
  // {days} ← entitlement.trial.daysLeft
  paywall_trial_active: { de: 'Du bist noch {days} Tage in deiner freien Testphase — echte Interviews inklusive. Danach brauche ich den vollen Auftrag, um weiter für dich zu buchen.', ar: '' }, // OWNER-AR · EN: "You have {days} more days of your free trial — real interviews included. After that I need the full mandate to keep booking for you."
  paywall_trial_over: { de: 'Ehrlich gesagt: Auf der kostenlosen Akte kann ich dich nur screenen. Wenn ich weiter Interviews für dich buchen soll, brauche ich den vollen Auftrag.', ar: '' }, // OWNER-AR · EN: "Honestly: on the free file I can only screen you. If I'm to keep booking interviews for you, I need the full mandate."
  paywall_free_file: { de: 'Dein nächstes Interview ist bereit, sobald du dein Konto freischaltest — dann buche ich sofort.', ar: '' }, // OWNER-AR · EN: "Your next interview is ready as soon as you activate your account — then I book immediately."
};

// salmaLine('verdict_summary', lang, { level:'B1', focus:'…' }) → the filled string.
// ar wins only when the owner has actually written it; empty ar falls back to de so an
// unfilled slot can never leak a placeholder. Unfilled {slots} are left visible on purpose
// in dev (easier to spot than silently vanishing text).
export function salmaLine(key, lang, slots = {}) {
  const entry = SALMA_COPY[key];
  if (!entry) return '';
  let s = (lang === 'ar' && entry.ar) ? entry.ar : entry.de;
  for (const [k, v] of Object.entries(slots)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

export const salmaName = (lang) => (lang === 'ar' && SALMA.nameAr) ? SALMA.nameAr : SALMA.name;
export const salmaRole = (lang) => (lang === 'ar' && SALMA.role.ar) ? SALMA.role.ar : SALMA.role.de;
