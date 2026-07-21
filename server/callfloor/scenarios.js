/**
 * callfloor/scenarios.js — the seeded scenario bank for the four seats of the German phone floor.
 *
 * Each scenario is ONE call: a customer persona with a problem and an emotional arc. The student
 * is the agent. Expandable — add entries, the engine picks unseen-first per user. Laws honored:
 * no employer/company names anywhere (providers are "Ihr Anbieter"/"wir"), no masri authored
 * (every *_ar field is an empty OWNER-AR slot), German runs through german-check before ship.
 * `unsolvable: true` = the skill being trained is saying no gracefully — the judge scores the
 * graceful no as success, never the impossible yes.
 */

export const QUADRANTS = {
  inbound_cs:     { label_de: 'Inbound Service',   label_ar: '', skill_de: 'Deeskalation & Lösung' },
  inbound_sales:  { label_de: 'Inbound Sales',     label_ar: '', skill_de: 'Bedarf & Abschluss' },
  outbound_cs:    { label_de: 'Outbound Service',  label_ar: '', skill_de: 'Anruf eröffnen & Ziel landen' },
  outbound_sales: { label_de: 'Outbound Sales',    label_ar: '', skill_de: 'Die ersten 10 Sekunden' },
};

// Per-quadrant competency rubric (the post-call judge scores EXACTLY these keys, 1–5, with a
// verbatim quote each; aggregates are computed in code — the model never averages anything).
export const RUBRICS = {
  inbound_cs: [
    { key: 'deeskalation', de: 'Deeskalation: bleibt ruhig, nimmt Ärger raus' },
    { key: 'empathie',     de: 'Empathie: benennt das Gefühl des Kunden' },
    { key: 'struktur',     de: 'Gesprächsstruktur: Begrüßung → Problem erfassen → Lösung → Bestätigung → Abschluss' },
    { key: 'loesung',      de: 'Lösung: bietet einen konkreten, passenden nächsten Schritt' },
    { key: 'effizienz',    de: 'Effizienz: kommt ohne Umwege zum Punkt' },
  ],
  inbound_sales: [
    { key: 'bedarfsanalyse',    de: 'Bedarfsanalyse: stellt Fragen, bevor er/sie anbietet' },
    { key: 'pitch',             de: 'Pitch: verbindet das Angebot mit dem genannten Bedarf' },
    { key: 'einwandbehandlung', de: 'Einwandbehandlung: nimmt den Einwand ernst und antwortet konkret' },
    { key: 'abschluss',         de: 'Abschluss: fragt aktiv nach der Entscheidung' },
  ],
  outbound_cs: [
    { key: 'eroeffnung',   de: 'Eröffnung: stellt sich vor und nennt sofort den Grund des Anrufs' },
    { key: 'respekt_zeit', de: 'Respekt vor der Zeit: fragt, ob es gerade passt, bleibt kompakt' },
    { key: 'ziel',         de: 'Zielerreichung: landet das Anliegen des Anrufs' },
    { key: 'struktur',     de: 'Struktur: klarer rote Faden bis zur Bestätigung' },
  ],
  outbound_sales: [
    { key: 'einstieg',          de: 'Einstieg: die ersten Sätze wecken Interesse statt Abwehr' },
    { key: 'hook',              de: 'Aufhänger: ein konkreter, relevanter Nutzen im ersten Drittel' },
    { key: 'einwandbehandlung', de: 'Einwandbehandlung: bleibt nach dem ersten Nein konstruktiv' },
    { key: 'abschluss',         de: 'Abschluss: schlägt einen klaren nächsten Schritt vor' },
  ],
};

// Aura-2 German voices proven valid in the TTS route (transcribeRouter AURA_DE_VOICES).
const VOICE_M = ['aura-2-julius-de', 'aura-2-fabian-de'];
const VOICE_F = ['aura-2-lara-de', 'aura-2-kara-de', 'aura-2-viktoria-de'];

