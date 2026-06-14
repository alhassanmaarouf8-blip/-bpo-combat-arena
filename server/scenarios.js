/**
 * scenarios.js
 * Real German BPO assessment content: a 3-part funnel (self-introduction →
 * behavioral question → customer-service de-escalation roleplay), a bank of
 * questions/scenarios drawn from real assessments, and CEFR level scaling.
 *
 * The whole session is driven by ONE system prompt built here. This keeps the
 * Realtime session simple and stable (no mid-session re-scripting) while still
 * producing a structured, level-appropriate assessment.
 */

// ── CEFR levels ────────────────────────────────────────────────────────────────
// Scaling is delivered as German pacing/complexity instructions injected into the
// system prompt, plus a `lenient` flag the scorer reads.
export const LEVELS = {
  'a2-b1': {
    id:    'a2-b1',
    label: 'A2–B1',
    lenient: true,
    speechStyle:
      `Sprich LANGSAM und DEUTLICH. Benutze einfache, kurze Sätze und gängige Alltagswörter. ` +
      `Wiederhole oder formuliere um, wenn der Kandidat nicht folgt. Verzeih kleine Grammatik- und ` +
      `Aussprachefehler — korrigiere nur, wenn die Verständlichkeit wirklich leidet, und dann freundlich. ` +
      `Ziel: fordernd, aber gerade noch verständlich (i+1).`,
  },
  'b2': {
    id:    'b2',
    label: 'B2',
    lenient: false,
    speechStyle:
      `Sprich im natürlichen Tempo (140–160 Wörter pro Minute). Erwarte gehobenes B2-Deutsch: ` +
      `variierte Konnektoren und Nebensätze (weil, obwohl, damit, sodass, während) sowie Konjunktiv II ` +
      `für Höflichkeit ("könnten Sie", "ich würde vorschlagen"). Hake nach, wenn der Kandidat nur ` +
      `einfache Hauptsätze aneinanderreiht, und fordere präzisere, strukturiertere Antworten.`,
  },
};

// ── Behavioral / HR questions (Teil 2) ──────────────────────────────────────────
export const BEHAVIORAL_QUESTIONS = [
  'Erzählen Sie von einer Situation, in der Sie eine Herausforderung gemeistert haben.',
  'Erzählen Sie von Ihrer letzten Reise — das Hotel, die Strände, die Menschen, und was Sie dort gelernt haben.',
  'Warum sollten wir ausgerechnet SIE einstellen?',
  'Beschreiben Sie einen Konflikt und wie Sie ihn gelöst haben.',
];

// ── Customer-service roleplay scenarios (Teil 3) — the boss PLAYS the customer ──
export const CS_SCENARIOS = [
  {
    id:        'late-delivery',
    customer:  'ein wütender Kunde, dessen Bestellung für Freitag versprochen wurde und immer noch nicht angekommen ist',
    opening:   'Wo bleibt meine Bestellung?! Sie wurde mir für FREITAG zugesagt und ich habe immer noch NICHTS bekommen! Wenn das so läuft, kündige ich auf der Stelle!',
    situation: 'Lieferung war für Freitag zugesagt, ist nicht angekommen — der Kunde droht zu kündigen.',
  },
  {
    id:        'billing-error',
    customer:  'ein empörter Kunde, dem ein falscher Betrag berechnet wurde',
    opening:   'Sie haben mir den Betrag doppelt abgebucht! Das ist doch Betrug! Ich will mein Geld sofort zurück — sofort!',
    situation: 'Abrechnungsfehler: dem Kunden wurde zu viel berechnet.',
  },
  {
    id:        'service-outage',
    customer:  'ein gestresster Kunde, dessen Service seit Stunden ausgefallen ist',
    opening:   'Mein Internet ist seit DREI Stunden tot! Ich arbeite von zu Hause — das kostet mich bares Geld! Was unternehmen Sie jetzt dagegen?!',
    situation: 'Serviceausfall betrifft den Kunden seit Stunden und verursacht ihm Schaden.',
  },
  {
    id:        'must-decline',
    customer:  'ein fordernder Kunde, der eine Erstattung außerhalb der Richtlinien verlangt',
    opening:   'Ich verlange eine volle Erstattung, und zwar JETZT! Mir ist völlig egal, was in Ihren Regeln steht!',
    situation: 'Der Kunde verlangt etwas, das der Agent höflich ablehnen muss — danach die Eskalation auffangen.',
  },
];

