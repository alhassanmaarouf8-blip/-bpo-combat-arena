/**
 * trainingslagerContent.js — TIERED Trainingslager content banks. PURE DATA — EDIT FREELY.
 *
 * The engine (trainingslager.js) READS this; it contains NO questions itself. You (the founder)
 * author the real German content here, per SECTION per TIER, without touching engine code.
 *
 * STRUCTURE:
 *   LAGER_SECTIONS = [ SECTION ]
 *   SECTION = { id, title_de, title_ar, icon, minTier, tiers: [ TIER ] }
 *     - id      : stable key (no spaces). NEVER rename an existing one (progress is keyed to it).
 *     - minTier : the student-tier at which this whole section first becomes available
 *                 (1 = basic/start, 2 = unlocks as they improve, 3 = advanced). New topics get a
 *                 higher minTier so they appear only as the student levels up.
 *   TIER = { tier, band, title_de, title_ar, youtubeId_de, youtubeId_ar, teacherName?, teacherChannelUrl?, quiz:[Q,Q,Q] }
 *     - tier : 1 (A2/B1) → 2 (B1/B2) → 3 (B2/C1) → extensible (add 4, 5, …).
 *     - quiz : EXACTLY 3 questions, each EXACTLY 4 options + correctIndex (0–3). Pass = 2/3.
 *
 * HOW TO ADD CONTENT (no code changes):
 *   • Add a TIER:    push a new {tier:4, band:'C1', ready:true, …, quiz:[…]} into a section's `tiers`.
 *   • Add a SECTION: add a new {id:'mein-thema', …, minTier:2, tiers:[…]} object below.
 *   • Replace every  [PLATZHALTER …]  string with real, native German. Keep the shape.
 *   • IMPORTANT: set  ready: true  on a tier ONLY once its quiz is REAL. The engine serves ONLY
 *     ready:true tiers to students — un-ready (placeholder) tiers are NEVER shown (no fake/"hallucinated"
 *     lessons). Until you flip it, that station simply doesn't appear; the map shows an honest state.
 *   • youtubeId_*: leave '' until you have the 11-char id (UI shows a friendly placeholder).
 *
 * Replace the [PLATZHALTER] quizzes with your real questions — the structure already runs end-to-end.
 */

// One placeholder question (valid + gradable) so the system runs before you author real content.
// correctIndex points at the obviously-correct option; replace the whole thing with real German.
const PH = (topic, n) => ({
  question_de:      `[PLATZHALTER ${topic} · Frage ${n}] Welche Formulierung ist höflich und korrekt?`,
  question_ar_hint: `[ضع هنا سؤالك الحقيقي — ${topic}]`,
  options:          ['Könnten Sie mir bitte helfen?', 'Du helfen mir jetzt!', 'Ich brauche Hilfe sofort!', 'Hilfe geben Sie!'],
  correctIndex:     0,
});
const phQuiz = (topic) => [PH(topic, 1), PH(topic, 2), PH(topic, 3)];

