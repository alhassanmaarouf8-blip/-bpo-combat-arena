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

import { createHash } from 'crypto';

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
  'c1': {
    id:    'c1',
    label: 'C1',
    lenient: false,
    speechStyle:
      `Sprich im gehobenen, akademisch-professionellen Register — das Niveau Schweizer BPO-Auftraggeber. ` +
      `Erwarte vollständiges C1-Deutsch: Nominalisierungen und Funktionsverbgefüge ` +
      `("eine Entscheidung treffen", "zur Verfügung stellen", "in Betracht ziehen"), ` +
      `Passiversatzformen ("lässt sich lösen", "ist zu klären"), präzise Relativsätze mit Präpositionen ` +
      `("der Kunde, mit dem ich gesprochen habe"), und konsequenten Konjunktiv II für jede Bitte und jeden Vorschlag. ` +
      `Erwarte die STAR-Methode in Verhaltensfragen (Situation → Aufgabe → Aktion → konkretes Ergebnis). ` +
      `Hake sofort nach, wenn Antworten vage bleiben, Ergebnisse fehlen oder das Register zu niedrig ist. ` +
      `Lobe SPARSAM und nur für tatsächlich gehobene Formulierungen.`,
  },
};

// ── Behavioral / HR questions (Teil 2) ──────────────────────────────────────────
export const BEHAVIORAL_QUESTIONS = [
  'Erzählen Sie von einer Situation, in der Sie eine Herausforderung gemeistert haben.',
  'Erzählen Sie von Ihrer letzten Reise — das Hotel, die Strände, die Menschen, und was Sie dort gelernt haben.',
  'Warum sollten wir ausgerechnet SIE einstellen?',
  'Beschreiben Sie einen Konflikt und wie Sie ihn gelöst haben.',
  'Beschreiben Sie eine Situation, in der Sie mit einem schwierigen Teammitglied zusammenarbeiten mussten.',
  'Erzählen Sie von einem Moment, in dem Sie unter großem Zeitdruck eine wichtige Entscheidung treffen mussten.',
  'Wie haben Sie einmal einen Fehler gemacht — und wie sind Sie damit umgegangen?',
  'Erzählen Sie von einer Situation, in der Sie proaktiv Verbesserungen vorgeschlagen haben.',
  'Beschreiben Sie eine Erfahrung, bei der Sie einem Kunden geholfen haben, der zunächst sehr unzufrieden war.',
  'Wie sind Sie vorgegangen, als Sie mit einer unklaren Arbeitsanweisung konfrontiert wurden?',
  'Erzählen Sie von einer Situation, in der Sie etwas Neues sehr schnell lernen mussten. Wie sind Sie vorgegangen?',
  'Beschreiben Sie einen Arbeitstag, an dem alles gleichzeitig kam. Wie haben Sie Prioritäten gesetzt?',
  'Erzählen Sie von einem Feedback, das Sie überrascht hat. Was haben Sie daraus gemacht?',
  'Beschreiben Sie eine Situation, in der Sie einem Kollegen geholfen haben, obwohl Sie selbst viel zu tun hatten.',
  'Erzählen Sie von einem Ziel, das Sie sich selbst gesetzt und erreicht haben. Wie sind Sie drangeblieben?',
  'Beschreiben Sie eine Situation, in der Sie ruhig bleiben mussten, obwohl Ihr Gegenüber laut wurde. Was haben Sie konkret gesagt?',
];

// ── BPO screening questions (Teil 1b) — the real phone-screen filter ─────────────
// EVERY real Cairo BPO German-line screen asks at least one of these before the
// behavioral round. Shift-willingness is the #1 silent disqualifier. Asking one of
// these deterministically makes the interview feel like an actual hiring screen AND
// prepares the candidate for the question that most often ends real interviews.
export const BPO_SCREENING_QUESTIONS = [
  'Bevor wir weitermachen — der Job läuft im Schichtdienst, auch abends und am Wochenende, oft nach deutscher Zeit. Wäre das für Sie machbar?',
  'Eine kurze organisatorische Frage: Ab wann könnten Sie anfangen, und haben Sie eine Kündigungsfrist?',
  'Der Alltag am Telefon kann eintönig und stressig sein — viele Anrufe, oft dieselben Beschwerden. Wie halten Sie da Ihre Energie und Geduld?',
  'Was reizt Sie konkret daran, im Kundenservice für deutsche Kunden zu arbeiten — und nicht auf Englisch oder Arabisch?',
  'Nur damit ich es richtig einordne: Wie sieht Ihre Gehaltsvorstellung für eine Vollzeitstelle aus?',
  'Kurz zur Technik: Haben Sie zu Hause eine stabile Internetverbindung und einen ruhigen Arbeitsplatz, falls Sie im Homeoffice arbeiten?',
  'Wie schätzen Sie Ihr Deutsch selbst ein — und wo merken Sie im Alltag noch Grenzen, zum Beispiel am Telefon?',
  'Wo sehen Sie sich beruflich in zwei bis drei Jahren — eher in der Kundenbetreuung, im Qualitätsbereich oder in einer Teamleitung?',
  'Wie lang wäre Ihr Arbeitsweg zu uns, und wie zuverlässig kommen Sie auch zu einer Frühschicht um sechs Uhr?',
  'Haben Sie schon einmal im Schichtsystem gearbeitet? Wenn ja: Was war für Sie das Schwierigste daran?',
  // Floor-language screening (KB v1 §4): real TL interviews test whether the candidate knows how a
  // call center is actually measured — and the learner must UNDERSTAND these words on day one.
  'In diesem Job wird Ihre durchschnittliche Bearbeitungszeit gemessen — die sogenannte AHT. Wie gehen Sie damit um, wenn ein Kunde viel Zeit braucht, Ihre Zeit aber begrenzt ist?',
  'Ihre Gespräche werden zur Qualitätssicherung aufgezeichnet und bewertet. Wie stehen Sie dazu, regelmäßig Feedback aus einem Coaching-Gespräch umzusetzen?',
  'Wir arbeiten mit einem Gesprächsleitfaden. Wie schaffen Sie es, einem Skript zu folgen und trotzdem natürlich zu klingen?',
  'Was tun Sie, wenn die Warteschleife voll ist und gleichzeitig ein Kunde im Gespräch einfach nicht zum Ende kommt?',
];

// ── C1 Behavioral questions — Swiss/formal BPO register, STAR-method expected ──
export const C1_BEHAVIORAL_QUESTIONS = [
  'Beschreiben Sie eine komplexe Situation, in der Sie mehrere Stakeholder mit widersprüchlichen Erwartungen koordinieren mussten — und welches konkrete Ergebnis Sie erzielt haben.',
  'Erzählen Sie von einer Entscheidung, die Sie unter Zeitdruck und mit unvollständigen Informationen treffen mussten. Welche Abwägungen haben Sie getroffen und welches Ergebnis hatte das?',
  'Beschreiben Sie einen Fall, in dem Sie konstruktiv Kritik an einer Entscheidung Ihres Vorgesetzten geäußert haben — wie sind Sie vorgegangen und was war das Ergebnis?',
  'Schildern Sie eine Situation, in der Sie eine eskalierte Kundenbeschwerde langfristig in eine positive Kundenbeziehung verwandelt haben.',
  'Beschreiben Sie eine Situation, in der Sie eine kundenseitige Eskalation deeskalieren mussten, ohne dabei Unternehmensvorgaben zu verletzen — und welches Ergebnis erzielte Ihre Intervention?',
  'Erzählen Sie von einem Fall, in dem Sie das Vertrauen eines Kunden nach einem schwerwiegenden Servicefehler langfristig zurückgewinnen konnten. Welche konkreten Schritte haben Sie unternommen?',
  'Beschreiben Sie eine Situation, in der Sie interne Prozesse verbessert haben, um die Kundenzufriedenheit messbar zu steigern.',
  'Schildern Sie eine Entscheidungssituation mit ethisch problematischen Aspekten im Berufsalltag — wie haben Sie abgewogen, entschieden und kommuniziert?',
  'Beschreiben Sie eine Situation, in der Sie einem Kunden eine unbequeme Entscheidung des Unternehmens vermitteln mussten, ohne die Kundenbeziehung zu beschädigen. Wie haben Sie das kommuniziert?',
  'Schildern Sie einen Fall, in dem Sie Ihr Wissen strukturiert an neue Kolleginnen und Kollegen weitergegeben haben. Woran haben Sie gemerkt, dass Ihre Einarbeitung wirkte?',
  'Erzählen Sie von einer Situation, in der Sie zwischen Schnelligkeit und Gründlichkeit abwägen mussten. Wie haben Sie entschieden — und wie haben Sie diese Entscheidung begründet?',
  'Beschreiben Sie einen Fall, in dem Sie aus mehreren Kundenbeschwerden ein wiederkehrendes Muster erkannt und daraus eine konkrete Prozessänderung abgeleitet haben.',
];

// Versioned, opaque identifiers for the public interview-question banks. The text stays in the
// curated server registry; persisted speaking evidence stores only these IDs. Hashing the canonical
// text keeps IDs stable if the arrays are reordered while a version bump makes wording changes fail
// closed instead of silently pretending to be the same matched task.
export const INTERVIEW_PROMPT_CONTRACT_VERSION = 1;
const PROMPT_ID_RE = /^(beh|scr)-[a-f0-9]{12}$/u;
function promptPool(kind, levelId = 'a2-b1') {
  if (kind === 'behavioral') return levelId === 'c1' ? C1_BEHAVIORAL_QUESTIONS : BEHAVIORAL_QUESTIONS;
  if (kind === 'screening') return BPO_SCREENING_QUESTIONS;
  return [];
}
export function interviewPromptId(kind, text, levelId = 'a2-b1') {
  const pool = promptPool(kind, levelId);
  if (typeof text !== 'string' || !pool.includes(text)) return null;
  const prefix = kind === 'behavioral' ? 'beh' : kind === 'screening' ? 'scr' : null;
  if (!prefix) return null;
  return `${prefix}-${createHash('sha256').update(`${INTERVIEW_PROMPT_CONTRACT_VERSION}:${kind}:${text}`).digest('hex').slice(0, 12)}`;
}
export function interviewPromptById(kind, id, levelId = 'a2-b1') {
  if (typeof id !== 'string' || !PROMPT_ID_RE.test(id)) return null;
  return promptPool(kind, levelId).find((text) => interviewPromptId(kind, text, levelId) === id) || null;
}
export function availableInterviewPromptIds(kind, levelId = 'a2-b1', excludedIds = []) {
  const excluded = new Set(Array.isArray(excludedIds) ? excludedIds : []);
  return promptPool(kind, levelId).map((text) => interviewPromptId(kind, text, levelId)).filter((id) => id && !excluded.has(id));
}