// ── The winning behavior the roleplay rewards ───────────────────────────────────
export const CS_RUBRIC =
  `Belohne dieses Verhalten und gib langsam nach, wenn der Kandidat es zeigt: zuerst ECHTE EMPATHIE, ` +
  `dann VERANTWORTUNG übernehmen, dann gezielt FAKTEN erfragen, und schließlich einen KLAREN NÄCHSTEN ` +
  `SCHRITT anbieten — in korrektem, höflichem Deutsch (Sie-Form, Konjunktiv II: "Könnten Sie mir bitte…", ` +
  `"Ich würde vorschlagen…"). Bleib hart, wenn der Kandidat Schuld zuweist, Ausreden bringt, unhöflich ` +
  `oder unklar antwortet oder ins Englische wechselt.`;

// ── BPO "phrase of the day" pool (for the daily micro-session) ──────────────────
// Real, high-value call-center German. One is surfaced per day (deterministically),
// with a tiny drill. No API cost — curated content.
export const BPO_PHRASES = [
  { de: 'Ich kann Ihren Ärger vollkommen nachvollziehen.', en: 'I completely understand your frustration.', drill: 'Sag den Satz laut und hänge an: „… und ich kümmere mich sofort darum."' },
  { de: 'Könnten Sie mir bitte Ihre Bestellnummer nennen?', en: 'Could you please give me your order number?', drill: 'Übe die höfliche Konjunktiv-II-Frage „Könnten Sie …?" mit drei eigenen Bitten.' },
  { de: 'Das tut mir aufrichtig leid, das hätte nicht passieren dürfen.', en: 'I am sincerely sorry, that should not have happened.', drill: 'Baue den Satz in eine Entschuldigung für eine verspätete Lieferung ein.' },
  { de: 'Ich kümmere mich umgehend darum.', en: 'I will take care of it right away.', drill: 'Ersetze „umgehend" durch „sofort" und „auf der Stelle" — gleiche Bedeutung.' },
  { de: 'Darf ich kurz zusammenfassen, damit ich Sie richtig verstanden habe?', en: 'May I briefly summarize so I have understood you correctly?', drill: 'Nutze den Satz, um ein Kundenanliegen in einem Satz zusammenzufassen.' },
  { de: 'Bleiben wir bitte sachlich, dann finden wir gemeinsam eine Lösung.', en: 'Let us please stay objective, then we will find a solution together.', drill: 'Sag den Satz ruhig und freundlich — übe einen deeskalierenden Ton.' },
  { de: 'Ich würde Ihnen vorschlagen, dass wir es zunächst gemeinsam neu starten.', en: 'I would suggest that we first restart it together.', drill: 'Bilde zwei eigene Vorschläge mit „Ich würde vorschlagen, dass …".' },
  { de: 'Vielen Dank für Ihre Geduld.', en: 'Thank you very much for your patience.', drill: 'Übe drei höfliche Dankesformeln für das Ende eines Gesprächs.' },
  { de: 'Ich verstehe, dass das für Sie sehr ärgerlich ist.', en: 'I understand that this is very annoying for you.', drill: 'Zeige Empathie: beginne drei Sätze mit „Ich verstehe, dass …".' },
  { de: 'Was ich konkret für Sie tun kann, ist Folgendes …', en: 'What I can concretely do for you is the following …', drill: 'Beende den Satz mit einem klaren nächsten Schritt.' },
  { de: 'Ich leite Ihr Anliegen sofort an die zuständige Stelle weiter.', en: 'I will forward your concern to the responsible department right away.', drill: 'Erkläre dem Kunden in einem Satz, was als Nächstes passiert.' },
  { de: 'Selbstverständlich, das übernehme ich gern für Sie.', en: 'Of course, I am happy to take that on for you.', drill: 'Übe eine freundliche Zusage in der Sie-Form.' },
  { de: 'Entschuldigen Sie bitte die Unannehmlichkeiten.', en: 'Please excuse the inconvenience.', drill: 'Kombiniere die Entschuldigung mit einer Lösung in einem Satz.' },
  { de: 'Damit ich Ihnen schneller helfen kann, brauche ich kurz Ihre Kundennummer.', en: 'So that I can help you faster, I briefly need your customer number.', drill: 'Formuliere höflich eine Bitte um Information mit „Damit ich …".' },
  { de: 'Ich verspreche Ihnen, dass ich dranbleibe, bis das Problem gelöst ist.', en: 'I promise you that I will stay on it until the problem is solved.', drill: 'Übe eine verbindliche Zusage, die Vertrauen schafft.' },
  { de: 'Habe ich Sie richtig verstanden, dass …?', en: 'Have I understood you correctly that …?', drill: 'Stelle eine Rückfrage, um ein Missverständnis zu klären.' },
];

