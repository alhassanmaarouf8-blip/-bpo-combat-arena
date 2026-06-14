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
      {
        tier: 1, band: 'A2-B1', ready: true, title_de: 'Vorstellungsgespräch — Einstieg & Motivation', title_ar: 'المقابلة: البداية والدافع',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Die Interviewerin sagt: "Erzählen Sie etwas über sich." Was ist die beste Antwort?',
            question_ar_hint: 'سؤال "احكيلي عن نفسك" — مش وقت الهوايات ولا إعادة الـ CV؛ ركّز على خبرتك المهنية المتعلقة بالشغل',
            options: [
              'Ich habe drei Jahre Erfahrung im Kundenservice. Besonders gut bin ich darin, auch schwierige Kunden ruhig und lösungsorientiert zu betreuen.',
              'Ich bin 26 Jahre alt, verheiratet und reise gerne in meiner Freizeit.',
              'Das steht doch alles schon in meinen Unterlagen.',
              'Ich weiß nicht genau, wo ich anfangen soll, vielleicht bei meiner Schulzeit?'
            ],
            correctIndex: 0
          },
          {
            question_de: '"Warum wollen Sie für uns arbeiten?" — Welche Antwort überzeugt den Personaler?',
            question_ar_hint: 'سؤال "ليه عايز تشتغل معانا" — اتكلم من وجهة نظر الشركة: هي هتستفيد منك بإيه',
            options: [
              'Ihr Unternehmen ist für seinen guten Kundenservice bekannt, und ich möchte mit meiner Erfahrung dazu beitragen.',
              'Weil ich dringend einen Job brauche.',
              'Weil Sie die erste Firma sind, die mich eingeladen hat.',
              'Das ist mir eigentlich egal, Hauptsache Arbeit.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Worauf wird im telefonischen Bewerbungsgespräch für einen Call-Center-Job besonders geachtet?',
            question_ar_hint: 'في إنترفيو شغل الكول سنتر بالتليفون — بيركزوا على إيه فيك؟',
            options: [
              'Auf Ihre Stimme: Klarheit, Freundlichkeit und Überzeugungskraft.',
              'Nur auf Ihren schriftlichen Lebenslauf.',
              'Auf Ihr äußeres Erscheinungsbild.',
              'Nur darauf, wie schnell Sie sprechen.'
            ],
            correctIndex: 0
          }
        ]
      },
      {
        tier: 2, band: 'B1-B2', ready: true, title_de: 'Vorstellungsgespräch — Stärken, Schwächen & Druck', title_ar: 'المقابلة: نقاط القوة والضعف والضغط',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: '"Was ist Ihre größte Schwäche?" — Welche Antwort macht den besten Eindruck?',
            question_ar_hint: 'سؤال نقطة الضعف — بلاش الكليشيهات زي "أنا perfektionist"؛ اذكر ضعف حقيقي وبتشتغل عليه',
            options: [
              'Ich hatte früher Lampenfieber beim Telefonieren. Deshalb habe ich gezielt geübt und fühle mich heute deutlich sicherer.',
              'Ich bin einfach zu perfektionistisch.',
              'Ich arbeite zu viel und zu hart.',
              'Ich habe eigentlich keine Schwächen.'
            ],
            correctIndex: 0
          },
          {
            question_de: '"Wie gehen Sie mit Kritik um?" — Was will der Personaler hören?',
            question_ar_hint: 'سؤال "بتتعامل مع النقد إزاي" — وريه إنك بتاخد النقد كفرصة تتطور، مش بتتجاهله',
            options: [
              'Ich sehe Kritik als Chance, mich weiterzuentwickeln, und nehme Ratschläge ernst.',
              'Kritik nehme ich mir nicht zu Herzen, ich mache es einfach wie immer.',
              'Ich mag keine Kritik, weil ich meistens recht habe.',
              'Das kommt darauf an, wer mich kritisiert.'
            ],
            correctIndex: 0
          },
          {
            question_de: '"Wie arbeiten Sie unter Druck?" — Welche Antwort zeigt die richtige Einstellung für den Kundenservice?',
            question_ar_hint: 'سؤال الشغل تحت ضغط — الضغط جزء من الشغل؛ وريه إنك بتهدّي وبتحل بشكل منظّم',
            options: [
              'Druck gehört zum Kundenservice dazu. In stressigen Situationen atme ich erst tief durch und löse das Problem dann ruhig und strukturiert.',
              'Unter Druck werde ich nervös und mache Fehler.',
              'Ich vermeide Stress, indem ich schwierige Anrufe weitergebe.',
              'Druck mag ich gar nicht, ich brauche immer viel Zeit.'
            ],
            correctIndex: 0
          }
        ]
      },
      {
        tier: 3, band: 'B2-C1', ready: true, title_de: 'Vorstellungsgespräch — STAR-Methode & Rollenspiel', title_ar: 'المقابلة: طريقة STAR والـ Rollenspiel',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Sie beantworten eine Verhaltensfrage mit der STAR-Methode. Wofür stehen die vier Buchstaben?',
            question_ar_hint: 'طريقة STAR لإجابة أسئلة المواقف — الأربع حروف معناها إيه بالترتيب؟',
            options: [
              'Situation, Task (Aufgabe), Action (Handlung), Result (Ergebnis)',
              'Stärke, Talent, Antwort, Resultat',
              'Situation, Thema, Anfang, Rückblick',
              'Start, Test, Aktion, Reaktion'
            ],
            correctIndex: 0
          },
          {
            question_de: '"Beschreiben Sie eine Situation, in der Sie einen schwierigen Kunden betreut haben." Was fehlt der meisten Antworten — und ist am wichtigsten?',
            question_ar_hint: 'في إجابة موقف العميل الصعب — أهم حاجة ناس كتير بتنساها: النتيجة في الآخر',
            options: [
              'Das konkrete Ergebnis am Ende — was durch Ihr Handeln erreicht wurde.',
              'Eine lange Beschreibung der Firma.',
              'Wie lange das Gespräch gedauert hat.',
              'Die Namen aller beteiligten Kollegen.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Die Interviewerin spielt plötzlich einen wütenden Kunden, der sein Geld zurückverlangt (Rollenspiel). Wie reagieren Sie am besten?',
            question_ar_hint: 'الـ HR فجأة بتمثّل عميل غاضب عايز فلوسه — ده اختبار؛ فضل مؤدب وركّز على الحل',
            options: [
              'Ich bleibe ruhig und höflich, zeige Verständnis und konzentriere mich auf eine Lösung für den Kunden.',
              'Ich erkläre dem Kunden sofort, dass er im Unrecht ist.',
              'Ich werde laut, um mich durchzusetzen.',
              'Ich sage, dass ich dafür nicht zuständig bin.'
            ],
            correctIndex: 0
          }
        ]
      },
    ],
  },
  {
    // NEW topic that only unlocks once the student has improved (minTier 2).
    id: 'schlechte-nachrichten', icon: '📋', minTier: 2,
    title_de: 'Schlechte Nachrichten überbringen', title_ar: 'إيصال الأخبار السيئة',
    tiers: [
      {
        tier: 2, band: 'B1-B2', ready: true, title_de: 'Schlechte Nachrichten — Positiv formulieren', title_ar: 'الأخبار السيئة: الصياغة الإيجابية',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Sie können dem Kunden den Liefertermin nicht nennen. Welche Formulierung ist besser?',
            question_ar_hint: 'مش عارف ميعاد التسليم — بدل ما تقول "مش عارف"، صيغها بشكل إيجابي',
            options: [
              'Ich lasse Sie sobald wie möglich wissen, wann wir liefern können.',
              'Wir haben keine Ahnung, wann wir liefern können.',
              'Das kann ich Ihnen nicht sagen.',
              'Da müssen Sie selbst nachfragen.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Bei der Suche nach einer Lösung gab es Probleme. Wie teilen Sie das positiv mit?',
            question_ar_hint: 'لسه مفيش حل — بدل "مقدرناش نلاقي حل"، ورّيه إنكم شغّالين عليه',
            options: [
              'Wir arbeiten mit Hochdruck an einer Lösung für Sie.',
              'Wir konnten trotz vieler Tests bisher keine Lösung finden.',
              'Das Problem ist leider zu kompliziert für uns.',
              'Da kann man nichts machen.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Es ist ein Fehler passiert. Welche Formulierung schützt das Vertrauen des Kunden am besten?',
            question_ar_hint: 'حصل غلط — متلقّيش اللوم على زميلك؛ ركّز إنكم لقيتوا السبب',
            options: [
              'Wir konnten die Ursache des Fehlers feststellen und kümmern uns darum.',
              'Mein Kollege, Herr Schmidt, trägt die Schuld an dem Fehler.',
              'Das war nicht meine Abteilung.',
              'So etwas passiert eben manchmal.'
            ],
            correctIndex: 0
          }
        ]
      },
      {
        tier: 3, band: 'B2-C1', ready: true, title_de: 'Schlechte Nachrichten — Absage mit Alternative', title_ar: 'الأخبار السيئة: الرفض مع تقديم بديل',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Der Wunsch des Kunden lässt sich nicht erfüllen. Was ist die professionellste Reaktion?',
            question_ar_hint: 'مش هتقدر تنفّذ طلب العميل — أحسن حاجة: ترفض بأدب وتقدّم بديل في نفس الجملة',
            options: [
              'Das ist leider nicht möglich, aber ich kann Ihnen gerne eine Alternative anbieten — darf ich?',
              'Nein, das geht nicht.',
              'Das ist nicht mein Problem.',
              'Da kann ich Ihnen leider nicht helfen. Auf Wiederhören.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Das gewünschte Produkt wird nicht mehr hergestellt. Welche Antwort verbindet die Absage mit einem Lösungsvorschlag?',
            question_ar_hint: 'المنتج اللي عايزه خلص ومبيتصنّعش — اربط الرفض باقتراح بديل وسؤال',
            options: [
              'Diese Produktserie wird leider nicht mehr produziert. Ich kann Ihnen aber gerne unsere neuen Modelle vorstellen — welches davon gefällt Ihnen?',
              'Das Produkt gibt es nicht mehr, tut mir leid.',
              'Da haben Sie Pech gehabt, das ist ausverkauft.',
              'Probieren Sie es bei einem anderen Anbieter.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Der Fehler lag eindeutig bei Ihrem Unternehmen. Wie schließen Sie das Gespräch professionell ab?',
            question_ar_hint: 'الغلط كان من شركتكم بوضوح — اعتذر باختصار من غير مبالغة، وقول الخطوة الجاية',
            options: [
              'Wir bedauern diesen Umstand sehr. Ich kümmere mich persönlich darum und melde mich heute bis 16 Uhr bei Ihnen zurück.',
              'Es tut mir leid, es tut mir wirklich sehr leid, bitte entschuldigen Sie vielmals, es tut mir so leid…',
              'Naja, Fehler passieren eben.',
              'Das war nicht meine Schuld, aber okay, tut mir leid.'
            ],
            correctIndex: 0
          }
        ]
      },
    ],
  },
  {
    // ADVANCED topic, unlocks at tier 3.
    id: 'eskalation-vorgesetzter', icon: '⬆️', minTier: 3,
    title_de: 'Eskalation an den Vorgesetzten', title_ar: 'التصعيد للمشرف',
    tiers: [
      {
        tier: 3, band: 'B2-C1', ready: true, title_de: 'Eskalation — "Ich will Ihren Vorgesetzten sprechen"', title_ar: 'التصعيد: "عايز أكلّم مديرك"',
        youtubeId_de: '', youtubeId_ar: '',
        quiz: [
          {
            question_de: 'Der Kunde verlangt sofort Ihren Vorgesetzten, ohne zu sagen, worum es geht. Was tun Sie zuerst?',
            question_ar_hint: 'العميل عايز مديرك على طول من غير ما يقول السبب — أول حاجة: حاول تفهم المشكلة وتحلها بنفسك بأدب',
            options: [
              'Ich versuche höflich zu verstehen, worum es geht: "Damit ich Sie richtig weiterleiten kann — worum geht es denn genau? Vielleicht kann ich Ihnen direkt helfen."',
              'Ich stelle ihn sofort wortlos durch.',
              'Ich sage ihm, mein Chef sei nicht erreichbar, und lege auf.',
              'Ich sage: "Dafür bin ich nicht zuständig."'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Sie müssen den Kunden tatsächlich weiterverbinden. Welche Formulierung ist professionell und positiv?',
            question_ar_hint: 'محتاج تحوّله فعلاً — صيغة إيجابية بتسمّي الزميل المختص بدل "أنا مش مسؤول"',
            options: [
              'Da kann Ihnen Frau Müller am besten weiterhelfen. Einen Augenblick bitte, ich verbinde Sie weiter.',
              'Tut mir leid, dafür bin ich nicht zuständig.',
              'Moment, ich gebe Sie irgendwie weiter.',
              'Warten Sie, ich weiß nicht, wer das macht.'
            ],
            correctIndex: 0
          },
          {
            question_de: 'Der Kunde wird beleidigend und beschimpft Sie weiter persönlich. Wie reagieren Sie korrekt?',
            question_ar_hint: 'العميل بقى بيشتمك شخصياً — تشرحله إنك هتجيب الدعم، ولو فضل بيشتم تنهي المكالمة بأدب',
            options: [
              'Ich hole meinen Vorgesetzten hinzu und erkläre dem Kunden, dass ich Unterstützung einhole und warum. Beruhigt er sich weiterhin nicht, beende ich das Gespräch höflich.',
              'Ich beschimpfe ihn zurück, damit er aufhört.',
              'Ich lege sofort wortlos auf.',
              'Ich lasse mich beschimpfen und sage gar nichts.'
            ],
            correctIndex: 0
          }
        ]
      },
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