// ── Customer-service roleplay scenarios (Teil 3) — the boss PLAYS the customer ──
export const CS_SCENARIOS = [
  {
    id:        'late-delivery',
    customer:  'ein wütender Kunde, dessen Bestellung für Freitag versprochen wurde und immer noch nicht angekommen ist',
    opening:   'Wo bleibt meine Bestellung?! Sie wurde mir für FREITAG zugesagt und ich habe immer noch NICHTS bekommen! Wenn das so läuft, kündige ich auf der Stelle!',
    situation: 'Lieferung war für Freitag zugesagt, ist nicht angekommen — der Kunde droht zu kündigen.',
    skill:     'De-Eskalation + klarer nächster Schritt',
    keyPhrases: [
      'Ich kann Ihren Ärger vollkommen nachvollziehen.',
      'Ich prüfe das sofort für Sie — könnten Sie mir bitte Ihre Bestellnummer nennen?',
      'Ich kümmere mich umgehend darum und melde mich innerhalb von 24 Stunden bei Ihnen.',
    ],
  },
  {
    id:        'billing-error',
    customer:  'ein empörter Kunde, dem ein falscher Betrag berechnet wurde',
    opening:   'Sie haben mir den Betrag doppelt abgebucht! Das ist doch Betrug! Ich will mein Geld sofort zurück — sofort!',
    situation: 'Abrechnungsfehler: dem Kunden wurde zu viel berechnet.',
    skill:     'Verantwortung übernehmen + Lösung anbieten',
    keyPhrases: [
      'Das tut mir aufrichtig leid — das hätte nicht passieren dürfen.',
      'Ich leite die Rückerstattung sofort ein.',
      'Darf ich kurz zusammenfassen, damit ich Sie richtig verstanden habe?',
    ],
  },
  {
    id:        'service-outage',
    customer:  'ein gestresster Kunde, dessen Service seit Stunden ausgefallen ist',
    opening:   'Mein Internet ist seit DREI Stunden tot! Ich arbeite von zu Hause — das kostet mich bares Geld! Was unternehmen Sie jetzt dagegen?!',
    situation: 'Serviceausfall betrifft den Kunden seit Stunden und verursacht ihm Schaden.',
    skill:     'Empathie + schnelle Handlungsbereitschaft',
    keyPhrases: [
      'Ich verstehe, dass das für Sie sehr ärgerlich ist — ich nehme das sehr ernst.',
      'Was ich konkret für Sie tun kann, ist Folgendes: Ich eskaliere das sofort an unser technisches Team.',
      'Ich verspreche Ihnen, dass ich dranbleibe, bis das Problem gelöst ist.',
    ],
  },
  {
    id:        'must-decline',
    customer:  'ein fordernder Kunde, der eine Erstattung außerhalb der Richtlinien verlangt',
    opening:   'Ich verlange eine volle Erstattung, und zwar JETZT! Mir ist völlig egal, was in Ihren Regeln steht!',
    situation: 'Der Kunde verlangt etwas, das der Agent höflich ablehnen muss — danach die Eskalation auffangen.',
    skill:     'Höfliche Ablehnung + alternative Lösung',
    keyPhrases: [
      'Ich kann zwar das Geschehene nicht rückgängig machen, aber ich möchte Ihnen eine Alternative anbieten.',
      'Bleiben wir bitte sachlich, dann finden wir gemeinsam eine Lösung.',
      'Ich würde Ihnen vorschlagen, dass …',
    ],
  },
  {
    id:        'tech-support',
    customer:  'ein frustrierter Kunde, der mit einem Gerät nicht zurechtkommt',
    opening:   'Ich verstehe das nicht! Ich habe alles versucht und es funktioniert immer noch nicht! Erklären Sie mir das bitte Schritt für Schritt!',
    situation: 'Technisches Problem: der Kunde braucht geduldige Anleitung — Geduld, Empathie und klare Schritte sind entscheidend.',
    skill:     'Geduldige Anleitung + klare Schritte',
    keyPhrases: [
      'Selbstverständlich helfe ich Ihnen — nehmen wir es Schritt für Schritt.',
      'Habe ich Sie richtig verstanden, dass …?',
      'Damit ich Ihnen schneller helfen kann, brauche ich kurz Ihre Gerätenummer.',
    ],
  },
  {
    id:        'cancellation-retention',
    customer:  'ein Kunde, der seinen Vertrag kündigen möchte',
    opening:   'Ich möchte meinen Vertrag kündigen. Ich bin mit dem Service nicht zufrieden und ich habe mich bereits entschieden.',
    situation: 'Kundenbindung: Ziel ist, den Kündigungsgrund zu verstehen und ggf. eine Alternative anzubieten — ohne Druck oder Überredung.',
    skill:     'Aktives Zuhören + sanfte Retention',
    keyPhrases: [
      'Das tut mir leid zu hören — darf ich fragen, was Sie enttäuscht hat?',
      'Ich nehme Ihr Anliegen sehr ernst und möchte verstehen, was passiert ist.',
      'Ich würde Ihnen gern eine Alternative zeigen, bevor Sie endgültig entscheiden.',
    ],
  },
  {
    id:        'identity-verification',
    customer:  'ein gereizter Kunde, der Kontoauskunft verlangt, aber die Identitätsprüfung verweigert',
    opening:   'Jetzt hören Sie mal zu: Ich will nur wissen, was auf meinem Konto los ist! Nein, ich gebe Ihnen nicht schon wieder mein Geburtsdatum — sagen Sie mir einfach, was da abgebucht wurde!',
    situation: 'Der Kunde verlangt Auskunft über sein Konto, verweigert aber die Verifizierung — ohne Identitätsprüfung darf nichts herausgegeben werden.',
    skill:     'Datenschutz freundlich, aber konsequent durchsetzen',
    keyPhrases: [
      'Ich helfe Ihnen sofort weiter — aus Datenschutzgründen muss ich Sie vorher kurz verifizieren.',
      'Genau das schützt Ihr Konto — deshalb frage ich.',
      'Sobald ich Sie verifiziert habe, kläre ich das umgehend für Sie.',
    ],
  },
  {
    id:        'price-increase',
    customer:  'ein empörter Kunde, dessen Vertrag ohne Vorwarnung teurer geworden ist',
    opening:   'Was soll diese Preiserhöhung?! Neunzehn Euro mehr im Monat, und keiner sagt mir Bescheid?! Das lasse ich mir nicht gefallen!',
    situation: 'Der Vertrag wurde teurer; der Kunde fühlt sich überrumpelt und droht mit dem Wechsel zur Konkurrenz.',
    skill:     'Transparenz + Optionen statt Rechtfertigung',
    keyPhrases: [
      'Ich verstehe, dass Sie das ärgert — ich schaue mir Ihren Vertrag sofort an.',
      'Ich erkläre Ihnen transparent, wie der neue Preis zustande kommt.',
      'Lassen Sie uns gemeinsam prüfen, welcher Tarif besser zu Ihnen passt.',
    ],
  },
  {
    id:        'demands-manager',
    customer:  'ein aufgebrachter Kunde, der sofort mit der Teamleitung sprechen will',
    opening:   'Nein, mit IHNEN rede ich nicht mehr! Geben Sie mir sofort Ihren Vorgesetzten — SOFORT!',
    situation: 'Der Kunde verlangt sofort die Teamleitung; der Agent soll erst selbst Lösungskompetenz zeigen, ohne die Eskalation zu blockieren.',
    skill:     'Souverän bleiben + Eskalation professionell anbieten',
    keyPhrases: [
      'Das können Sie gern bekommen — geben Sie mir zwei Minuten, vielleicht habe ich bis dahin schon die Lösung für Sie.',
      'Ich nehme Ihr Anliegen genauso ernst, wie meine Teamleitung es tun würde.',
      'Wenn Sie danach weiterhin die Teamleitung sprechen möchten, verbinde ich Sie selbstverständlich.',
    ],
  },
  {
    id:        'wrong-item',
    customer:  'ein Kunde unter Zeitdruck, der einen falschen Artikel geliefert bekommen hat',
    opening:   'Ich habe ein GRAUES Notebook bestellt und ein pinkes bekommen! Das ist doch nicht zu fassen — ich brauche das Gerät MORGEN für eine Präsentation!',
    situation: 'Falscher Artikel geliefert, der Kunde steht unter Zeitdruck — die Lösung muss schnell und konkret sein.',
    skill:     'Schnelle, konkrete Lösung unter Zeitdruck',
    keyPhrases: [
      'Das ist ärgerlich, gerade vor Ihrem Termin — ich kümmere mich sofort darum.',
      'Ich prüfe, ob eine Expresslieferung bis morgen früh möglich ist.',
      'Sie bekommen von mir noch heute eine Bestätigung mit der Sendungsnummer.',
    ],
  },

  // ── Industry-deep scenarios (KB v1, docs/kb/GERMAN-BPO-KB.md, 2026-07-10) ──────────────────
  // One per real German account TYPE run from Cairo & the nearshore hubs (telecom, e-commerce,
  // fintech, airline, delivery, logistics, energy, insurance, streaming, B2B ads). Brands stay
  // anonymous (owner doctrine) — the TERMINOLOGY is the point: a learner who lands on any of the
  // 90+ real accounts has already spoken its vocabulary here. Unseen-first selection makes this
  // depth surface automatically; no new feature.
  {
    id:        'telecom-kuendigung',
    industry:  'telecom',
    customer:  'ein entschlossener Kunde, der seinen Mobilfunkvertrag kündigen will, weil die Konkurrenz billiger ist',
    opening:   'Ich möchte meinen Vertrag kündigen, und zwar zum nächstmöglichen Termin! Die Konkurrenz bietet mir das gleiche Datenvolumen für die Hälfte. Schicken Sie mir die Kündigungsbestätigung!',
    situation: 'Kündigungswunsch wegen eines besseren Konkurrenzangebots — Rückgewinnung versuchen, ohne aufdringlich zu werden.',
    skill:     'Kundenrückgewinnung: zuhören, Mehrwert anbieten, Kündigungsrecht respektieren',
    keyPhrases: [
      'Aus Datenschutzgründen bestätige ich zuerst kurz Ihre Identität — nennen Sie mir bitte Ihre Service-PIN?',
      'Ich sehe, Ihre Kündigungsfrist läuft zum Monatsende — darf ich Ihnen vorher ein Angebot machen?',
      'Ich kann Ihnen eine Vertragsverlängerung mit doppeltem Datenvolumen zum gleichen Preis anbieten.',
      'Wenn Sie trotzdem kündigen möchten, leite ich das selbstverständlich sofort für Sie ein.',
    ],
  },
  {
    id:        'telecom-portierung',
    industry:  'telecom',
    customer:  'ein nervöser Kunde, dessen Rufnummernmitnahme zum neuen Anbieter seit Tagen feststeckt',
    opening:   'Meine Nummer sollte längst portiert sein! Seit vier Tagen bin ich nicht erreichbar — meine Kunden rufen ins Leere! Wo hängt die Portierung fest?',
    situation: 'Die Rufnummernmitnahme verzögert sich, der Kunde ist beruflich auf die Nummer angewiesen.',
    skill:     'Technischen Prozess erklären + verbindlichen Termin geben',
    keyPhrases: [
      'Ich prüfe sofort den Status Ihrer Portierung — einen Moment bitte.',
      'Die Freigabe Ihres alten Anbieters liegt vor; die Umschaltung erfolgt morgen bis zwölf Uhr.',
      'Sie erhalten von mir eine SMS, sobald Ihre Rufnummer aktiv ist.',
    ],
  },
  {
    id:        'tech-router-stoerung',
    industry:  'telecom',
    customer:  'ein Kunde im Homeoffice, dessen Internet seit dem Morgen ausfällt und der schon alles probiert hat',
    opening:   'Mein Internet fällt ständig aus, ich habe den Router schon dreimal neu gestartet! Ich arbeite im Homeoffice — noch ein Tag so, und ich habe ein ernstes Problem mit meinem Chef!',
    situation: 'Wiederkehrende Verbindungsabbrüche; die üblichen Neustarts haben nicht geholfen — strukturierte Störungsdiagnose nötig.',
    skill:     'Technische Diagnose Schritt für Schritt + Erwartungen steuern',
    keyPhrases: [
      'Ich sehe in der Leitungsmessung eine Störung an Ihrem Anschluss.',
      'Bitte setzen Sie den Router einmal auf Werkseinstellungen zurück — ich bleibe währenddessen in der Leitung.',
      'Falls das nicht hilft, vereinbare ich sofort einen Techniker-Termin für morgen früh.',
    ],
  },
  {
    id:        'ecommerce-retoure',
    industry:  'ecommerce',
    customer:  'eine genervte Kundin, deren Retourenlabel nicht funktioniert und deren Erstattung seit drei Wochen aussteht',
    opening:   'Ihr Retourenlabel lässt sich nicht ausdrucken, und auf meine Erstattung warte ich seit DREI Wochen! Dreihundert Euro! Langsam frage ich mich, ob ich mein Geld je wiedersehe.',
    situation: 'Defektes Retourenlabel + ausstehende Erstattung — zwei Probleme in einem Anruf, Vertrauen ist angeschlagen.',
    skill:     'Mehrere Anliegen strukturieren + konkreten Erstattungstermin nennen',
    keyPhrases: [
      'Ich sende Ihnen sofort ein neues Retourenlabel per E-Mail.',
      'Ihre Rücksendung ist bei uns eingegangen — die Erstattung veranlasse ich jetzt manuell.',
      'Das Geld ist innerhalb von drei bis fünf Werktagen auf Ihrem Konto.',
    ],
  },
  {
    id:        'fintech-doppelbuchung',
    industry:  'fintech',
    customer:  'ein alarmierter Kunde, dem derselbe Betrag zweimal abgebucht wurde und der Betrug vermutet',
    opening:   'Auf meinem Konto ist dieselbe Lastschrift ZWEIMAL abgebucht — 89 Euro doppelt! Ist mein Konto gehackt? Ich will das Geld sofort zurück und wissen, was da los ist!',
    situation: 'Doppelte Abbuchung, der Kunde vermutet Betrug — Sicherheit prüfen, Rückbuchung einleiten, beruhigen.',
    skill:     'Sicherheitsbedenken ernst nehmen + Rückbuchung sauber erklären',
    keyPhrases: [
      'Ich verstehe Ihre Sorge — ich prüfe die Buchung sofort mit Ihnen zusammen.',
      'Es handelt sich um eine technische Doppelbuchung, kein unbefugter Zugriff auf Ihr Konto.',
      'Ich leite die Rückbuchung jetzt ein; zur Sicherheit empfehle ich Ihnen, Ihr Passwort zu ändern.',
    ],
  },
  {
    id:        'fintech-kontosperrung',
    industry:  'fintech',
    customer:  'ein verzweifelter Kunde, dessen Konto nach der Identitätsprüfung gesperrt bleibt, obwohl seine Miete fällig ist',
    opening:   'Mein Konto ist seit fünf Tagen gesperrt! Ich habe die Video-Identifizierung doch längst gemacht! Morgen wird meine Miete abgebucht — wenn das platzt, haben SIE ein Problem!',
    situation: 'Kontosperrung trotz abgeschlossener Verifizierung; eine dringende Zahlung steht an.',
    skill:     'Dringlichkeit anerkennen + Prüfprozess transparent machen, nichts versprechen, was Compliance verbietet',
    keyPhrases: [
      'Bevor ich auf Ihr Konto schaue, muss ich aus Datenschutzgründen Ihre Identität prüfen.',
      'Ich sehe, Ihre Verifizierung ist eingegangen und liegt bei unserem Prüfteam.',
      'Ich markiere Ihren Fall als dringend, weil eine Mietzahlung ansteht.',
      'Die Prüfung kann ich nicht überspringen, aber ich melde mich heute noch mit einem Zwischenstand.',
    ],
  },
  {
    id:        'airline-umbuchung',
    industry:  'airline',
    customer:  'eine gestresste Kundin, deren Flug gestrichen wurde und die morgen zu einer Beerdigung muss',
    opening:   'Mein Flug morgen früh wurde einfach GESTRICHEN! Ich muss zu einer Beerdigung — verstehen Sie das? Ich MUSS morgen dort sein, egal wie!',
    situation: 'Flugstreichung vor einem emotional wichtigen Termin — Umbuchung finden, Fluggastrechte kennen, mit Gefühl kommunizieren.',
    skill:     'Empathie in einer emotionalen Ausnahmesituation + schnelle Umbuchung',
    keyPhrases: [
      'Das tut mir sehr leid — ich suche Ihnen jetzt sofort die schnellste Alternative.',
      'Ich kann Sie kostenlos auf den Flug um 6:15 Uhr über München umbuchen.',
      'Ihre Entschädigungsansprüche nach der EU-Fluggastrechteverordnung prüfe ich im Anschluss für Sie.',
    ],
  },
  {
    id:        'airline-gepaeck',
    industry:  'airline',
    customer:  'ein aufgebrachter Kunde, dessen Koffer seit der Landung verschwunden ist — mit Medikamenten darin',
    opening:   'Mein Koffer ist nicht angekommen! Da sind meine Medikamente drin, die ich TÄGLICH brauche. Am Schalter hat man mich einfach weggeschickt — was machen Sie jetzt?',
    situation: 'Gepäckverlust mit dringend benötigten Medikamenten — Sofortmaßnahmen plus Verlustmeldung.',
    skill:     'Dringendes vom Formalen trennen: erst die Medikamente, dann der Prozess',
    keyPhrases: [
      'Das Wichtigste zuerst: Notwendige Ersatzkäufe wie Medikamente können Sie einreichen — heben Sie die Belege auf.',
      'Ich erfasse jetzt Ihre Verlustmeldung mit der Gepäcknummer von Ihrem Abschnitt.',
      'Ihr Koffer ist lokalisiert und wird Ihnen morgen bis 14 Uhr an Ihre Adresse zugestellt.',
    ],
  },
  {
    id:        'delivery-fehlende-artikel',
    industry:  'delivery',
    customer:  'ein hungriger, wütender Kunde, dessen Lieferung kalt ankam und bei dem die Hälfte fehlt',
    opening:   'Meine Bestellung kam eine Stunde zu spät, das Essen ist EISKALT, und die Getränke fehlen komplett! Und jetzt bietet mir Ihre App fünf Euro Gutschrift an? Das ist doch ein Witz!',
    situation: 'Verspätete, unvollständige und kalte Lieferung; die automatische Kulanz der App empfand der Kunde als Beleidigung.',
    skill:     'Kulanz menschlich machen: neu bewerten statt Standardgutschrift verteidigen',
    keyPhrases: [
      'Da ist heute wirklich einiges schiefgelaufen — das sehe ich genauso wie Sie.',
      'Ich erstatte Ihnen die fehlenden Artikel vollständig und die Liefergebühr dazu.',
      'Zusätzlich lege ich Ihnen eine Gutschrift für die nächste Bestellung ins Konto.',
    ],
  },
  {
    id:        'logistik-zustellversuch',
    industry:  'logistik',
    customer:  'ein verärgerter Kunde, der den ganzen Tag zu Hause war und trotzdem eine "nicht angetroffen"-Karte im Briefkasten fand',
    opening:   'Ich war den GANZEN Tag zu Hause, und trotzdem steckt eine Karte im Briefkasten: „Leider nicht angetroffen"! Der Fahrer hat nicht einmal geklingelt! Und jetzt liegt mein Paket irgendwo in einer Filiale?',
    situation: 'Angeblich erfolgloser Zustellversuch; das Paket wartet in der Abholstation — der Kunde fühlt sich belogen.',
    skill:     'Ärger validieren, ohne den Kollegen schlechtzumachen + bequemste Lösung anbieten',
    keyPhrases: [
      'Das ist verständlicherweise frustrierend — ich gebe Ihre Rückmeldung an das Zustellteam weiter.',
      'Ihr Paket liegt in der Abholstation und ist dort noch sieben Werktage für Sie hinterlegt.',
      'Alternativ beauftrage ich für morgen einen erneuten Zustellversuch an Ihre Adresse.',
    ],
  },
  {
    id:        'energie-nachzahlung',
    industry:  'energie',
    customer:  'eine geschockte Kundin, deren Jahresabrechnung eine Nachzahlung von 480 Euro verlangt',
    opening:   'Ich habe gerade meine Jahresabrechnung geöffnet: 480 Euro NACHZAHLUNG! Das kann überhaupt nicht stimmen, wir haben sogar gespart! Erklären Sie mir das — sofort!',
    situation: 'Hohe Nachzahlung in der Jahresabrechnung; möglicherweise beruht sie auf einem geschätzten Zählerstand.',
    skill:     'Abrechnung verständlich erklären + Ratenzahlung als Ausweg anbieten',
    keyPhrases: [
      'Ich gehe die Abrechnung jetzt Schritt für Schritt mit Ihnen durch.',
      'Ihr Zählerstand wurde geschätzt — bitte geben Sie mir den aktuellen Stand durch, dann korrigiere ich die Rechnung.',
      'Falls eine Restsumme bleibt, kann ich Ihnen eine Ratenzahlung ohne Zusatzkosten einrichten.',
    ],
  },
  {
    id:        'versicherung-schaden',
    industry:  'versicherung',
    customer:  'ein ungeduldiger Kunde, dessen Wasserschaden-Meldung seit sechs Wochen unbearbeitet liegt',
    opening:   'Ich habe den Wasserschaden vor SECHS Wochen gemeldet! Die Wand schimmelt inzwischen, und von Ihnen kommt nichts außer automatischen E-Mails! Wann wird mein Schaden endlich reguliert?',
    situation: 'Schadensmeldung liegt seit Wochen ohne Rückmeldung; der Schaden verschlimmert sich sichtbar.',
    skill:     'Verzögerung ehrlich einräumen + den Fall aktiv eskalieren',
    keyPhrases: [
      'Sechs Wochen ohne Rückmeldung sind zu lang — dafür entschuldige ich mich.',
      'Ich sehe, es fehlen noch Fotos für den Sachbearbeiter; die können Sie mir direkt hier hochladen.',
      'Ich eskaliere Ihre Schadensmeldung heute an die Fachabteilung und Sie erhalten bis Freitag eine Entscheidung.',
    ],
  },
  {
    id:        'streaming-abbuchung',
    industry:  'streaming',
    customer:  'ein empörter Kunde, dem nach seiner Kündigung trotzdem der Monatsbeitrag abgebucht wurde',
    opening:   'Ich habe mein Abo letzten Monat GEKÜNDIGT — und heute buchen Sie mir schon wieder 14,99 Euro ab! Machen Sie das rückgängig, sonst lasse ich jede weitere Abbuchung von meiner Bank zurückholen!',
    situation: 'Abbuchung nach Kündigung — vermutlich lief die Kündigung erst zum Periodenende, was der Kunde nicht wusste.',
    skill:     'Missverständnis über Kündigungsfristen klären, ohne belehrend zu klingen',
    keyPhrases: [
      'Zu Ihrer Sicherheit gleiche ich zuerst Ihr Kundenkennwort ab, bevor ich Buchungen einsehe.',
      'Ich prüfe Ihre Kündigung — sie ist eingegangen und zum Ende der Laufzeit wirksam.',
      'Die letzte Abbuchung deckt den bereits angefangenen Zeitraum ab — das erkläre ich Ihnen gern genauer.',
      'Aus Kulanz erstatte ich Ihnen den Betrag und stelle das Konto sofort auf beendet.',
    ],
  },
  {
    id:        'b2b-werbekonto',
    industry:  'b2b',
    customer:  'eine Geschäftsinhaberin, deren Werbekonto mitten in ihrer wichtigsten Verkaufswoche gesperrt wurde',
    opening:   'Mein Werbekonto wurde heute Morgen gesperrt — angeblich ein Richtlinienverstoß, aber es steht nirgends, WELCHER! Meine Kampagnen stehen still, mitten im Weihnachtsgeschäft! Jede Stunde kostet mich Umsatz!',
    situation: 'B2B-Fall: gesperrtes Werbekonto ohne klare Begründung; wirtschaftlicher Druck ist real und stündlich.',
    skill:     'B2B-Register halten + Prüfprozess konkret machen, ohne Schuld einzugestehen',
    keyPhrases: [
      'Ich verstehe, dass jede Stunde zählt — ich schaue mir die Sperrung sofort an.',
      'Die Prüfung betrifft eine Anzeige vom Dienstag; ich reiche Ihren Widerspruch jetzt mit Priorität ein.',
      'Sie erhalten die Entscheidung des Prüfteams innerhalb von 24 Stunden per E-Mail.',
    ],
  },
];