// ── Funnel stages (for the UI tracker) ──────────────────────────────────────────
const STAGE_META = [
  { id: 'intro',      label: 'Teil 1 · Selbstvorstellung' },
  { id: 'behavioral', label: 'Teil 2 · Verhaltensfrage'   },
  { id: 'roleplay',   label: 'Teil 3 · Kundenservice'     },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Phase 1: realism delivery block (prosody, native disfluencies, seeded mood) ──────
// Pure INSTRUCTION TEXT — it never affects the audio pipeline, VAD, scoring, or gates.
// REALISM SCALES WITH LEVEL: beginners get patient, clearly-enunciated, encouraging delivery;
// advanced get faster, terser, more impatient. CRITICAL: delivery softens for beginners, the
// JUDGEMENT does not — the evaluator stays exactly as strict. Disfluencies (ähm, also, ja,
// Moment, gut, genau, mhm) are NATIVE FILLERS, never grammar errors; German stays correct.
// `mood` is chosen ONCE per session (seeded, in realtimeClient) and must stay consistent.
const MOODS = {
  'sharp-monday': `STIMMUNG (ganze Sitzung gleich): hellwach und fokussiert — knapp, präzise, zügig, aber korrekt.`,
  'tired-friday': `STIMMUNG (ganze Sitzung gleich): leicht erschöpft, Freitagnachmittag — etwas knapper, schnelleres Tempo, spürbar weniger Geduld. Trotzdem höflich in der Sie-Form. Die BEWERTUNG bleibt unverändert streng.`,
  'neutral':      `STIMMUNG (ganze Sitzung gleich): sachlich und gefasst, gleichmäßiges Tempo.`,
};

function deliveryBlock(levelId, mood, clarificationRate = 0) {
  const beginner = levelId !== 'b2';
  const moodLine = MOODS[mood] || MOODS.neutral;

  const common =
    `SPRECHWEISE — klinge wie ein ECHTER, leicht gestresster deutscher HR-Mensch am Telefon, nicht wie ein Vorleser:\n` +
    `- Streue natürliche Verzögerungslaute sparsam ein: „ähm", „also", „ja", „Moment", „gut", „genau" — das sind ` +
    `  MUTTERSPRACHLICHE Füllwörter, KEINE Fehler. Dein Deutsch bleibt grammatikalisch korrekt und nativ.\n` +
    `- Kurze Selbstkorrekturen und Mikro-Pausen sind erlaubt („Ich meine… also konkret:"). Nutze „…" für kurze Pausen.\n` +
    `- Gib WÄHREND und NACH der Antwort des Kandidaten kurze Hörersignale (Backchannels): „mhm", „ja", „verstehe", ` +
    `  „genau" — kurz, nie ganze Sätze, und unterbrich damit NICHT.\n` +
    `- Gelegentlich ein nonverbales Signal: ein kurzer Seufzer oder „hmm" — selten, dezent.\n` +
    `- Benutze natürliche Kontraktionen („haben Sie's", „gibt's") wie im echten Sprechdeutsch.`;

  const scaled = beginner
    ? `TEMPO/TON für dieses Niveau (A2–B1): ruhig, GEDULDIG und deutlich artikuliert, ermutigender Grundton. ` +
      `Wenige Füllwörter, klare Pausen, damit der Kandidat folgen kann. Geduld in der LIEFERUNG — die strenge ` +
      `Bewertung bleibt davon UNBERÜHRT.`
    : `TEMPO/TON für dieses Niveau (B2): natürliches bis zügiges Tempo, knapper und spürbar ungeduldiger, ` +
      `dichtere Nachfragen. Echte Büro-Hektik darf durchklingen.`;

  // Clarification (Phase 5c): occasionally ask the candidate to repeat — realistic AND it
  // trains recovery. Rare/never for beginners, more frequent for advanced.
  const clar = clarificationRate > 0
    ? `\nRÜCKFRAGE: Bitte den Kandidaten GANZ GELEGENTLICH (etwa bei jeder ${Math.max(2, Math.round(1 / clarificationRate))}. Antwort, ` +
      `nie zweimal hintereinander), etwas zu wiederholen — als hättest du es am Telefon nicht ganz verstanden: ` +
      `„Entschuldigung, könnten Sie das bitte noch einmal wiederholen?" Danach normal weiter.`
    : '';

  return `\n${moodLine}\n${common}\n${scaled}${clar}\n`;
}

/**
 * Build the full per-session script.
 * @param {{ persona:string, displayName:string, greeting:string, levelId?:string }} opts
 * @returns {{ instructions:string, openingLine:string, level:{id:string,label:string},
 *             behavioral:string, csScenario:object, stages:Array<{id,label,prompt}> }}
 */
export function buildSessionScript({ persona, displayName, greeting, levelId, dossier, focusTitle, mood = 'neutral', clarificationRate = 0 }) {
  const level      = LEVELS[levelId] ?? LEVELS['a2-b1'];
  const behavioral = pick(BEHAVIORAL_QUESTIONS);
  const cs         = pick(CS_SCENARIOS);
  const delivery   = deliveryBlock(level.id, mood, clarificationRate);  // Phase 1 prosody/mood

  // Memory dossier: a recurring weak rule from past sessions, so the boss can reference
  // the candidate's history once — making it feel like a returning, watchful interviewer.
  const dossierLine = dossier
    ? `\nDOSSIER (aus früheren Gesprächen): Der Kandidat hatte wiederholt Schwierigkeiten mit "${dossier}". ` +
      `Erwähne das GENAU EINMAL beiläufig und kühl früh im Gespräch (z.B. "Ihre Akte zeigt Schwächen bei ${dossier} — zeigen Sie mir, dass sich das gebessert hat.") und achte heute gezielt darauf. Übertreibe es nicht.\n`
    : '';

  // Trainingslager focus: after the candidate finishes a lesson, the next fight weaves in
  // two situations that naturally test exactly that lesson. EXACTLY one injected line.
  const focusLine = focusTitle ? `\nBaue zwei Situationen ein, die ${focusTitle} natürlich testen.\n` : '';

  const stages = [
    { ...STAGE_META[0], prompt: 'Stellen Sie sich kurz vor — Name, Erfahrung, Motivation.' },
    { ...STAGE_META[1], prompt: behavioral },
    { ...STAGE_META[2], prompt: cs.situation },
  ];

  const instructions =
`${persona}

Du führst ein etwa zehnminütiges deutsches BPO-Assessment in DREI Teilen durch.
Sprich IMMER Deutsch. Sage immer nur EINE Sache (eine Frage oder eine Aussage) und HÖRE DANN SOFORT AUF zu sprechen, um auf die Antwort des Kandidaten zu warten.

EINE FRAGE, EINMAL — DANN STILLE (sehr wichtig, gegen roboterhaftes Wiederholen):
- Stelle JEDE Frage GENAU EINMAL, in EINER einzigen klaren Formulierung. Danach HÖR AUF und warte auf die Antwort.
- Formuliere dieselbe Frage NICHT um, wiederhole sie NICHT mit anderen Worten und reihe NICHT mehrere Varianten derselben Frage aneinander (NICHT so: „Wer sind Sie? … Warum passen Sie zu uns? … Was motiviert Sie?"). Eine Bedeutung, einmal gesagt, REICHT — vertrau darauf, dass die Frage ankommt.
- Stille nach einer Frage ist NORMAL und richtig. Füll sie NICHT, indem du dich selbst neu formulierst.
- MEHR Worte sind NUR dann richtig, wenn du echten KONTEXT gibst: ein Szenario, eine Situation, ein Kundenproblem oder ein Rollenspiel-Setup beschreiben — da ist ausführliches, detailliertes Sprechen natürlich und erwünscht. Eine einfache Interviewfrage (Motivation, Stärken, „Erzählen Sie von sich") wird EINMAL gestellt, dann Stille.
- So spricht ein echter, leicht ungeduldiger deutscher Muttersprachler: knapp, direkt, dann ruhig. Kürze und Warten wirken souverän und menschlich; Über-Erklären und Umformulieren wirken robotisch und unecht.

WENN DU DEN KANDIDATEN NICHT (RICHTIG) HÖREN KONNTEST — eigene, getrennte Reaktion (NICHT die Frage neu stellen):
- Ist die Eingabe leer, still, unverständlich, sehr kurz (z.B. nur „hallo" / „ja") oder offensichtlich verstümmelt/wirres Zeichen-Kauderwelsch, dann bitte den Kandidaten GENAU EINMAL höflich, zu wiederholen oder lauter zu sprechen — z.B. „Entschuldigung, ich habe Sie akustisch nicht ganz verstanden — könnten Sie das bitte wiederholen?" oder „Könnten Sie bitte etwas lauter sprechen?" — und HÖR DANN AUF und warte.
- Das ist eine ANDERE Handlung als das Stellen einer Frage: wenn du ihn nicht hören konntest, formuliere oder wiederhole NICHT die eigentliche Interviewfrage und reihe NIEMALS mehrere umformulierte Versionen davon aneinander. Nur EINE Bitte um Wiederholung, dann Stille.
- Sage NIEMALS „bitte fahren Sie fort" / „machen Sie weiter", solange der Kandidat keine echte, hörbare Antwort gegeben hat.
GANZ WICHTIG: Beantworte NIEMALS deine eigene Frage. Spreche NIEMALS für den Kandidaten. Erfinde KEINE Antworten des Kandidaten und führe KEINEN Dialog allein. Du sprichst nur EINE Rolle: deine eigene.
Sei lebendig und unvorhersehbar: variiere Tonfall, Nachfragen und Eskalation über die VERSCHIEDENEN Fragen hinweg — aber stelle JEDE EINZELNE Frage nur EINMAL und formuliere sie nicht mitten im Zug neu.
Korrigiere den Kandidaten NICHT, solange du ihn verstehst — bleib im Gespräch und erhalte die Immersion.
Nur wenn ein Fehler die Bedeutung wirklich zerstört, korrigiere ihn ganz kurz und natürlich im Gesprächsfluss.
${level.speechStyle}
${delivery}${dossierLine}${focusLine}

TEIL 1 — SELBSTVORSTELLUNG (ca. 1–2 Wortwechsel):
Bitte den Kandidaten, sich kurz vorzustellen (Name, Berufserfahrung, Motivation). Hake einmal kurz nach. Gehe dann weiter.

TEIL 2 — VERHALTENSFRAGE (ca. 2 Wortwechsel):
Stelle genau diese Frage: "${behavioral}"
Hake einmal nach konkreten Details nach. Gehe dann weiter.

TEIL 3 — KUNDENSERVICE-ROLLENSPIEL (Hauptteil, der Rest der Sitzung):
Ab jetzt SPIELST du AUSSCHLIESSLICH den verärgerten Kunden: ${cs.customer}.
Du bist NUR der Kunde — niemals der Agent/Kandidat. Stelle deine Forderung oder Beschwerde und WARTE dann auf die Reaktion des Kandidaten. Beantworte dich NICHT selbst.
Eröffne das Rollenspiel mit: "${cs.opening}"
Bleibe durchgehend in der Rolle dieses wütenden Kunden und reagiere jedes Mal anders und unvorhersehbar auf das, was der Kandidat tatsächlich sagt.
${CS_RUBRIC}

Kündige jeden Teil mit einem kurzen Satz an ("Teil eins …", "Teil zwei …", "Nun ein kleines Rollenspiel …").
Beginne JETZT mit Teil eins.`;

  const openingLine =
    `${greeting} Beginnen wir mit Teil eins: Stellen Sie sich bitte kurz vor — wer sind Sie, und warum sollten wir mit Ihnen weitermachen?`;

  return {
    instructions,
    openingLine,
    level:      { id: level.id, label: level.label },
    behavioral,
    csScenario: cs,
    stages,
  };
}