export const LAGER_SECTIONS = [
  {
    id: 'telefonieren', icon: '📞', minTier: 1,
    title_de: 'Telefonieren & Etikette', title_ar: 'آداب المكالمة الهاتفية',
    tiers: [
      {
        tier: 1, band: 'A2-B1', ready: true, title_de: 'Telefonieren — Grundlagen', title_ar: 'الأساسيات: بداية المكالمة',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Sie nehmen einen eingehenden Anruf im Kundenservice an. Wie melden Sie sich korrekt?',
            question_ar_hint: 'الرد الصحيح أول ما ترفع السماعة: التحية + اسم الشركة + اسمك',
            options: [
              'Guten Tag, Firma Schmidt GmbH, mein Name ist Ali Hassan.',
              'Ja, hallo?',
              'Wer spricht da bitte?',
              'Was kann ich tun?'
            ],
            correctIndex: 0
          },
          {
            question_de: 'In welcher Reihenfolge bauen Sie eine professionelle Meldeformel auf?',
            question_ar_hint: 'الترتيب الصح للجملة الافتتاحية، والاسم بييجي في الآخر عشان العميل يفتكره',
            options: [
              'Tagesgruß — Firmenname — Ihr Name',
              'Ihr Name — Firmenname — Tagesgruß',
              'Firmenname — Ihr Name — Tagesgruß',
              'Ihr Name — Tagesgruß — Firmenname'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Das Gespräch ist beendet. Wie verabschieden Sie sich am Telefon korrekt?',
            question_ar_hint: 'إزاي تقفل المكالمة صح؟ في التليفون بنقول "Auf Wiederhören" مش "Auf Wiedersehen"',
            options: [
              'Vielen Dank für Ihren Anruf. Auf Wiederhören!',
              'Auf Wiedersehen!',
              'Tschüss, bis dann!',
              'Okay, ciao!'
            ],
            correctIndex: 0
          }
        ]
      },
      {
        tier: 2, band: 'B1-B2', ready: true, title_de: 'Telefonieren — Gespräch steuern', title_ar: 'التحكم في المكالمة',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Sie müssen den Kunden weiterverbinden. Was sagen Sie?',
            question_ar_hint: 'إزاي تحوّل العميل لقسم تاني بأدب؟',
            options: [
              'Einen Moment bitte, ich verbinde Sie mit der zuständigen Abteilung. Bleiben Sie bitte in der Leitung.',
              'Warten Sie.',
              'Das ist nicht meine Abteilung.',
              'Ich gebe Sie weiter, Moment.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Sie haben den Kunden akustisch nicht verstanden. Wie fragen Sie höflich nach?',
            question_ar_hint: 'مفهمتش العميل كويس — أأدب جملة تستخدمها (وبتلقي اللوم على الصوت مش عليه)',
            options: [
              'Entschuldigung, das habe ich akustisch nicht verstanden. Könnten Sie das bitte wiederholen?',
              'Was? Nochmal.',
              'Ich verstehe Sie nicht.',
              'Sprechen Sie lauter.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Der Kunde hat Ihnen sein Anliegen geschildert. Wie bestätigen Sie, dass Sie alles richtig verstanden haben?',
            question_ar_hint: 'إزاي تتأكد إنك فهمت طلب العميل صح؟ بتعيد بصياغتك — ده بيوريه إنك محترف',
            options: [
              'Also, wenn ich Sie richtig verstanden habe, …',
              'Ja, ja, ich weiß.',
              'Das ist klar.',
              'Kein Problem, weiter.'
            ],
            correctIndex: 0
          }
        ]
      },
      {
        tier: 3, band: 'B2-C1', ready: true, title_de: 'Telefonieren — Profi-Niveau', title_ar: 'مستوى المحترفين',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Der Kunde nennt den Namen "Bauer". Sie sind unsicher, ob es B oder P ist. Wie fragen Sie nach?',
            question_ar_hint: 'مش متأكد B ولا P؟ استخدم أبجدية الهاتف عشان تتأكد',
            options: [
              'Mit B wie Berlin oder P wie Potsdam?',
              'B oder P?',
              'Wie war das nochmal?',
              'Können Sie das aufschreiben?'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Sie buchstabieren den Namen "Adam" mit der Buchstabiertafel. Welche Reihenfolge ist korrekt?',
            question_ar_hint: 'هجّي اسم "Adam" بأبجدية الهاتف الكلاسيكية',
            options: [
              'Anton — Dora — Anton — Martha',
              'Aachen — Dora — Aachen — Martha',
              'Anton — David — Anton — Maria',
              'Alfa — Delta — Alfa — Mike'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Sie haben einen Rückruf vereinbart. Wie beenden Sie das Gespräch am professionellsten?',
            question_ar_hint: 'اتفقت على مكالمة رجوع — أحسن طريقة تقفل بيها: تلخّص وتأكد الميعاد',
            options: [
              'Gut, dann fasse ich kurz zusammen: Ich rufe Sie morgen bis 14 Uhr zurück. Habe ich noch etwas vergessen? — Vielen Dank, auf Wiederhören!',
              'Okay, ich rufe an. Tschüss.',
              'Wir telefonieren später nochmal.',
              'Alles klar, bis dann.'
            ],
            correctIndex: 0
          }
        ]
      },
    ],
  },
  {
    id: 'deeskalation', icon: '🧯', minTier: 1,
    title_de: 'Den wütenden Kunden beruhigen', title_ar: 'نزع فتيل العميل الغاضب',
    tiers: [
      {
        tier: 1, band: 'A2-B1', ready: true, title_de: 'Deeskalation — Verständnis zeigen', title_ar: 'تهدئة العميل: إظهار التفهّم',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Ein Kunde ruft wütend an und beschwert sich. Was ist Ihre allererste Reaktion?',
            question_ar_hint: 'العميل بيتكلم بعصبية — أول حاجة تعملها: تسمعه لحد ما يخلص من غير ما تقاطعه',
            options: [
              'Sie lassen ihn ausreden, ohne ihn zu unterbrechen, und hören aktiv zu.',
              'Sie unterbrechen ihn und erklären sofort, warum er sich irrt.',
              'Sie sagen ihm, er soll sich erst beruhigen.',
              'Sie stellen ihn sofort zu einem Kollegen durch.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Der Kunde hat sein Problem geschildert. Welche Formulierung zeigt ihm Verständnis?',
            question_ar_hint: 'إزاي توري العميل إنك فاهم وحاسس بيه؟ الجملة الصح',
            options: [
              'Ich kann verstehen, dass Sie verärgert sind, und es tut mir leid, dass Sie diese Erfahrung machen mussten.',
              'Das ist doch nicht so schlimm.',
              'Da kann ich leider nichts machen.',
              'Das ist nicht mein Fehler.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Sie hören dem Kunden am Telefon zu. Da er Sie nicht sehen kann, wie zeigen Sie, dass Sie aufmerksam zuhören?',
            question_ar_hint: 'العميل مش شايفك في التليفون — لازم تسمّعه إنك بتسمع، بكلمات صغيرة',
            options: [
              'Mit kurzen verbalen Bestätigungen wie "Ich verstehe." oder "Ja.".',
              'Indem Sie ganz still bleiben und nichts sagen.',
              'Indem Sie mit einer anderen Aufgabe weitermachen.',
              'Indem Sie ihn bitten, schneller zu sprechen.'
            ],
            correctIndex: 0
          }
        ]
      },
      {
        tier: 2, band: 'B1-B2', ready: true, title_de: 'Deeskalation — Fehler vermeiden', title_ar: 'تهدئة العميل: تجنّب الأخطاء',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Der Kunde ist verärgert. Welcher Satz ist ein typischer FEHLER, der die Situation verschlimmert?',
            question_ar_hint: 'إيه الجملة الغلط اللي بتزوّد غضب العميل؟ (الـ "بس..." اللي بعدها تبرير)',
            options: [
              'Da kann ich Sie gut verstehen, aber von unserer Seite ist alles richtig gemacht worden.',
              'Ich verstehe, dass Sie verärgert sind. Lassen Sie uns gemeinsam eine Lösung finden.',
              'Es tut mir leid, dass Sie diese Erfahrung gemacht haben.',
              'Ich kümmere mich jetzt persönlich darum.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Warum sollten Sie einem verärgerten Kunden nicht sofort erklären, warum etwas schiefgelaufen ist?',
            question_ar_hint: 'ليه ميصحّش تبدأ تشرح للعميل الغاضب سبب المشكلة على طول؟',
            options: [
              'Weil ein verärgerter Kunde die Erklärung als Rechtfertigung auffasst und sich nicht ernst genommen fühlt.',
              'Weil Erklärungen am Telefon verboten sind.',
              'Weil der Kunde die Erklärung sowieso nicht versteht.',
              'Weil man dafür keine Zeit hat.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Nachdem Sie Verständnis gezeigt haben, wie leiten Sie zur Lösung über?',
            question_ar_hint: 'بعد ما وريته إنك فاهم، إزاي تنقله لمرحلة الحل؟ (بصيغة "إحنا مع بعض")',
            options: [
              'Lassen Sie uns zusammenarbeiten und eine Lösung für die Situation finden.',
              'Sie müssen sich erst beruhigen, dann reden wir.',
              'Ich habe jetzt leider keine Zeit dafür.',
              'Das müssen Sie selbst klären.'
            ],
            correctIndex: 0
          }
        ]
      },
      {
        tier: 3, band: 'B2-C1', ready: true, title_de: 'Deeskalation — Profi-Niveau', title_ar: 'تهدئة العميل: مستوى المحترفين',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Der Kunde hat lange auf eine Rückmeldung gewartet und ist frustriert. Welche Formulierung fasst Anliegen UND Emotion zusammen (aktives Zuhören)?',
            question_ar_hint: 'أعلى مستوى: تلخّص المشكلة والإحساس مع بعض في جملة واحدة — ده اللي المحترف بيعمله',
            options: [
              'Ich verstehe, dass die lange Wartezeit ärgerlich ist. Sie möchten wissen, wann Sie mit einer Rückmeldung rechnen können.',
              'Tut mir leid, aber wir sind im Rückstand, weil so viele anrufen.',
              'Sie sind nicht der Einzige, der warten muss.',
              'Da müssen Sie sich noch etwas gedulden.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Sie können dem Kunden nicht sofort eine Lösung anbieten. Was ist die professionellste Reaktion?',
            question_ar_hint: 'مش قادر تحل دلوقتي حالاً؟ متعملش وعود فاضية — قول الحقيقة وحدّد ميعاد رجوع',
            options: [
              'Ich kann das jetzt nicht sofort lösen, aber ich melde mich heute bis 16 Uhr verbindlich bei Ihnen zurück.',
              'Ich rufe Sie irgendwann zurück.',
              'Das wird schon wieder, keine Sorge.',
              'Versprochen, das ist morgen erledigt. (ohne es zu wissen)'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Der Kunde hatte recht mit seiner Beschwerde. Worauf sollten Sie sich konzentrieren, statt einen Schuldigen zu suchen?',
            question_ar_hint: 'العميل كان معاه حق — ركّز على إيه بدل ما تدوّر على مين غلط؟',
            options: [
              'Auf die Lösung — Schuldzuweisungen vermeiden und gemeinsam die nächsten Schritte vereinbaren.',
              'Darauf, zu beweisen, dass ein Kollege schuld war.',
              'Darauf, dem Kunden eine Teilschuld zu geben.',
              'Darauf, das Gespräch schnell zu beenden.'
            ],
            correctIndex: 0
          }
        ]
      },
    ],
  },
  {
    id: 'vorstellungsgespraech', icon: '💼', minTier: 1,
    title_de: 'Das Vorstellungsgespräch', title_ar: 'مقابلة العمل',
    tiers: [
      { tier: 1, band: 'A2–B1', title_de: 'Interview — sich vorstellen', title_ar: 'التعريف بنفسك', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Interview Vorstellung') },
      { tier: 2, band: 'B1–B2', title_de: 'Interview — Stärken & Beispiele', title_ar: 'نقاط القوة بأمثلة', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Interview Staerken') },
      { tier: 3, band: 'B2–C1', title_de: 'Interview — schwierige Fragen', title_ar: 'الأسئلة الصعبة', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Interview schwer') },
    ],
  },
  {
    // NEW topic that only unlocks once the student has improved (minTier 2).
    id: 'schlechte-nachrichten', icon: '📋', minTier: 2,
    title_de: 'Schlechte Nachrichten überbringen', title_ar: 'إيصال الأخبار السيئة',
    tiers: [
      { tier: 2, band: 'B1–B2', title_de: 'Schlechte Nachrichten — sachlich & freundlich', title_ar: 'بوضوح ولطف', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Schlechte Nachrichten') },
      { tier: 3, band: 'B2–C1', title_de: 'Schlechte Nachrichten — Beschwerde & Kompensation', title_ar: 'الشكوى والتعويض', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Schlechte Nachrichten C1') },
    ],
  },
  {
    // ADVANCED topic, unlocks at tier 3.
    id: 'eskalation-vorgesetzter', icon: '⬆️', minTier: 3,
    title_de: 'Eskalation an den Vorgesetzten', title_ar: 'التصعيد للمشرف',
    tiers: [
      { tier: 3, band: 'B2–C1', title_de: 'Eskalation — sauber übergeben', title_ar: 'تسليم نظيف', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Eskalation Vorgesetzter') },
    ],
  },
];

// Resolve a station id "sectionId:tier" → a lesson-shaped object the existing UI/route understands.
export function getStation(stationId) {
  const [sectionId, tierStr] = String(stationId || '').split(':');
  const tierNum = parseInt(tierStr, 10);
  const section = LAGER_SECTIONS.find((s) => s.id === sectionId);
  if (!section || !Number.isInteger(tierNum)) return null;
  const t = section.tiers.find((x) => x.tier === tierNum);
  if (!t) return null;
  return {
    ruleId:            stationId,
    sectionId:         section.id,
    tier:              t.tier,
    band:              t.band,
    ready:             t.ready === true,     // false until the founder authors real content
    title_de:          `${section.title_de} — Stufe ${t.tier} · ${t.band}`,
    title_ar:          `${section.title_ar} — مستوى ${t.tier}`,
    youtubeId_de:      t.youtubeId_de || '',
    youtubeId_ar:      t.youtubeId_ar || '',
    teacherName:       t.teacherName || '',
    teacherChannelUrl: t.teacherChannelUrl || '',
    quiz:              t.quiz,
  };
}

// Highest tier that has REAL authored content (ready:true). The engine never serves beyond this.
export function maxReadyTier() {
  let m = 0;
  for (const s of LAGER_SECTIONS) for (const t of s.tiers) if (t.ready === true && t.tier > m) m = t.tier;
  return Math.max(1, m);
}

// Stations still on placeholder content (NOT served to students). Reported so the founder knows
// exactly what to author next.
export function unauthoredStations() {
  const out = [];
  for (const s of LAGER_SECTIONS) for (const t of s.tiers) if (t.ready !== true) out.push(`${s.id}:${t.tier}`);
  return out;
}