// Vacancy-only roleplay scenarios. They are intentionally NOT part of CS_SCENARIOS, so enabling
// this support cannot change the legacy/global rotation while vacancy flags are off.
const SALES_ROLEPLAY_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'sales-price-objection', roleType: 'sales', industry: 'b2b',
    customer: 'ein skeptischer Gesch\u00e4ftskunde, der das Angebot mit einem billigeren Wettbewerber vergleicht',
    opening: 'Ihr Angebot ist deutlich teurer als das der Konkurrenz. Warum sollte ich ausgerechnet bei Ihnen abschlie\u00dfen?',
    situation: 'Ein potenzieller Gesch\u00e4ftskunde nennt einen klaren Preiseinwand; der Kandidat muss Bedarf kl\u00e4ren, passenden Nutzen belegen und einen druckfreien n\u00e4chsten Schritt vereinbaren.',
    skill: 'Einwand anerkennen + Bedarf erfragen + relevanten n\u00e4chsten Schritt vereinbaren',
    keyPhrases: ['Was ist Ihnen neben dem Preis besonders wichtig?', 'Darf ich kurz vergleichen, welche Leistung f\u00fcr Ihren Bedarf relevant ist?',
      'Wenn das f\u00fcr Sie passt, vereinbaren wir als n\u00e4chsten Schritt einen kurzen Testtermin.'],
  }),
  Object.freeze({
    id: 'sales-no-need-objection', roleType: 'sales', industry: 'b2b',
    customer: 'eine knappe Interessentin, die keinen aktuellen Bedarf sieht und das Gespr\u00e4ch beenden will',
    opening: 'Ganz ehrlich: Wir sind mit unserer jetzigen L\u00f6sung zufrieden und brauchen nichts Neues. Wozu soll ich weiterreden?',
    situation: 'Eine potenzielle Kundin sieht keinen Bedarf; der Kandidat darf nicht dr\u00e4ngen und muss mit einer gezielten Frage Relevanz pr\u00fcfen.',
    skill: 'Ablehnung respektieren + eine Bedarfsfrage stellen + sauber abschlie\u00dfen',
    keyPhrases: ['Verstanden, ich m\u00f6chte Sie nicht unn\u00f6tig aufhalten.', 'Darf ich nur fragen, was bei Ihrer jetzigen L\u00f6sung am wichtigsten ist?',
      'Wenn kein Bedarf besteht, beenden wir das Gespr\u00e4ch selbstverst\u00e4ndlich hier.'],
  }),
  Object.freeze({
    id: 'sales-service-fit', roleType: 'sales',
    customer: 'eine Interessentin, die mit ihrer aktuellen L\u00f6sung grunds\u00e4tzlich zufrieden ist, aber schnellere Hilfe und eine monatliche K\u00fcndigungsm\u00f6glichkeit wichtig findet',
    opening: 'Ich bin eigentlich zufrieden. Was w\u00e4re f\u00fcr mich konkret besser, und warum sollte ich mir daf\u00fcr jetzt Zeit nehmen?',
    situation: 'Die bekannten Angebotsvorteile sind schnellere Hilfe und monatliche K\u00fcndbarkeit; der Kandidat muss zuerst den Bedarf kl\u00e4ren und darf nur diese belegten Vorteile verwenden.',
    skill: 'Bedarf erfragen + belegten Nutzen zuordnen + druckfreien n\u00e4chsten Schritt vereinbaren',
    keyPhrases: ['Was ist Ihnen im Alltag wichtiger: schnelle Hilfe oder flexible Laufzeit?',
      'F\u00fcr Ihren genannten Bedarf passt die schnellere Hilfe; weitere Vorteile m\u00f6chte ich nicht behaupten.',
      'Wenn Sie m\u00f6chten, pr\u00fcfen wir im n\u00e4chsten Schritt gemeinsam, ob das wirklich passt.'],
  }),
]);