export const SCENARIOS = [
  // ── INBOUND CS ────────────────────────────────────────────────────────────────────────────
  {
    id: 'ics-rechnung-doppelt', quadrant: 'inbound_cs',
    title_de: 'Doppelt abgebuchte Rechnung', title_ar: '',
    brief_de: 'Ein verärgerter Kunde wurde doppelt belastet. Beruhigen, prüfen, Lösung zusagen.', brief_ar: '',
    customer: { name: 'Herr Brandt', gender: 'm', mood0: 2,
      style_de: 'wütend, laut, unterbricht am Anfang, will sofort sein Geld zurück' },
    problem_de: 'Ihm wurden diesmal 59,98 Euro statt 29,99 Euro abgebucht — der Monatsbetrag wurde doppelt eingezogen.',
    goal_de: 'Der Agent entschuldigt sich glaubwürdig, bestätigt die Doppelbuchung, sagt die Rückerstattung mit klarem Zeitrahmen zu und fasst am Ende zusammen.',
    arc_de: 'Startet wütend. Wird ruhiger, sobald der Agent das Problem ernst nimmt und einen konkreten Schritt nennt. Bleibt wütend, wenn der Agent ausweicht oder Floskeln benutzt.',
    unsolvable: false, voice: VOICE_M[0],
  },
  {
    id: 'ics-internet-ausfall', quadrant: 'inbound_cs',
    title_de: 'Internet seit zwei Tagen tot', title_ar: '',
    brief_de: 'Eine Kundin arbeitet im Homeoffice und hat seit zwei Tagen kein Internet. Struktur rein, Termin raus.', brief_ar: '',
    customer: { name: 'Frau Keller', gender: 'f', mood0: 2,
      style_de: 'gestresst, redet schnell, springt zwischen Details, hat schon zweimal angerufen' },
    problem_de: 'Seit zwei Tagen kein Internet. Sie arbeitet von zu Hause und verliert Aufträge. Beim letzten Anruf wurde ein Rückruf versprochen, der nie kam.',
    goal_de: 'Der Agent entschuldigt sich für den verpassten Rückruf, erfasst die Störung strukturiert und vereinbart einen verbindlichen Techniktermin.',
    arc_de: 'Startet gestresst und misstrauisch wegen des gebrochenen Versprechens. Vertrauen kommt nur über konkrete, überprüfbare Zusagen zurück.',
    unsolvable: false, voice: VOICE_F[1],
  },
  {
    id: 'ics-kuendigung-frist', quadrant: 'inbound_cs',
    title_de: 'Kündigung nach Ablauf der Frist', title_ar: '',
    brief_de: 'Der Kunde will sofort aus dem Jahresvertrag — die Frist ist seit drei Wochen vorbei. Nein sagen, ohne den Kunden zu verlieren.', brief_ar: '',
    customer: { name: 'Herr Yilmaz', gender: 'm', mood0: 3,
      style_de: 'bestimmt, argumentiert viel, versucht Druck mit Anwalt und Bewertungen' },
    problem_de: 'Er will seinen Jahresvertrag sofort kündigen, aber die Kündigungsfrist ist seit drei Wochen abgelaufen — der Vertrag verlängert sich um ein Jahr. Eine sofortige Kündigung ist nicht möglich.',
    goal_de: 'Der Agent bleibt freundlich und klar: die sofortige Kündigung geht nicht. Er erklärt die Rechtslage ruhig, zeigt Verständnis, bietet die fristgerechte Kündigung zum nächsten Termin an und bleibt beim Nein.',
    arc_de: 'Testet den Agenten mit Druck. Respektiert am Ende ein ruhiges, klares, gut erklärtes Nein — verliert Respekt bei falschen Versprechen oder Unsicherheit.',
    unsolvable: true, voice: VOICE_M[1],
  },
  {
    id: 'ics-app-verwirrt', quadrant: 'inbound_cs',
    title_de: 'Ältere Kundin findet nichts in der App', title_ar: '',
    brief_de: 'Eine geduldige, aber verwirrte Kundin braucht Schritt-für-Schritt-Hilfe. Langsam, einfach, freundlich.', brief_ar: '',
    customer: { name: 'Frau Sommer', gender: 'f', mood0: 3,
      style_de: 'freundlich, langsam, versteht Fachwörter nicht, fragt oft nach' },
    problem_de: 'Sie will ihre Rechnung in der App finden, versteht aber die Menüs nicht und hat Angst, etwas kaputtzumachen.',
    goal_de: 'Der Agent führt sie in einfachen, kleinen Schritten ohne Fachjargon durch die App und bestätigt jeden Schritt, bis die Rechnung offen ist.',
    arc_de: 'Bleibt freundlich, wird aber unsicher und entschuldigt sich viel, wenn der Agent zu schnell wird oder Fachwörter benutzt. Blüht auf, wenn es klappt.',
    unsolvable: false, voice: VOICE_F[2],
  },

  // ── INBOUND SALES ─────────────────────────────────────────────────────────────────────────
  {
    id: 'isa-tarif-upgrade', quadrant: 'inbound_sales',
    title_de: 'Interessent fragt nach einem größeren Tarif', title_ar: '',
    brief_de: 'Ein warmer Interessent ruft an. Erst Bedarf verstehen, dann passend anbieten, dann abschließen.', brief_ar: '',
    customer: { name: 'Herr Nowak', gender: 'm', mood0: 4,
      style_de: 'interessiert, aber preisbewusst; vergleicht mit einem günstigeren Angebot der Konkurrenz' },
    problem_de: 'Sein Datenvolumen ist jeden Monat nach drei Wochen leer. Er überlegt, den Tarif zu wechseln, hat aber auch ein günstigeres Angebot von woanders gesehen.',
    goal_de: 'Der Agent fragt zuerst nach der Nutzung, empfiehlt dann einen passenden größeren Tarif, begegnet dem Preiseinwand konkret und fragt aktiv nach dem Abschluss.',
    arc_de: 'Offen und freundlich. Zieht sich zurück, wenn der Agent sofort verkauft, ohne zu fragen. Der Preiseinwand kommt IMMER — die Reaktion darauf entscheidet.',
    unsolvable: false, voice: VOICE_M[1],
  },
  {
    id: 'isa-neukundin-unsicher', quadrant: 'inbound_sales',
    title_de: 'Unsichere Neukundin will nur Informationen', title_ar: '',
    brief_de: 'Sie will „nur mal fragen". Aus Interesse eine Entscheidung machen — ohne Druck.', brief_ar: '',
    customer: { name: 'Frau Lindner', gender: 'f', mood0: 3,
      style_de: 'höflich, unentschlossen, hat schlechte Erfahrung mit Vertragsfallen, sagt oft: ich überlege es mir' },
    problem_de: 'Sie braucht zum ersten Mal einen eigenen Vertrag, hat aber Angst vor versteckten Kosten und langen Laufzeiten.',
    goal_de: 'Der Agent nimmt die Sorge ernst, erklärt transparent die Kosten und die Laufzeit, und macht den Abschluss leicht — zum Beispiel mit einer kurzen Laufzeit zum Start.',
    arc_de: 'Vorsichtig. Jedes Drängen bestätigt ihre Angst. Transparenz und ein einfacher erster Schritt gewinnen sie.',
    unsolvable: false, voice: VOICE_F[0],
  },

  // ── OUTBOUND CS ───────────────────────────────────────────────────────────────────────────
  {
    id: 'ocs-terminbestaetigung', quadrant: 'outbound_cs',
    title_de: 'Techniktermin bestätigen — Kunde ist genervt', title_ar: '',
    brief_de: 'Du rufst an, um einen Techniktermin zu bestätigen. Der Kunde ist beim Essen und genervt. Kompakt bleiben.', brief_ar: '',
    customer: { name: 'Herr Vogel', gender: 'm', mood0: 3,
      style_de: 'kurz angebunden, will schnell auflegen, wird bei langen Sätzen ungeduldig' },
    problem_de: 'Der Techniktermin morgen zwischen 8 und 12 Uhr muss bestätigt werden, sonst verfällt er.',
    goal_de: 'Der Agent stellt sich in einem Satz vor, nennt sofort den Grund, fragt, ob es gerade passt, bestätigt den Termin und beendet das Gespräch kompakt und freundlich.',
    arc_de: 'Genervt vom Anruf an sich. Entspannt sich, wenn der Agent schnell und respektvoll zum Punkt kommt. Legt fast auf, wenn der Agent schwafelt.',
    unsolvable: false, voice: VOICE_M[0],
  },
  {
    id: 'ocs-zahlung-offen', quadrant: 'outbound_cs',
    title_de: 'Offene Zahlung ansprechen — mit Würde', title_ar: '',
    brief_de: 'Zwei Monatsbeträge sind offen. Das Thema ansprechen, ohne den Kunden zu beschämen — und eine Lösung finden.', brief_ar: '',
    customer: { name: 'Frau Adler', gender: 'f', mood0: 2,
      style_de: 'verlegen, dann defensiv; hat gerade den Job verloren und schämt sich' },
    problem_de: 'Zwei Monatsbeträge sind offen. Sie hat ihren Job verloren und konnte nicht zahlen — sie kann auch heute nicht alles auf einmal zahlen.',
    goal_de: 'Der Agent spricht das Thema respektvoll an, hört den Grund an und vereinbart eine realistische Ratenlösung. Eine sofortige Vollzahlung zu fordern wäre falsch.',
    arc_de: 'Beginnt verlegen-defensiv. Öffnet sich bei Respekt und einem machbaren Vorschlag. Macht zu, wenn der Agent Druck macht oder belehrt.',
    unsolvable: false, voice: VOICE_F[1],
  },
  {
    id: 'ocs-rueckruf-beschwerde', quadrant: 'outbound_cs',
    title_de: 'Rückruf nach Beschwerde — Fehler nicht behebbar', title_ar: '',
    brief_de: 'Du rufst nach einer Beschwerde zurück: Die verlorenen Daten des Kunden sind endgültig weg. Die Wahrheit sagen und trotzdem gut beenden.', brief_ar: '',
    customer: { name: 'Herr Steiner', gender: 'm', mood0: 2,
      style_de: 'enttäuscht, sarkastisch, erwartet schlechte Nachrichten' },
    problem_de: 'Nach einer Störung sind seine gespeicherten Einstellungen und Daten verloren gegangen. Die Prüfung hat ergeben: Sie sind endgültig nicht wiederherstellbar.',
    goal_de: 'Der Agent überbringt die schlechte Nachricht ehrlich und ohne Ausflüchte, entschuldigt sich im Namen des Teams, erklärt was passiert ist und bietet an, beim Neuaufsetzen zu helfen.',
    arc_de: 'Erwartet Ausreden. Sarkasmus sinkt, wenn der Agent ehrlich ist und die Verantwortung nicht wegschiebt. Eine ehrliche schlechte Nachricht schlägt eine schöne Lüge.',
    unsolvable: true, voice: VOICE_M[1],
  },

  // ── OUTBOUND SALES ────────────────────────────────────────────────────────────────────────
  {
    id: 'osa-kaltakquise-buero', quadrant: 'outbound_sales',
    title_de: 'Kaltanruf: Büro-Internet anbieten', title_ar: '',
    brief_de: 'Kaltakquise bei einer Büroleiterin. Die ersten zehn Sekunden entscheiden alles.', brief_ar: '',
    customer: { name: 'Frau Berger', gender: 'f', mood0: 2,
      style_de: 'beschäftigt, abweisend, sagt früh: kein Interesse — gibt aber eine echte Chance, wenn der Einstieg relevant ist' },
    problem_de: 'Sie leitet ein kleines Büro mit acht Arbeitsplätzen und langsamer Leitung, hat aber keine Zeit und bekommt täglich Verkaufsanrufe.',
    goal_de: 'Der Agent überlebt das erste „kein Interesse", nennt in einem Satz einen konkreten relevanten Nutzen für ein kleines Büro und schlägt einen kurzen, konkreten nächsten Schritt vor — kein Vertragsabschluss im Erstanruf.',
    arc_de: 'Erste Reaktion ist IMMER Abwehr. Der Aufhänger entscheidet: ein konkreter Nutzen für IHR Büro öffnet zwei Minuten Zeit, Floskeln beenden das Gespräch.',
    unsolvable: false, voice: VOICE_F[2],
  },
  {
    id: 'osa-bestandskunde-zusatz', quadrant: 'outbound_sales',
    title_de: 'Bestandskunden anrufen: Zusatzoption verkaufen', title_ar: '',
    brief_de: 'Warmer Anruf: Dem Kunden eine passende Zusatzoption anbieten — nach dem ersten Nein weitermachen.', brief_ar: '',
    customer: { name: 'Herr Krause', gender: 'm', mood0: 3,
      style_de: 'entspannt, aber sparsam; erstes Nein kommt automatisch; lässt sich von passenden Argumenten umstimmen' },
    problem_de: 'Er ist zufriedener Kunde, zahlt aber oft Extragebühren im Ausland, weil ihm die Auslandsoption fehlt.',
    goal_de: 'Der Agent verbindet das Angebot mit dem echten Nutzungsmuster (häufige Auslandsgebühren), rechnet den Vorteil konkret vor, behandelt das automatische Nein ruhig und fragt nach der Entscheidung.',
    arc_de: 'Freundlich, sagt aus Gewohnheit erst Nein. Eine konkrete Rechnung, die zu ihm passt, ändert seine Meinung — Standardphrasen nicht.',
    unsolvable: false, voice: VOICE_M[0],
  },
];

const byId = new Map(SCENARIOS.map((s) => [s.id, s]));
export const getScenario = (id) => byId.get(String(id || '')) || null;

/** Unseen-first pick within a quadrant; when everything was seen, the least-recently-seen wins. */
export function pickScenario(quadrant, seenIdsInOrder = []) {
  const pool = SCENARIOS.filter((s) => s.quadrant === quadrant);
  if (!pool.length) return null;
  const seen = new Set(seenIdsInOrder);
  const unseen = pool.filter((s) => !seen.has(s.id));
  if (unseen.length) return unseen[0];
  // All seen → the one whose last appearance is oldest in the seen order.
  const lastIndex = (id) => seenIdsInOrder.lastIndexOf(id);
  return [...pool].sort((a, b) => lastIndex(a.id) - lastIndex(b.id))[0];
}

export default { QUADRANTS, RUBRICS, SCENARIOS, getScenario, pickScenario };
