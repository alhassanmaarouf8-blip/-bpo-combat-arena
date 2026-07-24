/**
 * VideoLessons.jsx — the $0 "video" engine. Real recorded video is impossible at zero spend, so this
 * is the honest equivalent: lessons play as full-screen animated slide sequences with native German
 * TTS narration (same Aura-2 voice as the drills, via nativeVoice.js → server-cached → $0, browser
 * voice fallback). Feels like a produced explainer: autoplay through slides, kinetic typography,
 * progress bar, pause/replay — then a HARD deterministic quiz at the end.
 *
 * CONGRUENCY (owner: "everything must work in harmony — drills, interview, feedback"): the lesson
 * list is RANKED by the student's REAL current weakness, read from the SAME signal the debrief's
 * "train this skill" button and DailyMission use — hireReadiness.limitingSkill + topWeakness.rule
 * from GET /api/progress. The lesson that fixes what tripped them in the interview floats to the top
 * with a "FÜR DICH" badge and a one-line reason that names the real gap. No second source of truth.
 *
 * NARRATION (owner: "the way the lesson is read is not human — fix that"): every slide carries an
 * explicit `speak` written in natural SPOKEN German — short connected sentences, discourse markers
 * ("Schauen Sie", "Also", "Und genau hier"), never a heading-then-bullets blob read aloud (that is
 * what sounded robotic). The on-screen text stays terse; the voice sounds like a trainer talking.
 * (Deepgram German Aura-2 has no speed param — verified — so naturalness lives in the WRITING.)
 *
 * QUIZ (owner: "at the end give questions that are hard to solve"): each lesson ends with multiple-
 * choice questions graded DETERMINISTICALLY on the option index (same honesty model as Hör-Check —
 * no LLM judges right/wrong). Options are shuffled per serve so the answer is never in a fixed slot.
 * The hard ones are verb-final word-order transforms — the #1 Arabic-L1 wall — with near-miss distractors.
 *
 * Engine per slide: { kicker?, title, lines[], example?, falsch?, note?, speak }
 * Advancing: narration onEnd + a beat, never before a min read time; a hard fallback advances even
 * if audio stalls. Pause stops audio + reveals the full slide; resume restarts the slide's narration.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { playNative } from './nativeVoice.js';
import { actionBtn as primaryBtn, ghostBtn, ghostBtnWide } from './ui/primitives.js';

const LINE_MS = 1300;   // cadence of the one-by-one line reveal
const BEAT_MS = 900;    // breathing room after the narration before the next slide

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// What the narrator says. Every slide now ships an explicit spoken-register `speak` (see header).
// Fallback (should be rare) mirrors the old behaviour so a slide can never go silent.
function speakTextOf(sl) {
  if (sl.speak) return sl.speak;
  const parts = [sl.title, ...(sl.lines || [])];
  if (sl.example) parts.push(`Zum Beispiel: ${sl.example}`);
  if (sl.note) parts.push(sl.note);
  return parts.filter(Boolean).join(' ');
}

// Honest duration estimate from the narration length (~speaking rate), for the picker cards.
function estMinutes(les) {
  const ms = les.slides.reduce((s, sl) => s + speakTextOf(sl).length * 80 + 1800, 0);
  return Math.max(1, Math.round(ms / 60000));
}

// ── The lessons (clean C1-correct German, clear enough for A2–B1 ears) ─────────────────────────
// `targets` ties a lesson to the SAME weakness taxonomy the interview/feedback use (hireReadiness
// limitingSkill + weak-rule keywords) → the recommendation engine below reads off it.
// `quiz` = hard, multiple-choice, deterministically graded on `correct` (index into `options`).
const LESSONS = [
  {
    id: 'selbstvorstellung',
    title: 'Die perfekte Selbstvorstellung',
    hook: 'Die erste Frage entscheidet — vier Bausteine für eine starke erste Minute.',
    targets: { skills: ['fluency', 'confidence'], ruleKeywords: [] },
    slides: [
      {
        kicker: 'LEKTION 1',
        title: 'Die perfekte Selbstvorstellung',
        lines: [
          'Fast jedes Interview beginnt gleich: „Erzählen Sie kurz von sich.“',
          'Wer hier klar antwortet, führt das Gespräch von Anfang an.',
          'Vier Bausteine reichen — immer in derselben Reihenfolge.',
        ],
        speak: 'Also, fangen wir mit der Selbstvorstellung an. Fast jedes Interview beginnt genau gleich: Erzählen Sie kurz von sich. Und wer da klar antwortet, der führt das Gespräch von Anfang an. Ich zeige Ihnen vier Bausteine — immer in derselben Reihenfolge.',
      },
      {
        kicker: 'BAUSTEIN 1',
        title: 'Name und Rolle',
        lines: [
          'Beginnen Sie mit Ihrem Namen und Ihrer aktuellen Rolle.',
          'Ein Satz genügt — ruhig und deutlich gesprochen.',
        ],
        example: 'Guten Tag, mein Name ist Omar Hassan und ich arbeite als Kundenservice-Agent.',
        speak: 'Baustein eins: Name und Rolle. Fangen Sie einfach mit Ihrem Namen und Ihrer aktuellen Rolle an — ein Satz reicht, ruhig und deutlich. So zum Beispiel: Guten Tag, mein Name ist Omar Hassan und ich arbeite als Kundenservice-Agent.',
      },
      {
        kicker: 'BAUSTEIN 2',
        title: 'Erfahrung mit einer Zahl',
        lines: [
          'Eine konkrete Zahl macht Ihre Erfahrung sofort glaubwürdig.',
          'Jahre, Anrufe pro Tag, zufriedene Kunden — eine Zahl genügt.',
        ],
        example: 'Ich habe zwei Jahre Erfahrung im Kundenservice und betreue rund fünfzig Anrufe pro Tag.',
        speak: 'Baustein zwei: Erfahrung mit einer Zahl. Eine konkrete Zahl macht Ihre Erfahrung sofort glaubwürdig — Jahre, Anrufe pro Tag, zufriedene Kunden, eine reicht. Hören Sie den Unterschied: Ich habe zwei Jahre Erfahrung im Kundenservice und betreue rund fünfzig Anrufe pro Tag.',
      },
      {
        kicker: 'BAUSTEIN 3',
        title: 'Stärke mit Beweis',
        lines: [
          'Nennen Sie eine Stärke — und beweisen Sie sie mit einem Beispiel.',
          'Ohne Beweis klingt jede Stärke wie eine Floskel.',
        ],
        example: 'Meine Stärke ist Ruhe unter Druck: Auch bei wütenden Kunden bleibe ich freundlich und finde eine Lösung.',
        speak: 'Baustein drei: Stärke mit Beweis. Nennen Sie eine Stärke — aber beweisen Sie sie sofort mit einem Beispiel, denn ohne Beweis klingt jede Stärke wie eine leere Floskel. Also so: Meine Stärke ist Ruhe unter Druck. Auch bei wütenden Kunden bleibe ich freundlich und finde eine Lösung.',
      },
      {
        kicker: 'BAUSTEIN 4',
        title: 'Motivation',
        lines: [
          'Sagen Sie zum Schluss, warum Sie genau diese Stelle wollen.',
          'Verbinden Sie die Stelle mit Ihrem persönlichen Ziel.',
        ],
        example: 'Ich möchte diese Stelle, weil ich mein Deutsch jeden Tag im Kundenkontakt einsetzen will.',
        speak: 'Und Baustein vier: Motivation. Sagen Sie zum Schluss, warum Sie genau diese Stelle wollen, und verbinden Sie die Stelle mit Ihrem eigenen Ziel. Zum Beispiel: Ich möchte diese Stelle, weil ich mein Deutsch jeden Tag im Kundenkontakt einsetzen will.',
      },
      {
        kicker: 'ZUSAMMENFASSUNG',
        title: 'Vier Bausteine, eine Minute',
        lines: [
          'Name und Rolle. Erfahrung mit einer Zahl. Stärke mit Beweis. Motivation.',
          'Üben Sie die vier Sätze laut, bis sie automatisch kommen.',
        ],
        note: 'Tipp: Sprechen Sie Ihre Selbstvorstellung danach im Interview — dort zählt sie wirklich.',
        speak: 'Fassen wir zusammen: Name und Rolle, Erfahrung mit einer Zahl, Stärke mit Beweis, Motivation. Üben Sie diese vier Sätze laut, bis sie ganz automatisch kommen. Und dann sprechen Sie Ihre Selbstvorstellung im echten Interview — dort zählt sie wirklich.',
      },
    ],
    quiz: [
      {
        q: 'Welche Selbstvorstellung ist am stärksten?',
        options: [
          'Ich habe zwei Jahre Erfahrung im Kundenservice und betreue rund fünfzig Anrufe pro Tag.',
          'Ich bin sehr motiviert, ein echter Teamplayer und lerne immer schnell.',
          'Also, ich weiß nicht genau, wo ich anfangen soll, aber ich denke, ich passe gut.',
        ],
        correct: 0,
        why: 'Eine konkrete Zahl macht die Erfahrung glaubwürdig — Adjektive ohne Beweis nicht.',
      },
      {
        q: 'Ein Kandidat sagt: „Meine Stärke ist Geduld.“ Was fehlt?',
        options: [
          'Ein Beweis — ein konkretes Beispiel, das die Geduld zeigt.',
          'Nichts, der Satz ist schon perfekt.',
          'Eine Entschuldigung, dass er nur eine Stärke nennt.',
        ],
        correct: 0,
        why: 'Ohne Beispiel bleibt jede Stärke eine Behauptung. Baustein 3: Stärke MIT Beweis.',
      },
      {
        q: 'In welcher Reihenfolge kommen die vier Bausteine?',
        options: [
          'Name und Rolle → Erfahrung → Stärke mit Beweis → Motivation',
          'Motivation → Name → Stärke → Erfahrung',
          'Stärke → Motivation → Name → Erfahrung',
        ],
        correct: 0,
        why: 'Erst wer man ist, dann was man kann, dann warum — diese Reihenfolge führt das Gespräch.',
      },
    ],
  },
  {
    id: 'wuetende-kunden',
    title: 'Wütende Kunden: die 4 Schritte',
    hook: 'Der Vier-Schritte-Reflex, der jede Beschwerde entschärft.',
    targets: { skills: ['deescalation'], ruleKeywords: [] },
    slides: [
      {
        kicker: 'LEKTION 2',
        title: 'Wütende Kunden: die 4 Schritte',
        lines: [
          'Ein wütender Kunde testet nicht Ihr Deutsch — er testet Ihre Ruhe.',
          'Profis folgen immer denselben vier Schritten.',
          'Empathie. Verantwortung. Lösung. Verbindlichkeit.',
        ],
        speak: 'In dieser Lektion geht es um wütende Kunden. Und passen Sie auf: Ein wütender Kunde testet gar nicht Ihr Deutsch — er testet Ihre Ruhe. Profis folgen deshalb immer denselben vier Schritten: Empathie, Verantwortung, Lösung, Verbindlichkeit.',
      },
      {
        kicker: 'SCHRITT 1',
        title: 'Empathie',
        lines: [
          'Zeigen Sie zuerst, dass Sie den Ärger verstehen.',
          'Noch keine Lösung — zuerst das Gefühl anerkennen.',
        ],
        example: 'Ich kann Ihren Ärger vollkommen nachvollziehen.',
        speak: 'Schritt eins: Empathie. Zeigen Sie zuerst, dass Sie den Ärger verstehen — noch keine Lösung, erst mal nur das Gefühl anerkennen. Zum Beispiel: Ich kann Ihren Ärger vollkommen nachvollziehen.',
      },
      {
        kicker: 'SCHRITT 2',
        title: 'Verantwortung',
        lines: [
          'Übernehmen Sie Verantwortung, ohne Schuld zuzuweisen.',
          'Keine Ausreden, keine Rechtfertigungen.',
        ],
        example: 'Das tut mir aufrichtig leid — das hätte nicht passieren dürfen.',
        speak: 'Schritt zwei: Verantwortung. Übernehmen Sie Verantwortung, ohne die Schuld weiterzuschieben — keine Ausreden, keine langen Rechtfertigungen. So klingt das: Das tut mir aufrichtig leid, das hätte nicht passieren dürfen.',
      },
      {
        kicker: 'SCHRITT 3',
        title: 'Lösung',
        lines: [
          'Sagen Sie konkret, was Sie jetzt tun.',
          'Ein klarer nächster Schritt beruhigt mehr als zehn Entschuldigungen.',
        ],
        example: 'Was ich konkret für Sie tun kann, ist Folgendes: Ich eskaliere das sofort an unser technisches Team.',
        speak: 'Schritt drei: die Lösung. Jetzt sagen Sie konkret, was Sie tun — und glauben Sie mir, ein klarer nächster Schritt beruhigt mehr als zehn Entschuldigungen. Also: Was ich konkret für Sie tun kann, ist Folgendes: Ich eskaliere das sofort an unser technisches Team.',
      },
      {
        kicker: 'SCHRITT 4',
        title: 'Verbindlichkeit',
        lines: [
          'Geben Sie zum Schluss ein Versprechen mit einer klaren Zeitangabe.',
          'So weiß der Kunde: Es passiert wirklich etwas.',
        ],
        example: 'Ich kümmere mich umgehend darum und melde mich innerhalb von 24 Stunden bei Ihnen.',
        speak: 'Und Schritt vier: Verbindlichkeit. Geben Sie zum Schluss ein Versprechen mit einer klaren Zeitangabe, damit der Kunde weiß, dass wirklich etwas passiert. Zum Beispiel: Ich kümmere mich umgehend darum und melde mich innerhalb von 24 Stunden bei Ihnen.',
      },
      {
        kicker: 'ZUSAMMENFASSUNG',
        title: 'Der Vier-Schritte-Reflex',
        lines: [
          'Empathie. Verantwortung. Lösung. Verbindlichkeit.',
          'Immer in dieser Reihenfolge — bei jeder Beschwerde.',
        ],
        note: 'Diese Sätze kommen direkt aus den Trainings-Szenarien der App.',
        speak: 'Merken Sie sich die Reihenfolge: Empathie, Verantwortung, Lösung, Verbindlichkeit — immer so, bei jeder Beschwerde. Genau diese Sätze kommen übrigens direkt aus den Rollenspielen hier in der App.',
      },
    ],
    quiz: [
      {
        q: 'Ein Kunde schreit sofort los. Was ist Ihr ERSTER Satz?',
        options: [
          'Ich kann Ihren Ärger vollkommen nachvollziehen.',
          'Das ist nicht unsere Schuld, da müssen Sie woanders anrufen.',
          'Beruhigen Sie sich bitte erst einmal.',
        ],
        correct: 0,
        why: 'Schritt 1 ist Empathie. „Beruhigen Sie sich“ tut das Gegenteil — es erhöht den Druck.',
      },
      {
        q: 'Welcher Satz zeigt Verantwortung OHNE Ausrede?',
        options: [
          'Das tut mir aufrichtig leid — das hätte nicht passieren dürfen.',
          'Das liegt am Kollegen aus der anderen Abteilung.',
          'Das System war schuld, nicht ich.',
        ],
        correct: 0,
        why: 'Verantwortung heißt: den Fehler anerkennen, nicht die Schuld weiterschieben.',
      },
      {
        q: 'Was macht ein Lösungs-Versprechen VERBINDLICH?',
        options: [
          'Eine klare Zeitangabe — „innerhalb von 24 Stunden“.',
          'Das Wort „vielleicht“.',
          'Dass man es möglichst vage hält, um flexibel zu bleiben.',
        ],
        correct: 0,
        why: 'Eine konkrete Frist zeigt dem Kunden: Es passiert wirklich etwas, zu einem festen Zeitpunkt.',
      },
    ],
  },
  {
    id: 'nebensaetze',
    title: 'Nebensätze ohne Angst',
    hook: 'Die häufigste Fehlerquelle im deutschen Satzbau — in fünf Minuten geknackt.',
    targets: { skills: ['complexity', 'grammar'], ruleKeywords: ['wortstellung', 'verbstellung', 'satzstellung', 'nebensatz', 'wortreihenfolge', 'übereinstimmung', 'subjekt', 'prädikat', 'verb'] },
    slides: [
      {
        kicker: 'LEKTION 3',
        title: 'Nebensätze ohne Angst',
        lines: [
          'Im Hauptsatz steht das Verb an Position zwei.',
          'Nach „weil“, „dass“ und „wenn“ wandert es ans Ende.',
          'Genau hier entscheidet sich, wie professionell Ihr Deutsch klingt.',
        ],
        speak: 'Jetzt zu den Nebensätzen — und keine Angst, das knacken wir gleich. Im Hauptsatz steht das Verb an Position zwei. Aber nach weil, dass und wenn wandert es ganz ans Ende. Und genau hier entscheidet sich, wie professionell Ihr Deutsch klingt.',
      },
      {
        kicker: 'DIE REGEL',
        title: 'Das Verb geht ans Ende',
        lines: [
          'Ein Nebensatz beginnt mit „weil“, „dass“ oder „wenn“.',
          'Das konjugierte Verb steht dann ganz am Ende.',
          'Im Arabischen und im Englischen bleibt das Verb vorne — im Deutschen nicht.',
        ],
        speak: 'Die Regel ist einfach: Ein Nebensatz beginnt mit weil, dass oder wenn — und das konjugierte Verb steht dann ganz am Ende. Und aufgepasst: Im Arabischen und im Englischen bleibt das Verb vorne. Im Deutschen nicht. Genau das ist die Umstellung, die Sie üben müssen.',
      },
      {
        kicker: 'WEIL',
        title: 'weil — der Grund',
        lines: ['„weil“ nennt den Grund — und schickt das Verb ans Ende.'],
        falsch: 'Ich bleibe ruhig, weil ich bin professionell.',
        example: 'Ich bleibe ruhig, weil ich professionell bin.',
        speak: 'Nehmen wir das Wort „weil“. Es nennt den Grund und schickt das Verb ans Ende. Falsch wäre: Ich bleibe ruhig, weil ich bin professionell. Richtig ist: Ich bleibe ruhig, weil ich professionell bin. Hören Sie, wie das „bin“ ganz nach hinten rutscht?',
      },
      {
        kicker: 'DASS',
        title: 'dass — die Aussage',
        lines: ['„dass“ steht oft nach Verben wie „verstehen“, „glauben“ und „sagen“.'],
        falsch: 'Ich verstehe, dass Sie sind verärgert.',
        example: 'Ich verstehe, dass Sie verärgert sind.',
        speak: 'Weiter mit dem Wort „dass“. Es steht oft nach Verben wie verstehen, glauben oder sagen. Falsch wäre: Ich verstehe, dass Sie sind verärgert. Richtig ist: Ich verstehe, dass Sie verärgert sind. Das „sind“ steht am Ende.',
      },
      {
        kicker: 'WENN',
        title: 'wenn — die Bedingung',
        lines: [
          '„wenn“ beschreibt eine Bedingung oder eine wiederkehrende Situation.',
          'Achtung: Trennbare Verben werden am Ende wieder zu einem Wort.',
        ],
        falsch: 'Wenn der Kunde ruft an, bleibe ich freundlich.',
        example: 'Wenn der Kunde anruft, bleibe ich freundlich.',
        speak: 'Und wenn beschreibt eine Bedingung. Ein Sonderfall zum Aufpassen: Trennbare Verben werden am Ende wieder zu einem Wort. Falsch wäre: Wenn der Kunde ruft an, bleibe ich freundlich. Richtig ist: Wenn der Kunde anruft, bleibe ich freundlich. „Ruft an“ wird zu „anruft“, ganz am Ende.',
      },
      {
        kicker: 'ZUSAMMENFASSUNG',
        title: 'Verb ans Ende — immer',
        lines: [
          'Nach „weil“, „dass“ und „wenn“ steht das Verb am Ende — immer.',
          'Sagen Sie die drei richtigen Sätze laut — dreimal hintereinander.',
        ],
        note: 'Im Interview zählt jeder korrekte Nebensatz doppelt: Er zeigt echtes B1-Niveau.',
        speak: 'Zusammengefasst: Nach weil, dass und wenn steht das Verb am Ende — immer. Sagen Sie jetzt die drei richtigen Sätze laut, dreimal hintereinander. Denn im Interview zählt jeder korrekte Nebensatz doppelt: Er zeigt echtes B1-Niveau.',
      },
    ],
    quiz: [
      {
        q: 'Welcher Satz ist richtig?',
        options: [
          'Ich glaube, dass dieser Job gut zu mir passt.',
          'Ich glaube, dass dieser Job passt gut zu mir.',
          'Ich glaube, dass passt dieser Job gut zu mir.',
        ],
        correct: 0,
        why: 'Nach „dass“ steht das Verb „passt“ ganz am Ende. Nur Option 1 macht das.',
      },
      {
        q: 'Machen Sie daraus einen Nebensatz mit „weil“: „Ich bleibe ruhig. Ich bin geduldig.“',
        options: [
          'Ich bleibe ruhig, weil ich geduldig bin.',
          'Ich bleibe ruhig, weil ich bin geduldig.',
          'Ich bleibe ruhig, weil bin ich geduldig.',
        ],
        correct: 0,
        why: '„weil“ schickt das konjugierte Verb „bin“ ans Ende: …weil ich geduldig bin.',
      },
      {
        q: 'Trennbares Verb im Nebensatz — welcher Satz stimmt?',
        options: [
          'Wenn der Kunde anruft, notiere ich alles.',
          'Wenn der Kunde ruft an, notiere ich alles.',
          'Wenn der Kunde an ruft, notiere ich alles.',
        ],
        correct: 0,
        why: 'Am Satzende wird „ruft … an“ wieder zu einem Wort: „anruft“.',
      },
      {
        q: 'Welcher Satz ist KORREKT?',
        options: [
          'Ich melde mich, wenn ich eine Lösung gefunden habe.',
          'Ich melde mich, wenn ich habe eine Lösung gefunden.',
          'Ich melde mich, wenn habe ich eine Lösung gefunden.',
        ],
        correct: 0,
        why: 'Im wenn-Satz steht das ganze Verbgefüge am Ende: …gefunden habe.',
      },
    ],
  },
];

// ── Recommendation: rank lessons by the student's REAL weakness (same signal the debrief uses) ──
// Returns { recId, reason } — recId is the lesson to float to the top (or null). Pure so it's easy
// to reason about; reads limitingSkill first (the hire-gating diagnostic), then falls back to a
// keyword match on the named weak grammar rule.
function recommendLesson(progress) {
  const hr = progress?.hireReadiness || {};
  const skill = hr.limitingSkill;
  const rule = String(progress?.topWeakness?.rule || '').toLowerCase();

  for (const les of LESSONS) {
    if (skill && (les.targets?.skills || []).includes(skill)) {
      return { recId: les.id, reason: reasonFor(skill, progress) };
    }
  }
  for (const les of LESSONS) {
    if (lessonMatchesRule(les, rule)) {
      return { recId: les.id, reason: `Aus deinem letzten Interview: „${progress.topWeakness.rule}“ — genau das übt diese Lektion.` };
    }
  }
  return { recId: null, reason: null };
}

// Does this lesson train the named weak grammar rule? ONE source for the matching semantics —
// used by the recommendation above AND by the finished-quiz report below, so a lesson can never
// be recommended for a rule it wouldn't report against.
function lessonMatchesRule(les, rule) {
  const r = String(rule || '').toLowerCase();
  return !!r && (les.targets?.ruleKeywords || []).some((k) => r.includes(k));
}

// Payload for POST /api/drill-event when a quiz finishes — the lesson reports its OUTCOME to the
// same spine every other drill feeds (owner's harmony rule: the brain must SEE that the lesson
// happened, else Alhassan/debrief prescribe a fix the learner already studied). `correct` =
// majority of quiz answers right (the brain's binary "did the prescribed fix land"). The weak
// rule is attached ONLY when this lesson actually targets it, so the event lands on that
// weakness's weakLog entry; otherwise it goes to the general drillLog (still counts as prep).
export function lessonEventPayload(les, qScore, total, topRule) {
  return {
    drill: 'video-lektion',
    correct: total > 0 && qScore * 2 >= total,
    ...(lessonMatchesRule(les, topRule) ? { rule: topRule } : {}),
  };
}
function reasonFor(skill, progress) {
  // German-only; OWNER-AR slots. Names the real gap the interview/feedback found.
  const M = {
    fluency:      'Aus deinem letzten Interview: an deinem Redefluss lässt sich am meisten gewinnen.',
    confidence:   'Aus deinem letzten Interview: mehr Sicherheit beim Sprechen ist gerade dein größter Hebel.',
    deescalation: 'Aus deinem letzten Interview: der Umgang mit schwierigen Kunden ist dein größter Hebel.',
    complexity:   'Aus deinem letzten Interview: dein Satzbau (Nebensätze) ist gerade dein größter Hebel.',
    grammar:      'Aus deinem letzten Interview: deine Grammatik im Satzbau ist gerade dein größter Hebel.',
  };
  return M[skill] || 'Empfohlen aus deinem letzten Interview.';
}

// Fisher–Yates on option indices → the correct answer is never predictably in the same slot.
function shuffledOptions(qz) {
  const order = qz.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { options: order.map((i) => qz.options[i]), correct: order.indexOf(qz.correct) };
}

// ── Component ───────────────────────────────────────────────────────────────────────────────────
// `lang` is accepted for parity with the sibling drills; all copy is German-only by design law
// (Arabic is owner-authored later — see the OWNER-AR slots).
export function VideoLessons({ token, apiUrl, lang = 'de', onClose }) {   // eslint-disable-line no-unused-vars
  const [lesson, setLesson]     = useState(null);   // null → picker, else the playing lesson
  const [idx, setIdx]           = useState(0);      // current slide
  const [shown, setShown]       = useState(1);      // how many lines are revealed
  const [playing, setPlaying]   = useState(false);
  const [phase, setPhase]       = useState('play'); // 'play' | 'quiz' | 'done' (within a lesson)
  const [rec, setRec]           = useState({ recId: null, reason: null });

  // quiz state
  const [qShuffled, setQShuffled] = useState([]);   // per-serve shuffled questions
  const [qIdx, setQIdx]           = useState(0);
  const [qPicked, setQPicked]     = useState(null);  // chosen option index (null = unanswered)
  const [qScore, setQScore]       = useState(0);

  const stopTtsRef = useRef(null);   // stop() of the current narration
  const timersRef  = useRef([]);     // all pending timeouts of the current slide
  const runRef     = useRef(0);      // generation token — stale timers/onEnd no-op
  const topRuleRef = useRef('');     // the student's top weak rule (for the finished-quiz report)
  const reportedRef = useRef(false); // one drill-event per completed quiz, even on double-click

  const [reducedMotion] = useState(() => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
  });

  // Fetch the student's REAL weakness once, to rank/recommend lessons (congruency). Best-effort:
  // a failure just means no "FÜR DICH" badge — the lessons still work. Same GET /api/progress the
  // dashboard + DailyMission read, so there is one source of truth for "what should I fix".
  useEffect(() => {
    if (!token || !apiUrl) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/progress`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setRec(recommendLesson(d));
        topRuleRef.current = String(d?.topWeakness?.rule || '');   // kept for the finished-quiz report
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, apiUrl]);

  const clearAll = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    try { stopTtsRef.current?.(); } catch { /* ignore */ }
    stopTtsRef.current = null;
  }, []);

  useEffect(() => () => { runRef.current += 1; clearAll(); }, [clearAll]);

  // Play one slide: reveal lines on a timer, narrate, then advance (narration end + beat, never
  // before a minimum read time; hard fallback advances even if the audio element stalls forever).
  const startSlide = useCallback(function start(les, i) {
    runRef.current += 1;
    const run = runRef.current;
    clearAll();
    setLesson(les); setIdx(i); setPhase('play'); setPlaying(true);

    const slide = les.slides[i];
    const total = (slide.lines || []).length;
    setShown(1);
    for (let n = 2; n <= total; n++) {
      timersRef.current.push(setTimeout(() => { if (runRef.current === run) setShown(n); }, LINE_MS * (n - 1)));
    }

    const text = speakTextOf(slide);
    const startedAt = Date.now();
    let advanced = false;
    const advance = () => {
      if (advanced || runRef.current !== run) return;
      advanced = true;
      if (i + 1 < les.slides.length) start(les, i + 1);
      else enterQuiz(les);   // last slide → the hard quiz (not straight to "done")
    };
    const minRead = clamp(text.length * 55, 3000, 25000);   // floor: an instant TTS failure must not skip the slide
    const onEnd = () => {
      if (runRef.current !== run) return;
      const wait = Math.max(BEAT_MS, minRead - (Date.now() - startedAt));
      timersRef.current.push(setTimeout(advance, wait));
    };
    timersRef.current.push(setTimeout(advance, clamp(text.length * 95 + 4000, 9000, 45000)));   // stalled-audio backstop
    stopTtsRef.current = playNative({ apiUrl, token, text, onEnd });
  }, [apiUrl, token, clearAll]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Enter the quiz: freeze narration, shuffle this lesson's questions fresh.
  const enterQuiz = useCallback((les) => {
    runRef.current += 1; clearAll(); setPlaying(false);
    const qs = (les.quiz || []).map(shuffledOptions).map((sh, k) => ({ ...les.quiz[k], ...sh }));
    setQShuffled(qs); setQIdx(0); setQPicked(null); setQScore(0);
    reportedRef.current = false;   // a retake is a NEW completed quiz → new evidence, new report
    setPhase(qs.length ? 'quiz' : 'done');
  }, [clearAll]);

  const pickAnswer = (optIdx) => {
    if (qPicked !== null) return;                 // one pick per question
    setQPicked(optIdx);
    if (optIdx === qShuffled[qIdx].correct) setQScore((s) => s + 1);
  };
  const nextQuestion = () => {
    if (qIdx + 1 < qShuffled.length) { setQIdx(qIdx + 1); setQPicked(null); }
    else {
      // Report ONCE per completed quiz (owner's harmony rule — the brain sees the lesson outcome
      // on the same drill-event spine as every other drill). Fire-and-forget: a network failure
      // only means one missed prep signal, never a blocked learner.
      if (!reportedRef.current && token && apiUrl) {
        reportedRef.current = true;
        try {
          fetch(`${apiUrl}/api/drill-event`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(lessonEventPayload(lesson, qScore, qShuffled.length, topRuleRef.current)) });
        } catch { /* fire-and-forget */ }
      }
      setPhase('done');
    }
  };

  // ── controls ──
  const pause = () => {
    runRef.current += 1; clearAll(); setPlaying(false);
    setShown((lesson?.slides[idx]?.lines || []).length || 1);   // paused = the whole slide is readable
  };
  const resume  = () => startSlide(lesson, idx);                // restarts this slide's narration
  const prev    = () => startSlide(lesson, Math.max(0, idx - 1));
  const next    = () => {
    if (idx + 1 < lesson.slides.length) startSlide(lesson, idx + 1);
    else enterQuiz(lesson);
  };
  const backToList = () => { runRef.current += 1; clearAll(); setLesson(null); setIdx(0); setPhase('play'); setPlaying(false); };
  const close      = () => { runRef.current += 1; clearAll(); onClose?.(); };

  // ── shells ──
  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, #0a1626 0%, #050a12 55%, #020409 100%)',
      color: 'var(--text)', padding: '20px 16px 32px', boxSizing: 'border-box', fontFamily: FONT,
      animation: reducedMotion ? 'none' : 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (backBtn) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', color: '#60a5fa' }}>
        VIDEO-LEKTIONEN{/* OWNER-AR slot: header label */}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        {backBtn && <button onClick={backToList} style={ghostBtn}>‹ Übersicht{/* OWNER-AR slot */}</button>}
        <button onClick={close} style={ghostBtn}>Schließen{/* OWNER-AR slot */}</button>
      </div>
    </div>
  );

  // ── PICKER (recommended lesson floated to the top with a "FÜR DICH" badge) ──
  if (!lesson) {
    const ordered = rec.recId
      ? [...LESSONS].sort((a, b) => (b.id === rec.recId ? 1 : 0) - (a.id === rec.recId ? 1 : 0))
      : LESSONS;
    return shell(<>
      {header(false)}
      <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 18 }}>
        Kurze Lektionen mit Stimme und Text — ansehen, anhören, mitnehmen. Am Ende: harte Fragen.{/* OWNER-AR slot: picker intro */}
      </div>
      {ordered.map((les) => {
        const recommended = les.id === rec.recId;
        return (
          <button key={les.id} onClick={() => startSlide(les, 0)}
            style={{ ...cardBtn, ...(recommended ? { border: '1px solid var(--action)', background: 'var(--surface)' } : {}) }}>
            {recommended && (
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--action)', marginBottom: 8 }}>
                FÜR DICH{/* OWNER-AR slot */}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', lineHeight: 1.35 }}>{les.title}</span>
              <span style={{ fontSize: 11, color: '#60a5fa', whiteSpace: 'nowrap', fontWeight: 700 }}>▶ ≈ {estMinutes(les)} Min.</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, marginTop: 6 }}>
              {recommended && rec.reason ? rec.reason : les.hook}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 8, letterSpacing: '0.06em' }}>
              {les.slides.length} KAPITEL · {les.quiz?.length || 0} FRAGEN · MIT NATIVER STIMME{/* OWNER-AR slot */}
            </div>
          </button>
        );
      })}
    </>);
  }

  // ── QUIZ ──
  if (phase === 'quiz') {
    const qz = qShuffled[qIdx];
    return shell(<>
      {header(true)}
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        {qShuffled.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
            background: i < qIdx ? '#f97316' : i === qIdx ? 'rgba(251,146,60,0.55)' : 'var(--surface-2)' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-faint)', marginBottom: 20, letterSpacing: '0.08em' }}>
        <span>QUIZ · {lesson.title.toUpperCase()}</span>
        <span>{qIdx + 1} / {qShuffled.length}</span>
      </div>

      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1.35, marginBottom: 18 }}>{qz.q}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {qz.options.map((opt, i) => {
          const isCorrect = i === qz.correct;
          const isPicked  = i === qPicked;
          let bg = 'rgba(14,19,32,0.16)', border = 'rgba(96,165,250,0.25)';
          if (qPicked !== null) {
            if (isCorrect) { bg = 'rgba(59,130,246,0.12)'; border = 'rgba(59,130,246,0.5)'; }
            else if (isPicked) { bg = 'rgba(239,68,68,0.12)'; border = 'rgba(239,68,68,0.5)'; }
          }
          return (
            <button key={i} onClick={() => pickAnswer(i)} disabled={qPicked !== null}
              style={{ textAlign: 'left', cursor: qPicked !== null ? 'default' : 'pointer', fontFamily: FONT,
                padding: '14px 16px', minHeight: 44, borderRadius: 11, border: `1px solid ${border}`,
                background: bg, color: 'var(--text)', fontSize: 15, lineHeight: 1.5 }}>
              {qPicked !== null && isCorrect ? '✓ ' : qPicked !== null && isPicked ? '✗ ' : ''}{opt}
            </button>
          );
        })}
      </div>

      {qPicked !== null && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, animation: reducedMotion ? 'none' : 'flash-in 0.35s ease',
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(96,165,250,0.3)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{qz.why}</div>
          <button onClick={nextQuestion} style={{ ...primaryBtn, marginTop: 14 }}>
            {qIdx + 1 < qShuffled.length ? 'Nächste Frage ▸' : 'Ergebnis ▸'}{/* OWNER-AR slot */}
          </button>
        </div>
      )}
    </>);
  }

  // ── DONE (after the quiz) ──
  if (phase === 'done') {
    const total = qShuffled.length;
    const perfect = total > 0 && qScore === total;
    return shell(<>
      {header(true)}
      <div style={{ textAlign: 'center', padding: '30px 0' }}>
        <div style={{ fontSize: 40 }}>{perfect ? '' : '✅'}</div>
        <div style={{ fontSize: 17, color: 'var(--text)', fontWeight: 800, marginTop: 10 }}>
          Lektion beendet{/* OWNER-AR slot */}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.6 }}>{lesson.title}</div>
        {total > 0 && (
          <div style={{ fontSize: 15, color: perfect ? 'var(--good)' : 'var(--text)', fontWeight: 700, marginTop: 14 }}>
            Quiz: {qScore} / {total} richtig{/* OWNER-AR slot */}
          </div>
        )}
        {total > 0 && !perfect && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.6 }}>
            Noch nicht perfekt — schau die Lektion nochmal an und übe die Sätze laut.{/* OWNER-AR slot */}
          </div>
        )}
        <button onClick={() => startSlide(lesson, 0)} style={{ ...primaryBtn, marginTop: 20 }}>↺ Nochmal ansehen{/* OWNER-AR slot */}</button>
        <button onClick={backToList} style={{ ...ghostBtnWide, width: '100%', marginTop: 10 }}>Zur Übersicht{/* OWNER-AR slot */}</button>
      </div>
    </>);
  }

  // ── PLAYER ──
  const slide = lesson.slides[idx];
  const lines = slide.lines || [];
  const riseIn = reducedMotion ? undefined : 'flash-in 0.45s ease';   // the ONE animation: text rise-in

  return shell(<>
    {header(true)}

    {/* slide progress bar */}
    <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
      {lesson.slides.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < idx ? '#3b82f6' : i === idx ? 'rgba(96,165,250,0.55)' : 'var(--surface-2)' }} />
      ))}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-faint)', marginBottom: 22, letterSpacing: '0.08em' }}>
      <span>{lesson.title.toUpperCase()}</span>
      <span>{idx + 1} / {lesson.slides.length}</span>
    </div>

    {/* the slide — kinetic typography */}
    <div key={`${lesson.id}-${idx}`} style={{ minHeight: 300 }}>
      {slide.kicker && (
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color: '#60a5fa', marginBottom: 10, animation: riseIn }}>
          {slide.kicker}
        </div>
      )}
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2, marginBottom: 18, animation: riseIn }}>
        {slide.title}
      </div>

      {lines.slice(0, shown).map((ln, i) => (
        <div key={i} style={{ fontSize: 15.5, color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: 10,
          animation: i === shown - 1 ? riseIn : undefined }}>
          {ln}
        </div>
      ))}

      {shown >= lines.length && slide.falsch && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, animation: riseIn,
          background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.3)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', color: 'var(--text-dim)', marginBottom: 6 }}>
            ✗ FALSCH — so nicht{/* OWNER-AR slot */}
          </div>
          <div style={{ fontSize: 16, color: 'var(--text-dim)', lineHeight: 1.5, textDecoration: 'line-through', textDecorationColor: 'rgba(148,163,184,0.7)' }}>
            {slide.falsch}
          </div>
        </div>
      )}

      {shown >= lines.length && slide.example && (
        <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 10, animation: riseIn,
          background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(96,165,250,0.4)', borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', color: '#60a5fa', marginBottom: 6 }}>
            {slide.falsch ? '✓ RICHTIG' : 'BEISPIEL'}{/* OWNER-AR slot */}
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5 }}>{slide.example}</div>
        </div>
      )}

      {shown >= lines.length && slide.note && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6, marginTop: 16, animation: riseIn }}>{slide.note}</div>
      )}
    </div>

    {/* transport controls */}
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center', marginTop: 26 }}>
      <button onClick={prev} disabled={idx === 0} aria-label="Zurück"
        style={{ ...ctlBtn, opacity: idx === 0 ? 0.35 : 1, cursor: idx === 0 ? 'default' : 'pointer' }}>‹</button>
      <button onClick={playing ? pause : resume} aria-label={playing ? 'Pause' : 'Abspielen'} style={playBtn}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button onClick={next} aria-label="Weiter" style={ctlBtn}>›</button>
      <button onClick={() => startSlide(lesson, idx)} aria-label="Kapitel wiederholen" style={ctlBtn}>↺</button>
    </div>
    <div style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 10 }}>
      {playing ? 'Läuft automatisch weiter — Pause zum Mitlesen.' : 'Pausiert — ▶ startet dieses Kapitel neu.'}{/* OWNER-AR slot */}
    </div>
  </>);
}

// ── styles (shared atoms from ui/primitives; locals below are screen-specific, tokens only) ──
const FONT = "'Inter', system-ui, sans-serif";
const cardBtn = { display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: FONT, padding: '16px',
  minHeight: 44, borderRadius: 12, border: '1px solid rgba(96,165,250,0.25)', background: 'var(--surface)',
  color: 'var(--text)', marginBottom: 12, boxSizing: 'border-box' };
const ctlBtn = { cursor: 'pointer', fontFamily: FONT, fontSize: 20, width: 50, height: 50, borderRadius: 12,
  border: '1px solid rgba(148,163,184,0.35)', background: 'var(--surface-2)', color: 'var(--text-dim)', lineHeight: 1 };
const playBtn = { cursor: 'pointer', fontFamily: FONT, fontSize: 20, width: 64, height: 64, borderRadius: 16, fontWeight: 600,
  border: '1px solid #f97316', background: 'linear-gradient(135deg,#fb923c,#f97316)', color: '#04070d', lineHeight: 1 };

export default VideoLessons;