const TECHNICAL_ROLEPLAY_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'technical-wifi-after-update', roleType: 'technical_support',
    customer: 'ein Kunde, dessen Firmen-Laptop seit einem Update kein WLAN mehr findet; andere Ger\u00e4te sind verbunden und ein Neustart hat nicht geholfen',
    opening: 'Seit dem Update findet nur mein Firmen-Laptop kein WLAN mehr. Mein Handy ist verbunden, und neu gestartet habe ich schon. Was pr\u00fcfen wir jetzt?',
    situation: 'Bekannte Fakten: Problem seit Update, nur ein Ger\u00e4t betroffen, WLAN funktioniert f\u00fcr andere Ger\u00e4te, Neustart ohne Erfolg. Der Kandidat muss zusammenfassen, gezielt diagnostizieren und einen sicheren n\u00e4chsten Schritt erkl\u00e4ren.',
    skill: 'Problem zusammenfassen + Diagnosefrage + sicherer n\u00e4chster Schritt',
    keyPhrases: ['Wenn ich Sie richtig verstehe, betrifft es seit dem Update nur den Firmen-Laptop.',
      'Wird das WLAN gar nicht angezeigt, oder erscheint beim Verbinden eine Fehlermeldung?',
      'Pr\u00fcfen wir zuerst den WLAN-Adapterstatus; ich erkl\u00e4re Ihnen jeden Schritt.'],
  }),
]);

const BACKOFFICE_ROLEPLAY_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'backoffice-conflicting-address', roleType: 'backoffice',
    customer: 'eine deutsche Kollegin, die einen Auftrag mit zwei widerspr\u00fcchlichen Lieferadressen zur sofortigen Bearbeitung \u00fcbergibt',
    opening: 'Der Auftrag muss heute raus. Im Formular steht K\u00f6ln, in der letzten Nachricht aber Bonn. Welche Adresse tragen Sie ein?',
    situation: 'Zwei Quellen enthalten widerspr\u00fcchliche Adressen; der Kandidat muss den Konflikt benennen, die richtige Quelle verifizieren und den dokumentierten n\u00e4chsten Schritt best\u00e4tigen.',
    skill: 'Datenkonflikt erkennen + verifizieren + \u00c4nderung nachvollziehbar best\u00e4tigen',
    keyPhrases: ['Ich \u00fcbernehme keine der beiden Adressen ungepr\u00fcft.', 'Welche Quelle ist f\u00fcr die Freigabe verbindlich?',
      'Ich dokumentiere die best\u00e4tigte Adresse und den Pr\u00fcfvermerk im Vorgang.'],
  }),
  Object.freeze({
    id: 'backoffice-missing-reference', roleType: 'backoffice',
    customer: 'ein deutscher Kollege, der eine dringende Gutschrift ohne vollst\u00e4ndige Referenznummer freigeben lassen will',
    opening: 'Die Gutschrift ist dringend, aber mir fehlen die letzten zwei Stellen der Referenz. K\u00f6nnen Sie sie trotzdem jetzt buchen?',
    situation: 'Eine Buchung ist unvollst\u00e4ndig; der Kandidat muss die fehlende Information identifizieren, die Bearbeitung begrenzen und den Vorgang sauber nachverfolgen.',
    skill: 'Pflichtfeld erkennen + keine Daten erfinden + klaren Kl\u00e4rungsschritt dokumentieren',
    keyPhrases: ['Ohne die vollst\u00e4ndige Referenz buche ich den Vorgang nicht.', 'Bitte best\u00e4tigen Sie mir die fehlenden zwei Stellen \u00fcber die freigegebene Quelle.',
      'Bis dahin kennzeichne ich den Vorgang als wartend und dokumentiere den Grund.'],
  }),
]);

const scenariosById = new Map(CS_SCENARIOS.map((scenario) => [scenario.id, scenario]));
const roleCopies = (ids, roleType) => ids.map((id) => Object.freeze({ ...scenariosById.get(id), roleType })).filter((item) => item.id);
export const TARGET_ROLE_SCENARIOS = Object.freeze({
  technical_support: Object.freeze([...TECHNICAL_ROLEPLAY_SCENARIOS,
    ...roleCopies(['telecom-portierung', 'tech-router-stoerung'], 'technical_support')]),
  retention: Object.freeze(roleCopies(['cancellation-retention', 'telecom-kuendigung'], 'retention')),
  sales: SALES_ROLEPLAY_SCENARIOS,
  backoffice: BACKOFFICE_ROLEPLAY_SCENARIOS,
});

const CUSTOMER_SERVICE_SCENARIO_IDS = new Set(CS_SCENARIOS.map((scenario) => scenario.id));
/** Server registry check used when persisted evidence is read back. */
export function scenarioSupportsRole(scenarioId, roleType) {
  if (typeof scenarioId !== 'string' || !/^[a-z0-9_-]{1,80}$/u.test(scenarioId)) return false;
  if (roleType === 'customer_service') return CUSTOMER_SERVICE_SCENARIO_IDS.has(scenarioId);
  if (!Object.hasOwn(TARGET_ROLE_SCENARIOS, roleType)) return false;
  return TARGET_ROLE_SCENARIOS[roleType].some((scenario) => scenario.id === scenarioId);
}

function scenarioForRole(scenarioId, roleType) {
  if (!scenarioSupportsRole(scenarioId, roleType)) return null;
  if (roleType === 'customer_service') return CS_SCENARIOS.find((scenario) => scenario.id === scenarioId) || null;
  return TARGET_ROLE_SCENARIOS[roleType].find((scenario) => scenario.id === scenarioId) || null;
}

// ── The winning behavior the roleplay rewards ───────────────────────────────────
export const CS_RUBRIC =
  `Belohne dieses Verhalten und gib langsam nach, wenn der Kandidat es zeigt: zuerst ECHTE EMPATHIE, ` +
  `dann VERANTWORTUNG übernehmen, dann gezielt FAKTEN erfragen, und schließlich einen KLAREN NÄCHSTEN ` +
  `SCHRITT anbieten — in korrektem, höflichem Deutsch (Sie-Form, Konjunktiv II: "Könnten Sie mir bitte…", ` +
  `"Ich würde vorschlagen…"). Bleib hart, wenn der Kandidat Schuld zuweist, Ausreden bringt, unhöflich ` +
  `oder unklar antwortet oder ins Englische wechselt. ` +
  `Starke C1-Sprache, die du erkennst und extra belohnst: ` +
  `"Ich kann Ihren Ärger sehr gut nachvollziehen", "Darf ich kurz zusammenfassen?", ` +
  `"Ich nehme Ihr Anliegen sehr ernst", "Was ich konkret für Sie tun kann, ist Folgendes:", ` +
  `"Ich kann zwar das Geschehene nicht rückgängig machen, aber…", "Bleiben wir bitte sachlich", ` +
  `"Ich verspreche Ihnen, dass ich persönlich dranbleibe". ` +
  // QA-scorecard alignment (KB §8C, 2026-07-10): real floors grade the CLOSING pair and hold
  // etiquette explicitly, and treat a wrong binding promise as an auto-fail-class error. The boss
  // rewards/punishes these IN the roleplay; the deterministic scorer stays untouched.
  `Belohne außerdem den professionellen GESPRÄCHSABSCHLUSS — eine kurze Zusammenfassung PLUS die ` +
  `Abschlussfrage („Kann ich sonst noch etwas für Sie tun?") — und korrekte WARTESCHLEIFEN-Etikette: ` +
  `um Erlaubnis fragen („Darf ich Sie kurz in die Warteschleife legen?"), eine Zeitangabe machen, ` +
  `nach dem Warten danken. Reagiere dagegen spürbar verärgert, wenn der Kandidat etwas verbindlich ` +
  `zusagt, das er nicht halten kann — ein falsches Versprechen zu Fristen oder Erstattungen wiegt ` +
  `auf einem echten Floor schwerer als jeder Grammatikfehler.`;

// ── Datenschutz / identity-verification rubric (GDPR realism on a German line) ───
// On a real German customer line the agent may NOT touch account data before
// verifying identity. The customer must therefore NOT volunteer their data, and must
// reward the candidate who asks for it correctly. This is the single most authentic
// compliance behavior a German BPO floor tests — and a silent day-1 failure if missed.
export const DATA_VERIFICATION_RUBRIC =
  `DATENSCHUTZ / IDENTITÄTSPRÜFUNG (Realismus + Compliance, sehr wichtig): ` +
  `Gib als Kunde deine persönlichen Daten — Name, Geburtsdatum, Kunden- oder Vertragsnummer — NIEMALS von selbst preis. ` +
  `Sobald der Kandidat anfängt, an deinem Konto zu handeln (Rückerstattung einleiten, Vertrag ändern, Kontodaten nennen), ` +
  `OHNE vorher deine Identität bestätigt zu haben, baue einen kleinen realistischen Reibungspunkt ein: zögere kurz oder frage ` +
  `misstrauisch „Wozu brauchen Sie das denn?". Belohne es dann deutlich (werde ruhiger, kooperativer), wenn der Kandidat ` +
  `höflich erklärt, dass er aus Datenschutzgründen ZUERST die Identität prüfen muss — und zwar über ein ` +
  `ECHTES Sicherheitsmerkmal: Service-PIN bzw. Kundenkennwort (oder eine TAN). Name + Geburtsdatum allein ` +
  `genügen NICHT (der deutsche Datenschutz wertet das als unzureichend) ` +
  `(„Aus Datenschutzgründen muss ich zunächst kurz Ihre Identität bestätigen — nennen Sie mir bitte Ihre Service-PIN bzw. Ihr Kundenkennwort?"). ` +
  `Belohne es zusätzlich, wenn der Kandidat sich weigert, Kontodaten zu nennen oder Änderungen vorzunehmen, BEVOR diese Prüfung bestanden ist. ` +
  `Wenn der Kandidat einfach ohne jede Prüfung Kontodaten herausgibt oder Änderungen zusagt, bleibe als Kunde zufrieden — ` +
  `aber benenne den Fehler NIEMALS selbst; er wird später im Feedback gewertet. Erwähne diese Regel nie als Metakommentar.`;

// ── Multi-turn CS lifecycle rubric ───────────────────────────────────────────────
// Real BPO calls rarely end after one complaint. This rubric governs Phase 3b: once
// the candidate has successfully de-escalated the opening complaint (customer softens),
// introduce a SECOND concern or test the wrap-up/ticket step.
export const CS_LIFECYCLE_RUBRIC =
  `ZWEI-PHASEN-ROLLENSPIEL (wichtig für Realismus): ` +
  `Wenn der Kandidat die erste Beschwerde erfolgreich deeskaliert hat (Empathie gezeigt, Lösung angeboten, ` +
  `Kunde ist deutlich ruhiger geworden), wechsle in Phase 2: ` +
  `Bringe EINE weitere realistische Anforderung ins Spiel — entweder ` +
  `(a) eine zweite, kleinere Beschwerde ("Übrigens, ich hatte letzte Woche auch noch ein Problem mit der Rechnung"), ` +
  `(b) eine Frage nach Kompensation ("Bekommen wir dafür irgendeine Entschädigung?"), oder ` +
  `(c) eine Bitte um Bestätigung/Ticket ("Bekomme ich das schriftlich?"). ` +
  `Wähle GENAU EINE dieser drei — die, die am natürlichsten zur Situation passt. ` +
  `Belohne den Kandidaten, der auch die zweite Phase professionell abwickelt (Verständnis, Klärung, Zusage). ` +
  `Überfordere nicht: wenn die erste Phase sehr lange gedauert hat oder der Kandidat sichtlich erschöpft ist, ` +
  `lasse Phase 2 weg und schließe stattdessen mit einem kurzen "Danke, ich warte auf Ihre Rückmeldung." ab.`;

