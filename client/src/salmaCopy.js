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
  booking_karim: { de: 'Dein Screening zeigt: Du brauchst keinen Anfängertermin. Ich buche dich direkt bei Karim, dem Teamleiter — sachlich, schneller und auf deinem Niveau.', ar: '' }, // OWNER-AR · EN: "Your screening shows you do not need a beginner appointment. I am booking you directly with Karim, the team lead — direct, faster, and at your level."
  booking_hana: { de: 'Dein Niveau ist stark. Ich buche dich direkt bei Hana, der Hiring Managerin — dort wird nicht dein Grunddeutsch getestet, sondern ob du unter Druck überzeugst.', ar: '' }, // OWNER-AR · EN: "Your level is strong. I am booking you directly with Hana, the hiring manager — there the test is not basic German, but whether you persuade under pressure."
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

  // ── rank ceremony ───────────────────────────────────────────────────────────────────────────
  rank_anwaerter: { de: 'Du bist nicht mehr nur neu hier. Dein Rang ist jetzt Anwärter — verdient durch deine gespeicherten Interviews.', ar: '' }, // OWNER-AR · EN: "You are no longer simply new here. Your rank is now Candidate — earned through your stored interviews."
  rank_geuebt: { de: 'Rang bestätigt: Geübt. Deine Leistung hält jetzt auch über mehrere Interviews stand.', ar: '' }, // OWNER-AR · EN: "Rank confirmed: Practiced. Your performance now holds across multiple interviews."
  rank_profi: { de: 'Du hast den Profi-Rang erreicht. Ab hier zählt nicht mehr nur richtiges Deutsch, sondern Wirkung unter Druck.', ar: '' }, // OWNER-AR · EN: "You reached Professional rank. From here, it is not only correct German that counts, but impact under pressure."
  rank_ready: { de: 'Interview-Bereit. Das ist ein Trainingsrang aus deinen gespeicherten Leistungen — jetzt musst du ihn im echten Gespräch bestätigen.', ar: '' }, // OWNER-AR · EN: "Interview-ready. This is a training rank from your stored performance — now confirm it in a real interview."

  // ── drills · she assigns the training and receives it back (owner order 07-12: she leads the
  //    WHOLE journey — signup → interview → drills → next interview) ─────────────────────────
  drill_handoff: { de: 'Dein Training für heute liegt bereit — ich habe es nach deiner Akte zusammengestellt. Ein paar Minuten reichen.', ar: '' }, // OWNER-AR · EN: "Your training for today is ready — I put it together from your file. A few minutes are enough."
  drill_done: { de: 'Stark gemacht. Das kommt in deine Akte — im nächsten Interview will ich es hören.', ar: '' }, // OWNER-AR · EN: "Well done. This goes into your file — in the next interview I want to hear it."

  // ── debrief · her follow-up after every interview (keeps returning_handoff's promise) ──────
  // {name} ← fight result progress.nextBoss.name · {tier} ← progress.nextBoss.tier
  debrief_followup_next: { de: 'Ich habe dein Interview gelesen. Dein nächster Termin bei mir: {name} · {tier} — ich buche, sobald du bereit bist.', ar: '' }, // OWNER-AR · EN: "I have read your interview. Your next appointment with me: {name} · {tier} — I book the moment you are ready."
  debrief_followup_top: { de: 'Ich habe dein Interview gelesen. Du stehst ganz oben auf meiner Leiter — ab hier zählt Bestätigung unter Druck.', ar: '' }, // OWNER-AR · EN: "I have read your interview. You are at the top of my ladder — from here it is about confirming under pressure."

  // ── debrief · the Sultan homework order (07-12): dose + exit criterion + unlock ────────────
  // {boss} ← fight result progress.nextBoss.name
  homework_order: { de: 'Dein Auftrag: 15 Minuten heute und 15 Minuten morgen — genau diese Baustelle. Ziel im nächsten Interview: unter 5 Grammatik-Fehler. Dann buche ich dir {boss}.', ar: '' }, // OWNER-AR · EN: "Your assignment: 15 minutes today and 15 tomorrow — exactly this weakness. Target in the next interview: under 5 grammar errors. Then I book you {boss}."
  homework_order_top: { de: 'Dein Auftrag: 15 Minuten heute und 15 Minuten morgen — genau diese Baustelle. Ziel im nächsten Interview: unter 5 Grammatik-Fehler. Du stehst ganz oben auf meiner Leiter — bestätige es.', ar: '' }, // OWNER-AR · EN: "Your assignment: 15 minutes today and 15 tomorrow — exactly this weakness. Target in the next interview: under 5 grammar errors. You are at the top of my ladder — confirm it."

  // ── B1+ admission bar (owner law 07-12: customer = B1 aufwärts; Harvard framing — selective,
  //    never apologetic. Salma is the doorwoman: she ASKS, admits, or turns away with dignity) ──
  b1_gate_title: { de: 'AB B1 · AUFNAHME NUR MIT NIVEAU', ar: '' }, // OWNER-AR · EN: "From B1 · admission requires the level" (landing strip label)
  b1_gate_line: { de: 'Diese Arena nimmt Kandidaten ab B1 auf — hier wird für den Job trainiert, nicht für den Anfang. Noch darunter? Festige deine Grundlagen und bewirb dich dann wieder.', ar: '' }, // OWNER-AR · EN: "This arena admits candidates from B1 up — here you train for the job, not for the start. Still below? Solidify your basics and apply again."
  gate_question: { de: 'Bevor ich dich aufnehme, eine ehrliche Frage: Diese Arena ist für Kandidaten ab B1. Wo stehst du?', ar: '' }, // OWNER-AR · EN: "Before I take you on, one honest question: this arena is for candidates from B1 up. Where do you stand?"
  gate_b1: { de: 'B1 oder höher', ar: '' }, // OWNER-AR · EN: "B1 or higher" (chip)
  gate_below: { de: 'Noch nicht B1', ar: '' }, // OWNER-AR · EN: "Not B1 yet" (chip)
  gate_denied: { de: 'Respekt für die Ehrlichkeit — die meisten trauen sich das nicht. Mein Rat als Recruiterin: Festige deine Grundlagen bis B1, dann komm zurück und ich nehme dich auf. Die Tür bleibt für dich offen.', ar: '' }, // OWNER-AR · EN: "Respect for the honesty — most don't dare. My advice as a recruiter: solidify your basics to B1, then come back and I take you on. The door stays open for you."
  gate_denied_browse: { de: 'Trotzdem umsehen', ar: '' }, // OWNER-AR · EN: "Look around anyway" (quiet link)
  // {level} ← assessment result.estimatedLevel (A1/A2 branch only)
  verdict_below_b1: { de: 'Ehrliches Wort von deiner Recruiterin: Dein Screening zeigt {level}. Diese Arena ist für B1 aufwärts gebaut — du kannst trotzdem trainieren, aber der schnellste Weg ist: erst die Grundlagen festigen, dann zu mir zurückkommen.', ar: '' }, // OWNER-AR · EN: "Honest word from your recruiter: your screening shows {level}. This arena is built for B1 and up — you can still train, but the fastest path is: solidify the basics first, then come back to me."

  // ── debrief · the correction ritual (Sultan doctrine 07-12: spoken errors die by spoken
  //    correction — she models the verified fix, the candidate says it back ALOUD) ───────────
  ritual_prompt: { de: 'Einmal noch — und diesmal richtig. Hör zu und sprich mir laut nach:', ar: '' }, // OWNER-AR · EN: "One more time — and this time correctly. Listen and repeat after me, out loud:"
  ritual_replay: { de: 'Nochmal hören', ar: '' }, // OWNER-AR · EN: "Hear it again" (button)
  ritual_said: { de: 'Laut gesagt', ar: '' }, // OWNER-AR · EN: "Said it out loud" (button)
  ritual_done_note: { de: 'Notiert. Morgen bringe ich genau diesen Fehler in dein Training — bis er sitzt.', ar: '' }, // OWNER-AR · EN: "Noted. Tomorrow I bring exactly this mistake into your training — until it sticks."

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
