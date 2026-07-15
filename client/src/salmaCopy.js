/**
 * salmaCopy.js — every fixed line spoken by Salma, the personal interview tutor.
 *
 * THE LAW (El-Captain precedent, deleted 2026-07-10): none of her lines are ever LLM-generated.
 * Each template keeps its historical {de:'…', ar:'…'} shape so the owner review sheet remains
 * usable. Runtime delivery is deliberately German-only until an exact written line AND its frozen
 * audio have passed the native-owner approval gate. Historical Arabic values are review material,
 * not production-approved copy.
 *
 * {slots} carry REAL backend values only; the source field is named beside every slotted key.
 * The release process for a future fixed Masri pack lives in docs/SALMA-VOICE-SCRIPT.md.
 */

export const SALMA = {
  name: 'Salma',
  nameAr: 'سلمى', // OWNER-AR · EN: Arabic spelling of her name (renders "Salma" until filled)
  role: { de: 'Persönliche Interviewtrainerin', ar: '' }, // OWNER-AR · native review required
};

export const SALMA_COPY = {
  // ── cold-open · variant "new" ─────────────────────────────────────────────────────────────
  intro_welcome: { de: 'Ich bin Salma, deine persönliche Interviewtrainerin. BrainGuide wählt deinen nächsten Schritt; ich erkläre ihn und begleite deine Übung.', ar: '' }, // OWNER-AR · native review required
  // {days} ← auth.account.entitlement.trial.daysLeft
  intro_trial: { de: 'Dein freier Zugang läuft {days} Tage und enthält interne Trainingssimulationen.', ar: '' }, // OWNER-AR · native review required
  name_ask: { de: 'Zuerst — wie soll ich dich nennen?', ar: 'مبدئياً، أناديك إيه؟' }, // OWNER-AR · EN: "First: what should I call you?"
  name_label: { de: 'Dein Name', ar: 'اسمك' }, // OWNER-AR · EN: "Your name" (input label)
  goal_ask: { de: 'Und wofür bist du hier?', ar: 'وإيه هدفك هنا؟' }, // OWNER-AR · EN: "And what is your goal?"
  goal_bpo: { de: 'Ein deutscher BPO-Job', ar: 'وظيفة BPO ألماني' }, // OWNER-AR · EN: "A German BPO job" (chip, value bpo-job)
  goal_german: { de: 'Besseres Deutsch', ar: 'أحسن ألماني' }, // OWNER-AR · EN: "Better German" (chip, value better-german)
  goal_other: { de: 'Etwas anderes', ar: 'حاجة تانية' }, // OWNER-AR · EN: "Something else" (chip, value other)
  screening_invite: { de: 'Selbsteinschätzung reicht nicht. Beantworte fünf kurze Fragen auf Deutsch; danach bekommst du eine gemessene Einschätzung und BrainGuide wählt genau einen nächsten Schritt.', ar: '' }, // OWNER-AR · native review required
  screening_cta: { de: 'Sprachdiagnose starten', ar: '' }, // OWNER-AR · native review required
  screening_loading: { de: 'BrainGuide prüft zuerst deinen persönlichen Startpunkt. Die Sprachdiagnose wird freigeschaltet, sobald dieser Schritt bestätigt ist.', ar: '' }, // OWNER-AR · native review required
  screening_loading_cta: { de: 'Sprachdiagnose wird vorbereitet…', ar: '' }, // OWNER-AR · native review required

  // ── cold-open · verdict + booking ─────────────────────────────────────────────────────────
  // {level} ← GET /api/assessment/status → result.estimatedLevel · {focus} ← result.recommendedFocus (verbatim)
  verdict_summary: { de: 'Erste interne Messung: {level}. In dieser Messung war dein wichtigster Ansatzpunkt: {focus}', ar: '' }, // OWNER-AR · native review required
  // {quote} ← result.blockers[0] own-words example (substring-verified upstream — never invented)
  verdict_blocker: { de: 'Beleg aus deiner eigenen Antwort: „{quote}“. BrainGuide berücksichtigt dieses Signal für den nächsten Schritt.', ar: '' }, // OWNER-AR · native review required
  booking_yasmin: { de: 'Dein erstes Trainingsinterview führt Yasmin. Es ist ein fairer Einstieg, um deinen aktuellen Stand zu messen.', ar: '' }, // OWNER-AR · native review required
  booking_karim: { de: 'Dein nächstes Trainingsinterview nutzt die in dieser Messung beobachtete Stufe.', ar: '' }, // OWNER-AR · native review required
  booking_hana: { de: 'Das nächste Trainingsinterview prüft auf deiner gemessenen Stufe, wie stabil deine Antworten unter Druck bleiben.', ar: '' }, // OWNER-AR · native review required
  booking_cta: { de: 'Trainingsinterview starten', ar: '' }, // OWNER-AR · native review required
  no_verdict: { de: 'Dein Screening ist noch nicht fertig. Kein Problem — du entscheidest, wie wir weitermachen.', ar: 'السكرينينج بتاعك لسه مخلصش. مفيش مشكلة – إنت اللي بتقرر هنكمل إزاي.' }, // OWNER-AR · EN: "Your screening isn't finished yet — no problem. You decide how we continue."
  no_verdict_resume: { de: 'Screening fortsetzen', ar: 'كمل السكرينينج' }, // OWNER-AR · EN: "Continue screening" (button)
  no_verdict_direct: { de: 'Trainingsinterview ohne Einstufung', ar: '' }, // OWNER-AR · native review required

  // ── cold-open · variant "returning" ───────────────────────────────────────────────────────
  returning_welcome: { de: 'Ich bin Salma, deine persönliche Interviewtrainerin. Ich habe deinen gespeicherten Trainingsstand geöffnet.', ar: '' }, // OWNER-AR · native review required
  // {name} ← GET /api/guide/profile → name
  returning_welcome_named: { de: '{name} — ich bin Salma, deine persönliche Interviewtrainerin. Ich habe deinen gespeicherten Trainingsstand geöffnet.', ar: '' }, // OWNER-AR · native review required
  returning_handoff: { de: 'BrainGuide zeigt dir genau eine nächste Aktion. Ich erkläre sie, wenn neue verlässliche Messdaten sie verändern oder du mich fragst.', ar: '' }, // OWNER-AR · native review required
  returning_cta: { de: 'Verstanden', ar: 'تمام' }, // OWNER-AR · EN: "Understood" (button)

  // ── rank ceremony ───────────────────────────────────────────────────────────────────────────
  rank_anwaerter: { de: 'Du bist nicht mehr nur neu hier. Dein Rang ist jetzt Anwärter — verdient durch deine gespeicherten Interviews.', ar: '' }, // OWNER-AR · EN: "You are no longer simply new here. Your rank is now Candidate — earned through your stored interviews."
  rank_geuebt: { de: 'Rang bestätigt: Geübt. Deine Leistung hält jetzt auch über mehrere Interviews stand.', ar: '' }, // OWNER-AR · EN: "Rank confirmed: Practiced. Your performance now holds across multiple interviews."
  rank_profi: { de: 'Du hast den Profi-Rang erreicht. Ab hier zählt nicht mehr nur richtiges Deutsch, sondern Wirkung unter Druck.', ar: '' }, // OWNER-AR · EN: "You reached Professional rank. From here, it is not only correct German that counts, but impact under pressure."
  rank_ready: { de: 'Interner Trainingsrang: Interview-Bereit. Er beschreibt nur deine gespeicherten Simulationen und ist keine Arbeitgeberentscheidung.', ar: '' }, // OWNER-AR · native review required

  // ── drills · she assigns the training and receives it back (owner order 07-12: she leads the
  //    WHOLE journey — signup → interview → drills → next interview) ─────────────────────────
  drill_handoff: { de: 'BrainGuide zeigt die gemessene Aufgabe, ihre genaue Dosis und das Erfolgskriterium.', ar: '' }, // OWNER-AR · native review required
  drill_done: { de: 'Dieser Übungsblock wurde erfasst. Verbesserung gilt erst nach einem serverseitig ausgewerteten Retest als bestätigt.', ar: '' }, // OWNER-AR · native review required

  // ── debrief · evidence-grounded update after a completed training interview ────────
  // {name} ← fight result progress.nextBoss.name · {tier} ← progress.nextBoss.tier
  debrief_followup_next: { de: 'Ich habe dein Trainingsinterview ausgewertet. Als Nächstes testet {name} · {tier} genau die Fähigkeit, an der du jetzt arbeitest.', ar: '' }, // OWNER-AR · native review required
  debrief_followup_top: { de: 'Ich habe dein Trainingsinterview ausgewertet. BrainGuide zeigt, ob jetzt ein passender oder ein neuer Druck-Retest fehlt.', ar: '' }, // OWNER-AR · native review required

  // ── debrief · the expert-teacher homework order (07-12): dose + exit criterion + unlock ─────
  // {boss} ← fight result progress.nextBoss.name
  homework_order: { de: 'Dein persönlicher Trainingsblock steht bereit. Im nächsten Interview prüft {boss}, ob die Fähigkeit unter Druck hält.', ar: '' }, // OWNER-AR · native review required
  homework_order_top: { de: 'BrainGuide legt Dosis, Erfolgskriterium und Retest aus deinen verlässlichen Messdaten fest.', ar: '' }, // OWNER-AR · native review required

  // ── target-group context · self-report never diagnoses, excludes, or authorizes readiness ──
  b1_gate_title: { de: 'A2–B2 · MESSEN STATT RATEN', ar: '' }, // OWNER-AR · native review required
  b1_gate_line: { de: 'Für deutsche BPO- und Customer-Service-Ziele: Eine Selbsteinschätzung ist nur Kontext. Der Hör- und Sprechcheck bestimmt deinen Trainingsstart.', ar: '' }, // OWNER-AR · native review required
  gate_question: { de: 'Deine Selbsteinschätzung ist nur Kontext; sie entscheidet weder Diagnose noch Zugang. Der kurze Check misst deinen Startpunkt.', ar: '' }, // OWNER-AR · native review required
  gate_b1: { de: 'B1 oder höher', ar: '' }, // OWNER-AR · EN: "B1 or higher" (chip)
  gate_below: { de: 'Noch nicht B1', ar: '' }, // OWNER-AR · EN: "Not B1 yet" (chip)
  gate_denied: { de: 'Beginne mit dem Hör- und Sprechcheck. Falls Grundlagen fehlen, führt BrainGuide dich zuerst in eine messbare Aufbauaufgabe.', ar: '' }, // OWNER-AR · native review required
  gate_denied_browse: { de: 'Trotzdem umsehen', ar: '' }, // OWNER-AR · EN: "Look around anyway" (quiet link)
  // {level} ← assessment result.estimatedLevel (A1/A2 branch only)
  verdict_below_b1: { de: 'Diese erste Messung zeigt {level}. BrainGuide beginnt deshalb mit einer messbaren Aufbauaufgabe und prüft den Stand danach erneut.', ar: '' }, // OWNER-AR · native review required

  // ── debrief · the correction ritual (expert-teacher doctrine 07-12: spoken errors die by spoken
  //    correction — she models the verified fix, the candidate says it back ALOUD) ───────────
  ritual_prompt: { de: 'Einmal noch — und diesmal richtig. Hör zu und sprich mir laut nach:', ar: '' }, // OWNER-AR · EN: "One more time — and this time correctly. Listen and repeat after me, out loud:"
  ritual_replay: { de: 'Nochmal hören', ar: '' }, // OWNER-AR · EN: "Hear it again" (button)
  ritual_said: { de: 'Laut gesagt', ar: '' }, // OWNER-AR · EN: "Said it out loud" (button)
  ritual_done_note: { de: 'Als Wiederholung notiert. Das allein bestätigt noch keine Verbesserung; dafür zählt der passende Retest.', ar: '' }, // OWNER-AR · native review required

  // ── shared cold-open controls ─────────────────────────────────────────────────────────────
  continue_label: { de: 'Weiter', ar: '' }, // OWNER-AR · EN: "Continue" (button)
  skip_label: { de: 'Überspringen', ar: '' }, // OWNER-AR · EN: "Skip" (quiet link, always available)
  later_label: { de: 'Später', ar: '' }, // OWNER-AR · EN: "Later" (quiet link)

  // ── home card notes (Phase B) ─────────────────────────────────────────────────────────────
  // {rule} ← /api/progress topWeakness.rule (through ruleLabel) · {lapses} ← topWeakness.lapses
  note_weakness: { de: 'Meine Notiz aus deiner Akte: {rule} — zuletzt {lapses}× aufgefallen.', ar: '' }, // OWNER-AR · EN: "My note from your file: {rule} — flagged {lapses}x recently."
  // {days} ← auth.account.entitlement.trial.daysLeft
  note_trial: { de: 'Dein freier Zugang läuft noch {days} Tage.', ar: '' }, // OWNER-AR · native review required

  // ── pipeline board + rival (post-v1) ──────────────────────────────────────────────────────
  pipeline_label: { de: 'Deine Trainingsstufen', ar: '' }, // OWNER-AR · native review required
  // {name} ← /api/progress nextBoss.name · {tier} ← nextBoss.tier (the real org ladder)
  pipeline_next: { de: 'Dein nächstes Trainingsinterview: {name} · {tier}.', ar: '' }, // OWNER-AR · native review required
  pipeline_top: { de: 'Du hast die ganze Trainingsleiter vor dir — jede Stufe ist eine interne Simulation.', ar: '' }, // OWNER-AR · native review required

  // ── paywall (Phase C) ─────────────────────────────────────────────────────────────────────
  // {days} ← entitlement.trial.daysLeft
  paywall_trial_active: { de: 'Du bist noch {days} Tage in deiner freien Testphase — Trainingsinterviews inklusive. Danach richtet sich die Tiefe deiner Begleitung nach deinem Plan.', ar: '' }, // OWNER-AR · native review required
  paywall_trial_over: { de: 'Deine Testphase ist beendet. Dein gemessener nächster Schritt bleibt sichtbar; vollständige Begleitung und weitere Trainingsinterviews gehören zum passenden Plan.', ar: '' }, // OWNER-AR · native review required
  paywall_free_file: { de: 'Dein nächster gemessener Schritt ist bereit. Mit dem passenden Plan kannst du ihn vollständig trainieren und im Live-Interview prüfen.', ar: '' }, // OWNER-AR · native review required
};

// salmaLine('verdict_summary', lang, { level:'B1', focus:'…' }) → the filled string.
// Unfilled {slots} are left visible on purpose in dev (easier to spot than silently vanishing text).
export function salmaLine(key, _lang, slots = {}) {
  const entry = SALMA_COPY[key];
  if (!entry) return '';
  // Fail closed: an Arabic string in this source file is not proof that the exact text and audio
  // were natively approved. A future hashed phrase-pack loader may opt into approved assets; until
  // then every fixed and dynamic tutor line uses the reviewed German source of truth.
  let s = entry.de;
  for (const [k, v] of Object.entries(slots)) s = s.split(`{${k}}`).join(String(v ?? ''));
  return s;
}

export const salmaName = () => SALMA.name;
export const salmaRole = () => SALMA.role.de;