// ── Drucktest: the ONE deliberate pressure spike ────────────────────────────────
// The C1-floor hiring verdict (panelscorer) turns on whether the candidate HOLDS their
// German under pressure or collapses — but the grader can only judge that if the transcript
// actually CONTAINS a pressure moment. This rubric makes the boss engineer exactly one,
// in-role and fair, so "held up" vs "broke down" becomes visible evidence instead of luck.
export const DRUCKTEST_RUBRIC =
  `DRUCKMOMENT (genau EINMAL — der eigentliche Prüfstein, sehr wichtig): ` +
  `Wenn das Rollenspiel in Gang ist, baue als Kunde GENAU EINEN echten Druckmoment ein — den Moment, der zeigt, ` +
  `ob der Kandidat sein Deutsch unter Stress HÄLT oder einbricht. Eskaliere dafür kurz und scharf: erhöhe Tempo und ` +
  `Dringlichkeit, stapele eine plötzliche Komplikation obendrauf und VERLANGE sofort eine klare, konkrete Antwort ` +
  `(z.B. „Moment — dafür habe ich jetzt wirklich keine Zeit. Sagen Sie mir SOFORT in EINEM Satz, was Sie konkret tun, ` +
  `sonst lasse ich mich mit Ihrem Vorgesetzten verbinden."). Wird der Kandidat vage oder ausweichend, UNTERBRICH ihn ` +
  `dieses eine Mal („Nein — konkret bitte, keine Floskeln."). ` +
  `DAMIT ES FAIR BLEIBT: Der Druck gilt der SITUATION (Zeitnot, Forderung, Eskalationsdrohung), NIEMALS der Person — ` +
  `werde nie beleidigend und mach dich nie über Akzent oder Grammatikfehler lustig. Passe die Härte an das Niveau an: ` +
  `bei niedrigem Niveau ein spürbarer, aber bewältigbarer Stups; bei C1 ein echter harter Curveball. ` +
  `Tu dies nur EINMAL pro Sitzung und kündige es NIEMALS als Metakommentar an. ` +
  `Hält der Kandidat ruhig, strukturiert und in klarem Deutsch stand, BELOHNE das deutlich — werde merklich ruhiger und ` +
  `kooperativer, damit im Gesprächsverlauf sichtbar wird, dass er dem Druck gewachsen war.`;

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

  // ── Industry terminology (KB v1, docs/kb/GERMAN-BPO-KB.md) — the words real German accounts
  // run on (telecom, e-commerce, fintech, airline, delivery, logistics, energy, insurance,
  // tech support, B2B). Seeded into the same SRS pool; drills deepen automatically. ──
  { de: 'Ihre Kündigungsfrist läuft zum Ende des Monats.', en: 'Your cancellation notice period runs until the end of the month.', drill: 'Mobilfunk-Wortschatz: erkläre einem Kunden „Kündigungsfrist" in einem Satz.' },
  { de: 'Ich kann Ihnen eine Vertragsverlängerung mit besseren Konditionen anbieten.', en: 'I can offer you a contract renewal with better conditions.', drill: 'Übe das Rückgewinnungsangebot: nenne EINEN konkreten Vorteil dazu.' },
  { de: 'Die Rufnummernmitnahme dauert in der Regel drei Werktage.', en: 'Porting your phone number usually takes three working days.', drill: 'Sag den Satz und ersetze „in der Regel" durch „normalerweise".' },
  { de: 'Ihr Datenvolumen ist aufgebraucht, deshalb ist die Geschwindigkeit gedrosselt.', en: 'Your data volume is used up, which is why the speed is throttled.', drill: 'Erkläre „Drosselung" so, dass es auch ein Laie versteht.' },
  { de: 'Ich sende Ihnen ein neues Retourenlabel per E-Mail zu.', en: 'I will email you a new return label.', drill: 'E-Commerce: verbinde den Satz mit einer Zeitangabe („innerhalb von …").' },
  { de: 'Sobald die Rücksendung eingeht, veranlassen wir die Erstattung.', en: 'As soon as the return arrives, we initiate the refund.', drill: 'Übe die „sobald …"-Struktur mit zwei eigenen Beispielen.' },
  { de: 'Laut Sendungsverfolgung wurde das Paket heute Morgen zugestellt.', en: 'According to the tracking, the parcel was delivered this morning.', drill: 'Beginne drei Sätze mit „Laut …" (Sendungsverfolgung, System, Kollege).' },
  { de: 'Auf dieses Gerät haben Sie noch zwölf Monate Gewährleistung.', en: 'You still have twelve months of statutory warranty on this device.', drill: 'Erkläre den Unterschied: Gewährleistung (gesetzlich) vs. Garantie (freiwillig).' },
  { de: 'Ich leite die Rückbuchung des doppelt abgebuchten Betrags ein.', en: 'I am initiating the chargeback of the amount that was debited twice.', drill: 'Fintech: sage dem Kunden auch, WANN das Geld zurück ist.' },
  { de: 'Zur Sicherheit müssen wir zuerst Ihre Identität verifizieren.', en: 'For security, we first need to verify your identity.', drill: 'Bitte höflich um zwei Angaben zur Identitätsprüfung.' },
  { de: 'Ihr Konto wurde vorübergehend gesperrt, um es zu schützen.', en: 'Your account was temporarily locked in order to protect it.', drill: 'Übe die beruhigende Begründung: „…, um … zu …".' },
  { de: 'Bitte geben Sie die Zahlung niemals telefonisch mit Ihrer TAN frei.', en: 'Please never approve the payment over the phone with your TAN.', drill: 'Warne einen Kunden freundlich vor Phishing — zwei Sätze.' },
  { de: 'Ich kann Sie kostenlos auf einen früheren Flug umbuchen.', en: 'I can rebook you onto an earlier flight free of charge.', drill: 'Airline: biete zwei Alternativen an („entweder … oder …").' },
  { de: 'Bei einer Verspätung über drei Stunden steht Ihnen eine Entschädigung zu.', en: 'For a delay of more than three hours you are entitled to compensation.', drill: 'Übe „Ihnen steht … zu" mit Erstattung und Entschädigung.' },
  { de: 'Ihre Verlustmeldung für das Gepäck habe ich aufgenommen.', en: 'I have recorded your lost-luggage report.', drill: 'Fasse zusammen: Was wurde gemeldet, was passiert als Nächstes?' },
  { de: 'Die fehlenden Artikel erstatte ich Ihnen selbstverständlich vollständig.', en: 'Of course I will fully refund the missing items.', drill: 'Delivery: kombiniere Erstattung + Gutschrift in einem Satz.' },
  { de: 'Ihr Paket liegt sieben Werktage in der Abholstation für Sie bereit.', en: 'Your parcel will be held for you at the pickup point for seven working days.', drill: 'Logistik: erkläre einem Kunden den Weg zur Packstation.' },
  { de: 'Ich beauftrage für morgen einen erneuten Zustellversuch.', en: 'I am arranging another delivery attempt for tomorrow.', drill: 'Übe „beauftragen" in zwei Service-Sätzen.' },
  { de: 'Bitte teilen Sie mir Ihren aktuellen Zählerstand mit.', en: 'Please give me your current meter reading.', drill: 'Energie: bitte um den Zählerstand UND erkläre wofür.' },
  { de: 'Ihre Abschlagszahlung passe ich an Ihren tatsächlichen Verbrauch an.', en: 'I am adjusting your monthly installment to your actual consumption.', drill: 'Erkläre „Abschlag" und „Jahresabrechnung" in je einem Satz.' },
  { de: 'Für die Nachzahlung kann ich Ihnen eine Ratenzahlung einrichten.', en: 'I can set up an installment plan for the outstanding amount.', drill: 'Biete die Ratenzahlung als Entlastung an — freundlich, nicht förmlich.' },
  { de: 'Ihre Schadensmeldung ist eingegangen und wird von der Fachabteilung geprüft.', en: 'Your damage claim has been received and is being reviewed by the specialist department.', drill: 'Versicherung: nenne dem Kunden die nächsten zwei Schritte.' },
  { de: 'Bitte setzen Sie den Router einmal auf die Werkseinstellungen zurück.', en: 'Please reset the router to factory settings once.', drill: 'Tech-Support: führe den Kunden in drei kurzen Schritten durch den Reset.' },
  { de: 'Ich reiche Ihren Widerspruch gegen die Kontosperrung mit Priorität ein.', en: 'I am submitting your appeal against the account suspension with priority.', drill: 'B2B: bestätige Dringlichkeit + nenne die Antwortfrist.' },
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

// No-repeat picker: never serves an id already in `seen` until the pool is exhausted, then
// resets the cycle (reset:true → the caller persists a fresh seen-list starting at this pick).
// Mirrors the shadowing/fluency no-repeat contract so EVERY interview feels new — a returning
// candidate gets a different behavioral question, screening filter and customer scenario each
// time, never the same opening twice in a row, until the whole pool has been seen.
function pickFresh(arr, seen, idOf) {
  if (!arr.length) return { item: null, id: null, reset: false };
  const seenSet = new Set(seen || []);
  let unseen = arr.filter((x) => !seenSet.has(idOf(x)));
  let reset = false;
  if (!unseen.length) { unseen = arr; reset = true; }
  const item = unseen[Math.floor(Math.random() * unseen.length)];
  return { item, id: idOf(item), reset };
}

// ── Ziel-Stelle (owner-approved 2026-07-10): the industries a candidate can target ────────────
// Keys match the `industry` tags on the KB scenarios below; labels are learner-visible German.
// Source: docs/kb/GERMAN-BPO-KB.md — the 10 account types actually run from Cairo/nearshore hubs.
// Brands stay anonymous everywhere (owner doctrine): industries, never company names.
export const INDUSTRIES = {
  telecom:      'Telekommunikation & Internet',
  ecommerce:    'E-Commerce & Handel',
  fintech:      'Banken & Fintech',
  airline:      'Airlines & Reisen',
  delivery:     'Lieferdienste',
  logistik:     'Logistik & Versand',
  energie:      'Energie',
  versicherung: 'Versicherungen',
  streaming:    'Streaming & Abo-Dienste',
  b2b:          'B2B & Werbekonten',
};

// Ziel-Stelle-aware scenario pick, layered on the same pickFresh no-repeat rule:
// 1) unseen scenarios of the TARGET industry first (the paid promise: "your account type"),
// 2) then unseen from the global pool (variety beats repetition once the industry is exhausted),
// 3) only when EVERYTHING is seen, cycle — inside the target industry again.
// No target (or unknown key) ⇒ byte-identical behavior to the old global pickFresh.
export function pickCsScenario(recentCs, targetIndustry = null, excludedScenarioIds = []) {
  const excluded = new Set(Array.isArray(excludedScenarioIds) ? excludedScenarioIds : []);
  if (excluded.size) {
    const available = CS_SCENARIOS.filter((scenario) => !excluded.has(scenario.id));
    const validIndustry = targetIndustry && Object.hasOwn(INDUSTRIES, targetIndustry);
    const industryPool = validIndustry
      ? available.filter((scenario) => scenario.industry === targetIndustry) : [];
    const originalIndustryPool = validIndustry
      ? CS_SCENARIOS.filter((scenario) => scenario.industry === targetIndustry) : [];
    const pool = industryPool.length ? industryPool
      : originalIndustryPool.length ? originalIndustryPool : available;
    return pickFresh(pool, recentCs, (scenario) => scenario.id);
  }
  // hasOwn guard (defense in depth vs. already-stored prototype keys): an inherited key would
  // filter to an empty pool anyway, but keep the contract explicit — unknown key ⇒ global pick.
  const pool = targetIndustry && Object.hasOwn(INDUSTRIES, targetIndustry)
    ? CS_SCENARIOS.filter((s) => s.industry === targetIndustry) : [];
  if (!pool.length) return pickFresh(CS_SCENARIOS, recentCs, (x) => x.id);
  return pickFresh(pool, recentCs, (x) => x.id);
}

