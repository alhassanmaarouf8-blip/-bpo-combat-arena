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

// ── Funnel stages (for the UI tracker) ──────────────────────────────────────────
const STAGE_META = [
  { id: 'intro',      label: 'Teil 1 · Selbstvorstellung' },
  { id: 'behavioral', label: 'Teil 2 · Verhaltensfrage'   },
  { id: 'roleplay',   label: 'Teil 3 · Kundenservice'     },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build the full per-session script.
 * @param {{ persona:string, displayName:string, greeting:string, levelId?:string }} opts
 * @returns {{ instructions:string, openingLine:string, level:{id:string,label:string},
 *             behavioral:string, csScenario:object, stages:Array<{id,label,prompt}> }}
 */
export function buildSessionScript({ persona, displayName, greeting, levelId }) {
  const level      = LEVELS[levelId] ?? LEVELS['a2-b1'];
  const behavioral = pick(BEHAVIORAL_QUESTIONS);
  const cs         = pick(CS_SCENARIOS);

  const stages = [
    { ...STAGE_META[0], prompt: 'Stellen Sie sich kurz vor — Name, Erfahrung, Motivation.' },
    { ...STAGE_META[1], prompt: behavioral },
    { ...STAGE_META[2], prompt: cs.situation },
  ];

  const instructions =
`${persona}

Du führst ein etwa zehnminütiges deutsches BPO-Assessment in DREI Teilen durch.
Sprich IMMER Deutsch. Sage immer nur EINE Sache (eine Frage oder eine Aussage) und HÖRE DANN SOFORT AUF zu sprechen, um auf die Antwort des Kandidaten zu warten.
GANZ WICHTIG: Beantworte NIEMALS deine eigene Frage. Spreche NIEMALS für den Kandidaten. Erfinde KEINE Antworten des Kandidaten und führe KEINEN Dialog allein. Du sprichst nur EINE Rolle: deine eigene.
Sei lebendig und unvorhersehbar: variiere Tonfall, Formulierungen, Nachfragen und Eskalation. Wiederhole dich nicht — überrasche den Kandidaten.
Korrigiere den Kandidaten NICHT, solange du ihn verstehst — bleib im Gespräch und erhalte die Immersion.
Nur wenn ein Fehler die Bedeutung wirklich zerstört, korrigiere ihn ganz kurz und natürlich im Gesprächsfluss.
${level.speechStyle}

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