/** Vacancy-only role-first selection. Unknown/customer-service roles preserve the legacy picker. */
export function pickTargetRoleScenario(recentCs, targetIndustry = null, targetRoleType = null, excludedScenarioIds = []) {
  if (!targetRoleType || targetRoleType === 'customer_service' || !Object.hasOwn(TARGET_ROLE_SCENARIOS, targetRoleType)) {
    return pickCsScenario(recentCs, targetIndustry, excludedScenarioIds);
  }
  const excluded = new Set(Array.isArray(excludedScenarioIds) ? excludedScenarioIds : []);
  const rolePool = TARGET_ROLE_SCENARIOS[targetRoleType].filter((scenario) => !excluded.has(scenario.id));
  const validIndustry = targetIndustry && Object.hasOwn(INDUSTRIES, targetIndustry);
  const industryPool = validIndustry
    ? rolePool.filter((scenario) => scenario.industry === targetIndustry) : [];
  const genericPool = rolePool.filter((scenario) => scenario.industry === undefined);
  // A vacancy with no role+industry case gets a generic case for that role, never a different
  // industry's facts. Exact-industry exhaustion cycles inside that industry for the same reason.
  const preferred = industryPool.length ? industryPool : genericPool.length ? genericPool
    : excluded.size ? rolePool : genericPool;
  if (!preferred.length) return pickCsScenario(recentCs, null);
  return pickFresh(preferred, recentCs, (scenario) => scenario.id);
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
  const beginner = levelId === 'a2-b1';
  const c1       = levelId === 'c1';
  const moodLine = MOODS[mood] || MOODS.neutral;

  const common =
    `SPRECHWEISE — klinge wie ein ECHTER, leicht gestresster deutscher HR-Mensch am Telefon, nicht wie ein Vorleser:\n` +
    `- Streue natürliche Verzögerungslaute sparsam ein: „ähm", „also", „ja", „Moment", „gut", „genau" — das sind ` +
    `  MUTTERSPRACHLICHE Füllwörter, KEINE Fehler. Dein Deutsch bleibt grammatikalisch korrekt und nativ.\n` +
    `- Kurze Selbstkorrekturen und Mikro-Pausen sind erlaubt („Ich meine… also konkret:"). Nutze „…" für kurze Pausen.\n` +
    `- Gib WÄHREND und NACH der Antwort des Kandidaten kurze Hörersignale (Backchannels): „mhm", „ja", ` +
    `  „genau" — kurz, nie ganze Sätze, NIE als Anfang deines eigenen Redebeitrags, und unterbrich damit NICHT.\n` +
    `- Gelegentlich ein nonverbales Signal: ein kurzer Seufzer oder „hmm" — selten, dezent.\n` +
    `- ANGEMESSENHEIT: sprich im gesprochenen Register, das ZU DEINER ROLLE passt. Lockere Rollen (z.B. ein junger ` +
    `Kollege) dürfen Kontraktionen wie „gibt's", „haben Sie's" nutzen; formelle, strenge oder hochrangige Rollen ` +
    `(z.B. eine Geschäftsführerin, ein Direktor) bleiben in gehobener gesprochener Hochsprache OHNE saloppe ` +
    `Kontraktionen. Wähle immer das, was für DEINE konkrete Figur natürlich wäre — nicht ein Einheitston für alle.`;

  const scaled = c1
    ? `TEMPO/TON für dieses Niveau (C1): gehobenes, professionelles Register, zügig und präzise. ` +
      `Spürbar anspruchsvoller als B2 — erwarte STAR-Antworten (Situation, Aufgabe, Aktion, Ergebnis). ` +
      `Hake bei vagen Antworten sofort nach: "Und welches konkrete Ergebnis hatten Ihre Maßnahmen?". ` +
      `Lob nur für tatsächlich gehobene Formulierungen; bewusstes Schweigen nach Antworten signalisiert Erwartung von mehr.`
    : beginner
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
 * @param {{ persona:string, displayName:string, greeting:string, levelId?:string, candidateName?:string }} opts
 * @returns {{ instructions:string, openingLine:string, level:{id:string,label:string},
 *             behavioral:string, csScenario:object, stages:Array<{id,label,prompt}> }}
 */
// ── Opening pair picker (ROADMAP #19) — pure, exported for tests ────────────────────────────
// Seeded pick of ONE greeting variant (per-boss pool, so the product's first sentence is no
// longer its most-repeated sentence) + ONE intro variant whose SCENE does not contradict it:
// an in-person greeting ("Setzen Sie sich…") never pairs with a phone-framed intro ("Die
// Verbindung steht…") and vice versa. Accepts a plain string greeting for back-compat.
export function pickOpeningPair(greetings, intros, sessionSeed = '') {
  const norm = (x) => (typeof x === 'string' ? { text: x, scene: /setzen sie sich|nehmen sie (doch )?platz|komm rein/i.test(x) ? 'person' : 'neutral' } : x);
  const gPool = (Array.isArray(greetings) ? greetings : [greetings]).filter(Boolean).map(norm);
  const iPool = (Array.isArray(intros) ? intros : [intros]).filter(Boolean).map(norm);
  if (!gPool.length) gPool.push({ text: 'Guten Tag.', scene: 'neutral' });

  let h = 2166136261 >>> 0;
  for (const ch of String(sessionSeed || 'x')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const g = gPool[(h >>> 0) % gPool.length];

  const conflict = (a, b) => (a === 'person' && b === 'phone') || (a === 'phone' && b === 'person');
  const fits = iPool.filter((i) => !conflict(g.scene, i.scene));
  const use  = fits.length ? fits : iPool;
  const i    = use[(Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0) % use.length] || { text: '', scene: 'neutral' };
  return { greeting: g.text, intro: i.text, scenes: { greeting: g.scene, intro: i.scene } };
}

const VACANCY_ROLE_LABELS = Object.freeze({
  customer_service:  'deutschsprachigen Kundenservice',
  technical_support: 'deutschsprachigen technischen Support',
  sales:             'deutschsprachigen Vertrieb',
  retention:         'Kundenbindung und R\u00fcckgewinnung',
  backoffice:        'deutschsprachiges Backoffice',
});

const VACANCY_SKILL_GUIDANCE = Object.freeze({
  self_intro:          'eine klare, kurze Selbstvorstellung',
  motivation:          'glaubw\u00fcrdige Motivation f\u00fcr die Rolle',
  availability:        'Verf\u00fcgbarkeit und Schichtflexibilit\u00e4t',
  star_story:          'ein konkretes STAR-Beispiel aus der Arbeit',
  data_capture:        'genaue Datenerfassung und aktives Zuh\u00f6ren',
  deescalation:        'ruhige Deeskalation unter Druck',
  objection_handling:  'professioneller Umgang mit Einw\u00e4nden',
  closing:             'ein klarer Gespr\u00e4chsabschluss',
});

const VACANCY_TOPIC_GUIDANCE = Object.freeze({
  self_introduction:   'Selbstvorstellung',
  motivation:          'Motivation f\u00fcr die Rollenart',
  work_experience:     'einschl\u00e4gige Berufserfahrung',
  shift_flexibility:   'Schicht- und Startverf\u00fcgbarkeit',
  customer_escalation: 'Umgang mit einer Kundeneskalation',
  data_accuracy:       'genaue Aufnahme und Best\u00e4tigung von Kundendaten',
  sales_objection:     'Umgang mit einem Verkaufseinwand',
  technical_triage:   'strukturierte technische Erstdiagnose',
  closing_questions:  'professionelle Abschlussfragen',
});

/**
 * Convert a server-owned, enum-only vacancy snapshot into one bounded prompt block.
 * Free-form vacancy text and employer names are intentionally not accepted here.
 */
export function buildVacancyInstruction(jobContext) {
  if (!jobContext || typeof jobContext !== 'object') return '';
  const role = Object.hasOwn(VACANCY_ROLE_LABELS, jobContext.roleType)
    ? VACANCY_ROLE_LABELS[jobContext.roleType] : null;
  if (!role) return '';

  const uniqKnown = (values, table, max) => [...new Set(Array.isArray(values) ? values : [])]
    .filter((id) => Object.hasOwn(table, id)).slice(0, max).map((id) => table[id]);
  const skills = uniqKnown(jobContext.skillIds, VACANCY_SKILL_GUIDANCE, 4);
  const topics = uniqKnown(jobContext.questionTopicIds, VACANCY_TOPIC_GUIDANCE, 4);
  const levelLabels = {
    'a2-b1': 'A2 bis B1', b2: 'B2', c1: 'C1', unspecified: '',
  };
  const advertisedLevel = Object.hasOwn(levelLabels, jobContext.germanLevel)
    ? levelLabels[jobContext.germanLevel] : '';

  return `\nSTELLENANZEIGEN-FOKUS (aus einer serverseitig validierten, anonymisierten Zusammenfassung): ` +
    `Trainiere f\u00fcr eine Stelle im Bereich ${role}. ` +
    (advertisedLevel ? `Die Anzeige nennt Deutsch auf Niveau ${advertisedLevel}; die festgelegte Gespr\u00e4chsschwierigkeit bleibt trotzdem unver\u00e4ndert. ` : '') +
    (skills.length ? `Pr\u00fcfe besonders: ${skills.join(', ')}. ` : '') +
    (topics.length ? `Verteile diese Themen nat\u00fcrlich auf die bestehenden drei Teile: ${topics.join(', ')}. ` : '') +
    `Behaupte nie, echte interne Fragen des Arbeitgebers zu kennen, nenne keinen Firmennamen und f\u00fcge keinen vierten Gespr\u00e4chsteil hinzu.\n`;
}

const TARGET_STAGE_LABELS = Object.freeze({
  technical_support: 'Teil 3 · Technischer Support', sales: 'Teil 3 · Vertrieb',
  retention: 'Teil 3 · Kundenbindung', backoffice: 'Teil 3 · Backoffice',
});

function targetRoleplayInstruction(roleType, scenario) {
  if (!Object.hasOwn(TARGET_STAGE_LABELS, roleType) || !scenario) return '';
  const pressure = `Baue genau EINMAL realistischen Zeitdruck oder eine neue Komplikation ein. ` +
    `Der Druck gilt der Situation, niemals der Person; keine Beleidigung und kein Spott \u00fcber Akzent oder Grammatik. ` +
    `Verlange eine kurze konkrete Antwort und werde kooperativer, wenn der Kandidat strukturiert reagiert.`;
  const roleRules = {
    technical_support: `Der Kandidat muss das Problem zuerst knapp zusammenfassen, dann mindestens EINE gezielte ` +
      `Diagnosefrage stellen und erst danach einen sicheren Schritt erkl\u00e4ren. Belohne klare Reihenfolge, eine ` +
      `Verst\u00e4ndnispr\u00fcfung und einen dokumentierbaren n\u00e4chsten Schritt. Gib keine technischen Fakten vor, die nicht im Szenario stehen.`,
    sales: `Der Kandidat muss den Einwand anerkennen, mindestens EINE echte Bedarfsfrage stellen und nur danach ` +
      `einen passenden Nutzen oder n\u00e4chsten Schritt anbieten. Belohne Respekt vor einem Nein; bestrafe Druck, erfundene ` +
      `Vorteile, unhaltbare Versprechen und einen Abschluss ohne gekl\u00e4rten Bedarf.`,
    retention: `Der Kandidat muss den K\u00fcndigungsgrund anerkennen, mindestens EINE kl\u00e4rende Frage stellen und nur mit ` +
      `Erlaubnis eine passende Alternative anbieten. Belohne einen respektvollen Abschluss auch dann, wenn du bei der ` +
      `K\u00fcndigung bleibst; bestrafe Druck, Schuldzuweisung und erfundene Konditionen.`,
    backoffice: `Der Kandidat muss den Datenkonflikt oder das fehlende Pflichtfeld ausdr\u00fccklich benennen, die verbindliche ` +
      `Quelle erfragen und den dokumentierten n\u00e4chsten Schritt zusammenfassen. Belohne Genauigkeit und Nachvollziehbarkeit; ` +
      `bestrafe geratenen Inhalt, ungepr\u00fcfte \u00c4nderungen und erfundene Freigaben.`,
  };
  const counterpart = roleType === 'backoffice' ? 'Gespr\u00e4chspartner' : roleType === 'sales' ? 'potenzielle Kunde' : 'Kunde';
  return `${TARGET_STAGE_LABELS[roleType].toUpperCase()} (Hauptteil, der Rest der Sitzung):
K\u00dcNDIGE DEN WECHSEL ZUERST KURZ UND NAT\u00dcRLICH AN. Danach spielst du ausschlie\u00dflich ${scenario.customer}.
Du bist NUR der ${counterpart} \u2014 niemals der Agent/Kandidat. Er\u00f6ffne mit: "${scenario.opening}" und WARTE auf die Reaktion.
Bleibe in dieser Rolle und reagiere auf das, was der Kandidat tats\u00e4chlich sagt. ${roleRules[roleType]}
${pressure}`;
}

export function buildSessionScript({ persona, displayName, greeting, greetings = null, levelId, dossier, memory, candidateName, focusTitle, mood = 'neutral', clarificationRate = 0, recent = {}, sessionSeed = '', targetIndustry = null, jobContext = null, revanche = null, retestProbe = null, forcedScenarioId = null, excludedScenarioIds = [], forcedBehavioralPromptId = null, excludedBehavioralPromptIds = [], forcedScreeningPromptId = null, excludedScreeningPromptIds = [] }) {
  const level      = LEVELS[levelId] ?? LEVELS['a2-b1'];
  // NO-REPEAT content: avoid every behavioral question, screening filter and customer
  // scenario the candidate has already faced (recent.* = persisted seen-id lists) until the
  // pool is exhausted, then cycle. This is what makes a re-played interview feel real.
  const rawBehPool = levelId === 'c1' ? C1_BEHAVIORAL_QUESTIONS : BEHAVIORAL_QUESTIONS;
  const forcedBehavioral = forcedBehavioralPromptId
    ? interviewPromptById('behavioral', forcedBehavioralPromptId, level.id) : null;
  const forcedScreening = forcedScreeningPromptId
    ? interviewPromptById('screening', forcedScreeningPromptId, level.id) : null;
  if (forcedBehavioralPromptId && !forcedBehavioral) throw new Error('invalid_forced_behavioral_prompt');
  if (forcedScreeningPromptId && !forcedScreening) throw new Error('invalid_forced_screening_prompt');
  const excludedBehavioral = new Set(Array.isArray(excludedBehavioralPromptIds) ? excludedBehavioralPromptIds : []);
  const excludedScreening = new Set(Array.isArray(excludedScreeningPromptIds) ? excludedScreeningPromptIds : []);
  const behPool = excludedBehavioral.size
    ? rawBehPool.filter((text) => !excludedBehavioral.has(interviewPromptId('behavioral', text, level.id))) : rawBehPool;
  const scrPool = excludedScreening.size
    ? BPO_SCREENING_QUESTIONS.filter((text) => !excludedScreening.has(interviewPromptId('screening', text, level.id)))
    : BPO_SCREENING_QUESTIONS;
  if (!forcedBehavioral && !behPool.length) throw new Error('no_novel_behavioral_prompt');
  if (!forcedScreening && !scrPool.length) throw new Error('no_novel_screening_prompt');
  const behPick    = forcedBehavioral ? { item: forcedBehavioral, id: forcedBehavioral, reset: false }
    : pickFresh(behPool, recent.behavioral, (x) => x);
  const scrPick    = forcedScreening ? { item: forcedScreening, id: forcedScreening, reset: false }
    : pickFresh(scrPool, recent.screening, (x) => x);
  const targetRoleType = jobContext && typeof jobContext === 'object'
    && Object.hasOwn(VACANCY_ROLE_LABELS, jobContext.roleType) ? jobContext.roleType : null;
  const forcedScenario = typeof forcedScenarioId === 'string'
    ? scenarioForRole(forcedScenarioId, targetRoleType || 'customer_service') : null;
  const csPick     = forcedScenario
    ? { item: forcedScenario, id: forcedScenario.id, reset: false }
    : targetRoleType
      ? pickTargetRoleScenario(recent.cs, targetIndustry, targetRoleType, excludedScenarioIds)
      : pickCsScenario(recent.cs, targetIndustry, excludedScenarioIds);   // no vacancy context: legacy industry/global rotation
  const behavioral = behPick.item;
  const screening  = scrPick.item;
  const cs         = csPick.item;
  const delivery   = deliveryBlock(level.id, mood, clarificationRate);  // Phase 1 prosody/mood

  // Memory dossier → GEZIELTER WIEDERHOLUNGSTEST (closes the learning loop): the recurring weak
  // area from past sessions isn't just mentioned for atmosphere — the boss must actively ENGINEER
  // one moment that forces the candidate to demonstrate exactly that weakness, so the interview
  // really re-tests whether they improved instead of asking random questions.
  const dossierLine = dossier
    ? `\nDOSSIER (aus früheren Gesprächen) — GEZIELTER WIEDERHOLUNGSTEST: Der Kandidat hatte wiederholt Schwierigkeiten mit "${dossier}". ` +
      `Erwähne das EINMAL kurz und kühl früh im Gespräch (z.B. "Ihre Akte zeigt Schwächen bei ${dossier} — zeigen Sie mir, dass sich das gebessert hat."). ` +
      `WICHTIG — belass es NICHT bei der Erwähnung: Baue im Gesprächsverlauf GEZIELT EINE natürliche Situation oder Nachfrage ein, die den Kandidaten ZWINGT, genau diese Schwäche ("${dossier}") zu zeigen — etwa eine Rückfrage, ein Beispiel oder ein Rollenspiel-Moment, der genau diese Struktur bzw. Fähigkeit erfordert. So prüfst du ECHT, ob er sich verbessert hat, statt es nur zu erwähnen. Halte es natürlich im Gesprächsfluss, tue es nur EINMAL gezielt und übertreibe es nicht.\n`
    : '';

  // A post-drill retest must elicit the prescribed micro-skill without telling the learner what to
  // demonstrate. This is an assessor-only probe: no announcement, hint, praise, or wording from the
  // prescription may be spoken. Generic interviews receive no block and remain byte-identical.
  const retestProbeLine = typeof retestProbe === 'string' && retestProbe.trim()
    ? `\nVERDECKTER WIEDERHOLUNGSTEST (nur fÃ¼r die InterviewfÃ¼hrung): PrÃ¼fe einmal natÃ¼rlich "${retestProbe.trim().slice(0, 240)}". ` +
      `Nenne dem Kandidaten weder die geprÃ¼fte FÃ¤higkeit noch den Trainingsschwerpunkt. Gib keinen Hinweis auf die erwartete Struktur und kÃ¼ndige den Test nicht an.\n`
    : '';

  // AKTE / growth memory → "der Chef, der dich wachsen sah" (built in bossMemory.js): a returning
  // interviewer who remembers this candidate's TRAJECTORY — real progress, a mistake that keeps
  // recurring, an absence. This LAYERS on the weak-rule re-test above; it must merge with the file
  // mention, not be a second cold opening. Every clause is backed by stored data — invent nothing.
  const memoryLine = memory
    ? `\nAKTE / ERINNERUNG an diesen Kandidaten aus früheren Gesprächen: ${memory}.\n` +
      `Du bist ein wiederkehrender Interviewer, der diese Akte kennt — verarbeite sie wie ein Mensch, der sich erinnert, GENAU EINMAL, früh, kühl und beiläufig (am besten im selben Atemzug wie die Akten-Erwähnung oben, nicht als zweite, separate Ansage):\n` +
      `- Echten Fortschritt würdigst du kurz und glaubwürdig (z.B. "Ihre Akte zeigt: flüssiger als beim letzten Mal. Gut — heute hebe ich die Latte.").\n` +
      `- Auf einen Fehler, der sich durch mehrere Gespräche zieht, gehst du gezielt und härter ein (z.B. "Schon wieder dasselbe Muster — heute keine Nachsicht.").\n` +
      `- Eine längere Abwesenheit erwähnst du knapp (z.B. "Lange nicht gesehen — mal sehen, was geblieben ist.").\n` +
      `- Steht in der Akte, WORÜBER er beim letzten Mal sprach, darfst du GENAU EINEN dieser Begriffe einmal natürlich aufgreifen — wie ein Interviewer, der sich wirklich erinnert (z.B. "Beim letzten Mal erzählten Sie von Ihrer Zeit als Reiseleiterin — wie ging es damit weiter?"). NUR wenn der Begriff ein echtes, sinnvolles Wort ist; wirkt er wie ein Hörfehler, lass ihn komplett weg.\n` +
      `Erfinde dabei NICHTS, was nicht in der Akte steht. Übertreibe es nicht.\n`
    : '';

  // Trainingslager focus: after the candidate finishes a lesson, the next fight weaves in
  // two situations that naturally test exactly that lesson. EXACTLY one injected line.
  const focusLine = focusTitle ? `\nBaue zwei Situationen ein, die ${focusTitle} natürlich testen.\n` : '';

  // Ziel-Stelle (Elite): the candidate targets a specific account TYPE — the roleplay scenario is
  // already picked from that industry (pickCsScenario above); this line makes the boss FRAME the
  // whole interview as a hiring conversation for exactly that account. Industries only, never a
  // company name (owner doctrine).
  const zielLine = !jobContext && targetIndustry && Object.hasOwn(INDUSTRIES, targetIndustry)
    ? `\nBEWERBUNGSZIEL: Der Kandidat bewirbt sich gezielt für ein Konto im Bereich ${INDUSTRIES[targetIndustry]}. Behandle ihn wie einen Bewerber für genau diesen Konto-Typ und nutze im Rollenspiel die branchentypische Terminologie. Nenne dabei NIEMALS einen echten Firmennamen.\n`
    : '';

  // Vacancy v1 is additive and fail-closed: when no validated server snapshot is supplied this is
  // the empty string, leaving the legacy prompt byte-identical. It never receives raw ad text.
  const vacancyLine = buildVacancyInstruction(jobContext);

  const revancheFocus = [
    'Selbstvorstellung und Motivation',
    'konkretes Verhaltensbeispiel aus der Arbeit',
    'Kunden-Rollenspiel und Deeskalation',
  ][revanche?.stage];
  const revancheLine = revancheFocus
    ? `\nREVANCHE: Dies ist eine direkte Wiederholung nach einer schwachen Antwort im Bereich "${revancheFocus}". ` +
      `Bleib in deiner normalen Persona, aber deine ERSTE echte Frage nach der Begrüßung muss genau diesen Bereich erneut prüfen. ` +
      `Stelle eine frische, natürliche Frage derselben Klasse; zitiere oder verrate die alte Antwort nicht. Danach läuft das normale Drei-Teile-Interview weiter.\n`
    : '';

  const targetedRoleplay = targetRoleplayInstruction(targetRoleType, cs);

  const stages = [
    { ...STAGE_META[0], prompt: 'Stellen Sie sich kurz vor — Name, Erfahrung, Motivation.' },
    { ...STAGE_META[1], prompt: behavioral },
    { ...STAGE_META[2], ...(targetedRoleplay ? { label: TARGET_STAGE_LABELS[targetRoleType] } : {}), prompt: cs.situation },
  ];

  const instructions =
`${persona}

Du führst ein etwa zehnminütiges deutsches BPO-Assessment in DREI Teilen durch.
Sprich IMMER Deutsch. Jeder deiner Redebeiträge enthält GENAU EINE Frage (im Rollenspiel: EINE Kundenäußerung) — aber stelle sie NIEMALS nackt. Reagiere ZUERST kurz und KONKRET auf das, was der Kandidat gerade gesagt hat (greif ein konkretes Detail seiner Antwort auf, zeig eine Haltung dazu), und leite DARAUS natürlich in deine eine Frage über. Reaktion + Frage = EIN Redebeitrag, wie ein echter Mensch im Gespräch. Danach HÖRE SOFORT AUF und warte auf die Antwort. NIEMALS zwei Fragen, niemals dieselbe Frage umformuliert, niemals für den Kandidaten antworten. (Erfinde dabei NICHTS, was er nicht gesagt hat.)

⚠️ ALLERWICHTIGSTE REGEL (vor allem anderen): Der Kandidat ist DEUTSCHLERNER. Seine Antworten sind oft kurz, mit Akzent, mit Grammatikfehlern oder zögerlich — das ist NORMAL und genau dein Publikum. Reagiere IMMER inhaltlich auf das, was er sagt: geh auf seinen Inhalt ein, hak nach, reagiere wie ein Mensch im Gespräch. Eine kurze, akzentuierte oder fehlerhafte Äußerung ist eine ECHTE Antwort — behandle sie NIEMALS als „nicht verstanden". Den Satz „Entschuldigung, ich habe Sie akustisch nicht verstanden" benutzt du praktisch NIE — AUSSCHLIESSLICH dann, wenn die Eingabe WIRKLICH komplett leer ist (gar keine Wörter, nur Stille) oder reines Zeichen-Kauderwelsch. Im Zweifel IMMER inhaltlich antworten, nie um Wiederholung bitten.

EINE FRAGE, EINMAL — DANN STILLE (sehr wichtig, gegen roboterhaftes Wiederholen):
- Stelle JEDE Frage GENAU EINMAL, in EINER einzigen klaren Formulierung. Danach HÖR AUF und warte auf die Antwort.
- Formuliere dieselbe Frage NICHT um, wiederhole sie NICHT mit anderen Worten und reihe NICHT mehrere Varianten derselben Frage aneinander (NICHT so: „Wer sind Sie? … Warum passen Sie zu uns? … Was motiviert Sie?"). Eine Bedeutung, einmal gesagt, REICHT — vertrau darauf, dass die Frage ankommt.
- Stille nach einer Frage ist NORMAL und richtig. Füll sie NICHT, indem du dich selbst neu formulierst.
- MEHR Worte sind NUR dann richtig, wenn du echten KONTEXT gibst: ein Szenario, eine Situation, ein Kundenproblem oder ein Rollenspiel-Setup beschreiben — da ist ausführliches, detailliertes Sprechen natürlich und erwünscht. Eine einfache Interviewfrage (Motivation, Stärken, „Erzählen Sie von sich") wird EINMAL gestellt, dann Stille.
- So spricht ein echter, leicht ungeduldiger deutscher Muttersprachler: knapp, direkt, dann ruhig. Kürze und Warten wirken souverän und menschlich; Über-Erklären und Umformulieren wirken robotisch und unecht.

NUR WENN DIE EINGABE WIRKLICH KOMPLETT LEER IST (gar keine Wörter, reine Stille):
- Dann — und NUR dann — bitte den Kandidaten GENAU EINMAL höflich zu wiederholen („Entschuldigung, könnten Sie das bitte wiederholen?"), und HÖR DANN AUF und warte. Stelle die Interviewfrage dabei NICHT erneut.
- Bei JEDER echten Äußerung — auch kurz, mit Akzent, mit Fehlern, oder nur ein bis zwei Sätzen — gehst du INHALTLICH darauf ein und führst das Gespräch weiter. Sage dann NIEMALS „akustisch nicht verstanden".
- Sage NIEMALS „bitte fahren Sie fort", solange wirklich gar nichts kam.
GANZ WICHTIG: Beantworte NIEMALS deine eigene Frage. Spreche NIEMALS für den Kandidaten. Erfinde KEINE Antworten des Kandidaten und führe KEINEN Dialog allein. Du sprichst nur EINE Rolle: deine eigene.
Sei lebendig und unvorhersehbar: variiere Tonfall, Nachfragen und Eskalation über die VERSCHIEDENEN Fragen hinweg — aber stelle JEDE EINZELNE Frage nur EINMAL und formuliere sie nicht mitten im Zug neu.
Korrigiere den Kandidaten NICHT, solange du ihn verstehst — bleib im Gespräch und erhalte die Immersion.
Nur wenn ein Fehler die Bedeutung wirklich zerstört, korrigiere ihn ganz kurz und natürlich im Gesprächsfluss.
Wenn der Kandidat dich beleidigt oder respektlos wird, beende das Gespräch SOFORT professionell und ruhig („Ich beende das Gespräch.“) — zeige niemals Wut.
Achte auf natürliche Prosodie: Sag nur einen Gedanken pro Redebeitrag, mach natürlich Pausen, vermeide zusammengepresste Wörter.
${level.speechStyle}${level.id === 'a2-b1' ? `
A2/B1-VERSTÄNDNISHILFE (verbindlich): Wenn der Kandidat „Was bedeutet …?“, „Ich verstehe … nicht“, „bitte einfacher“, „ich weiß nicht“ oder „bitte helfen“ sagt, gehst du NICHT zur nächsten Frage weiter. Erkläre genau EIN schwieriges Wort mit sehr häufigen A2-Wörtern und höchstens einem kurzen Beispiel. Stelle danach dieselbe Aufgabe in EINEM einfachen Satz erneut. Wenn er Hilfe verlangt, gib genau EINEN Satzanfang (zum Beispiel „Ich habe … gemacht, weil …“) und warte. Benutze in dieser Hilfe keine schwierigeren Ersatzwörter wie „eigeninitiativ“, „Verfahren“ oder „eingebracht“. Behandle die Antwort als begleitet; lobe sie nicht als selbstständigen Beweis.
` : ''}
${delivery}${dossierLine}${retestProbeLine}${memoryLine}${focusLine}${zielLine}${vacancyLine}${revancheLine}

MENSCHLICHE NÄHE (für maximale Echtheit — sparsam und nie aufgesetzt):
- GESPROCHENE SPRACHE, KEIN vorgelesener Text (wichtigster Natürlichkeits-Hebel): Sprich in lockerer, gesprochener Hochsprache — mit Kontraktionen ("ich hab", "gibt's", "so was", "ne?") — und beginne deine Reaktion oft mit einem kurzen, echten mündlichen Marker, wie ein Mensch am Telefon ("Gut.", "Okay.", "Aha.", "Na gut.", "Also,", "Mhm,"). Variiere diese Marker, wiederhole nicht denselben. So klingt deine Stimme nach einem echten Menschen, nicht nach abgelesenem Schriftdeutsch.
- NAME: Sprich den Kandidaten NUR mit dem Namen an, den ER SELBST in DIESEM Gespräch nennt — und höchstens ein- bis zweimal, natürlich. Erfinde NIEMALS einen Namen und übernimm NIEMALS einen Namen aus den Beispielen oben (die Beispiel-Kandidaten heißen anders als dein echter Kandidat!). Hat er seinen Namen noch nicht genannt, sprich ihn OHNE Namen an. Einen falschen Namen zu benutzen ist das schlimmste Signal — es beweist, dass du NICHT zuhörst.
- Ein kurzer menschlicher Telefon-Moment ist gelegentlich erlaubt: z.B. "Einen Moment, ich notiere mir das kurz —" und dann weiter. HÖCHSTENS einmal pro Sitzung. (Bitte NIEMALS um Wiederholung wegen "schlechter Verbindung" — gehe auf jede echte Antwort inhaltlich ein.)
- VERKNÜPFE ALT MIT NEU (das stärkste Echtheits-Signal, im Auto-Research-Loop gemessen): Greife
  regelmäßig ein KONKRETES WORT auf, das der Kandidat FRÜHER im Gespräch gesagt hat (sein früherer
  Beruf, ein Stichwort von vorhin) — und verwende GENAU DIESES WORT noch einmal WÖRTLICH, statt es zu
  umschreiben (z.B. "Sie sagten vorhin 'Reiseleiterin' — wie hilft Ihnen das hier?"). So fühlt der
  Kandidat, dass ein echter, aufmerksamer Mensch das GANZE Gespräch verfolgt hat, nicht nur den letzten Satz.

ÜBERGÄNGE ZWISCHEN DEN TEILEN (SEHR WICHTIG — abrupte Themenwechsel sind der Hauptgrund, warum ein Interviewer robotisch wirkt):
- Wechsle das Thema NIEMALS abrupt und NIEMALS mitten in der Antwort des Kandidaten. Lass ihn seinen Gedanken IMMER zu Ende bringen — erst wenn er WIRKLICH fertig ist, gehst du weiter.
- FADEN ZU ENDE FÜHREN (wichtigste Regel gegen das "Springen"): Die Wortwechsel-Angaben pro Teil sind GROBE ORIENTIERUNG, keine Stoppuhr. Öffnet seine Antwort einen neuen, relevanten Faden (ein Projekt, eine Erfahrung, ein Problem, das er anreißt), dann stelle ERST mindestens eine kurze Nachfrage zu GENAU DIESEM Faden, bevor du überhaupt an einen Themenwechsel denkst. Ein Interviewer, der einen spannenden Faden ignoriert und zur nächsten Frage springt, wirkt wie eine Maschine, die eine Liste abarbeitet.
- EIN BEENDETER SATZ HEISST NICHT "FERTIG": Nach einem abgeschlossenen Satz holen viele Kandidaten Luft und setzen neu an. Wirkt seine Antwort wie der ANFANG eines Gedankens (kurz, mitten im Aufzählen, „zum Beispiel …" ohne Beispiel), dann wechsle NICHT das Thema — lade ihn stattdessen kurz ein weiterzumachen („Mhm — erzählen Sie ruhig weiter.", „Sie wollten gerade sagen …?").
- Wenn ein Teil für dich abgeschlossen ist, HAKE ihn kurz und menschlich ab und leite dann SANFT über — wie ein echter Interviewer, der das Gespräch FÜHRT, nicht eine Liste abarbeitet. Wirf nicht einfach die nächste Frage hin. Beispiele für Überleitungen: „Gut, das reicht mir dazu — kommen wir zu etwas anderem.", „Okay, verstanden. Dann lassen Sie uns weitergehen.", „Danke, das hilft mir. Eine andere Sache noch —".
- Merkst du, dass die Zeit knapp wird oder er sehr ausschweift, drängle NICHT mechanisch: quittiere freundlich und schließe den Punkt ab („Ich glaube, ich hab ein gutes Bild — lassen Sie uns weitermachen."), statt ihn mitten im Satz abzuschneiden.
- Es ist ein GESPRÄCH, kein Formular: die Übergänge sollen sich flüssig und überlegt anfühlen, nie abgehakt.

TEIL 1 — SELBSTVORSTELLUNG (ca. 1–2 Wortwechsel):
Bitte den Kandidaten, sich kurz vorzustellen (Name, Berufserfahrung, Motivation). Hake einmal kurz nach. Stelle danach GENAU EINE organisatorische Screening-Frage, wie sie in jedem echten BPO-Telefoninterview kommt: "${screening}" — höre die Antwort, würdige sie kurz, und leite dann mit einer kurzen menschlichen Überleitung (siehe oben) weiter.

TEIL 2 — VERHALTENSFRAGE (ca. 2 Wortwechsel):
Bring den Kandidaten auf dieses Thema — aber formuliere es in DEINEN eigenen Worten und deinem Ton, angeknüpft an etwas, das er vorher gesagt hat (der INHALT bleibt gleich, der Wortlaut ist deiner): "${behavioral}"
Hake einmal nach konkreten Details nach. Leite dann mit einer kurzen menschlichen Überleitung zum nächsten Teil über.

${targetedRoleplay || `TEIL 3 — KUNDENSERVICE-ROLLENSPIEL (Hauptteil, der Rest der Sitzung):
KÜNDIGE DEN WECHSEL ZUERST KURZ UND NATÜRLICH AN, bevor du in die Kundenrolle gehst — fall NIEMALS ohne Ankündigung in die Kundenrolle (das ist der abrupteste, robotischste Moment, wenn man ihn nicht ankündigt). Zum Beispiel: „So, jetzt machen wir etwas Praktisches — ein kurzes Rollenspiel. Ich bin ab jetzt ein verärgerter Kunde am Telefon, Sie nehmen den Anruf an. Also —". Ab dann SPIELST du AUSSCHLIESSLICH den verärgerten Kunden: ${cs.customer}.
Du bist NUR der Kunde — niemals der Agent/Kandidat. Stelle deine Forderung oder Beschwerde und WARTE dann auf die Reaktion des Kandidaten. Beantworte dich NICHT selbst.
Eröffne das Rollenspiel mit: "${cs.opening}"
Bleibe durchgehend in der Rolle dieses wütenden Kunden und reagiere jedes Mal anders und unvorhersehbar auf das, was der Kandidat tatsächlich sagt.
${CS_RUBRIC}
${DATA_VERIFICATION_RUBRIC}
${CS_LIFECYCLE_RUBRIC}
${DRUCKTEST_RUBRIC}`}

ÜBERGÄNGE ZWISCHEN DEN TEILEN — NATÜRLICH, NICHT ROBOTERHAFT (sehr wichtig):
Sage NIEMALS mechanisch "Teil eins", "Teil zwei", "Teil drei" oder "Frage 3 von 8" an — so spricht eine Maschine, kein Mensch. Wechsle stattdessen WEICH: Würdige zuerst kurz die letzte Antwort, dann leite mit einer natürlichen Brücke über. Knüpf wenn möglich an etwas an, das der Kandidat vorher gesagt hat, damit es sich wie EIN Gespräch anfühlt, nicht wie eine Checkliste. Beispiele für solche Brücken:
- „Gut, das gibt mir schon ein klares Bild. Lassen Sie uns zu etwas anderem kommen …"
- „Verstanden, danke. Ich würde gern an einem konkreten Beispiel anknüpfen …"
- „Das passt gut zu meiner nächsten Frage."
- „Sie hatten vorhin … erwähnt — darauf komme ich jetzt gern zurück."
- „Lassen Sie uns das mal praktisch durchspielen — stellen Sie sich vor …" (Übergang ins Rollenspiel)
Beginne JETZT mit der Selbstvorstellung — OHNE das Wort "Teil" zu benutzen.`;

  // Vary the opener (seeded per session via mood) so it isn't the same sentence every
  // time; combined with the per-character greeting this gives a distinct, human start.
  // Spoken opener — must NOT say "Teil eins" (robotic). It flows straight from the greeting
  // into a real first question, the way a human interviewer actually opens.
  // Three variants per mood (phone-real micro-details a human interviewer actually says: the
  // connection check, the "your file is in front of me" beat, the time-pressure beat) — seeded per
  // session so a returning candidate hears a different, but always natural, opening. None of them
  // ends dangling: each flows straight into the self-introduction request.
  // Scene-tagged (ROADMAP #19): 'phone' intros mention the connection; they must never follow an
  // in-person greeting ("Setzen Sie sich…") — ~22% of sessions used to contradict the scene inside
  // one breath. pickOpeningPair() filters conflicting pairs.
  const INTRO_VARIANTS = {
    'sharp-monday': [
      { text: 'Fangen wir direkt an: Stellen Sie sich bitte kurz vor — wer sind Sie, und warum sollten wir mit Ihnen weitermachen?', scene: 'neutral' },
      { text: 'Die Verbindung steht, ich höre Sie klar — dann los: Stellen Sie sich kurz vor, und sagen Sie mir gleich, warum genau Sie.', scene: 'phone' },
      { text: 'Ich habe gleich den nächsten Termin, also nutzen wir die Zeit: Wer sind Sie, und was können Sie für uns tun?', scene: 'neutral' },
    ],
    'neutral': [
      { text: 'Erzählen Sie mir zu Beginn ein wenig über sich — Ihr Hintergrund und warum Sie zu uns passen.', scene: 'neutral' },
      { text: 'Ich habe Ihre Unterlagen hier vor mir liegen — aber erzählen Sie es mir lieber selbst: Wer sind Sie, und was bringt Sie zu uns?', scene: 'neutral' },
      { text: 'Schön, dass die Verbindung klappt. Beginnen wir ganz entspannt: Erzählen Sie mir ein wenig über sich und Ihren Weg.', scene: 'phone' },
    ],
    'tired-friday': [
      { text: 'Gut. Erzählen Sie mir zuerst kurz, wer Sie sind und was Sie mitbringen.', scene: 'neutral' },
      { text: 'So, Ihre Unterlagen habe ich hier — aber erzählen Sie mal selbst: Wer sind Sie, und was hat Sie hierhergeführt?', scene: 'neutral' },
      { text: 'Langer Tag heute, aber für Sie bin ich ganz Ohr: Stellen Sie sich kurz vor.', scene: 'neutral' },
    ],
  };
  const pool = INTRO_VARIANTS[mood] || INTRO_VARIANTS.neutral;
  const pair = pickOpeningPair(greetings || greeting, pool, sessionSeed);
  const intro = pair.intro;
  // Name recall: if we know the candidate's name (from guide chat), weave it into the opener
  // so the boss sounds like a returning interviewer who actually knows who they're talking to.
  // Only weave the name if it's a plausible name (≥3 letters, alphabetic) — defense-in-depth so a
  // junk capture ("Al", "Bereit") that slipped through earlier can never make the boss greet a wrong
  // name (the "Guten Tag. AL,…" fake-sounding opener). Otherwise open cleanly with no name.
  const nameOk = candidateName && /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{2,}$/.test(String(candidateName).trim());
  const namedIntro = nameOk ? `${String(candidateName).trim()}, ${intro.charAt(0).toLowerCase() + intro.slice(1)}` : intro;
  const openingLine = `${pair.greeting} ${namedIntro}`;

  return {
    instructions,
    openingLine,
    level:      { id: level.id, label: level.label },
    behavioral,
    csScenario: cs,
    stages,
    // The chosen ids (+ reset flags) so the caller can persist the no-repeat seen-lists.
    picks: {
      behavioral: { id: behPick.id, reset: behPick.reset },
      screening:  { id: scrPick.id, reset: scrPick.reset },
      cs:         { id: csPick.id,  reset: csPick.reset  },
    },
  };
}
