/**
 * lessons.config.js — TRAININGSLAGER lesson library (the study-mode content).
 *
 * This file is pure DATA. It opens NO AI call and NO Realtime/voice session — it is just a
 * list of lessons the app shows on the game-map, each with a YouTube video slot and a quiz.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *  HOW TO ADD A YOUTUBE VIDEO  (for a non-technical editor — read this carefully)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *  1. Open the video on YouTube. Look at its web address (URL), for example:
 *
 *         https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *                                          └────┬────┘
 *                                     this part = the VIDEO ID
 *
 *     (Or, from a share link:  https://youtu.be/dQw4w9WgXcQ  → same ID after the "/".)
 *
 *  2. The VIDEO ID is ALWAYS exactly 11 characters (letters, numbers, - and _).
 *
 *  3. In the lesson below, find  youtubeId_de: "PLACEHOLDER_DE"  and replace ONLY the text
 *     inside the quotes with those 11 characters:
 *
 *         youtubeId_de: "dQw4w9WgXcQ",   ←  the German-explained video
 *         youtubeId_ar: "dQw4w9WgXcQ",   ←  the Arabic-explained video
 *
 *     Keep the quotes "" and the comma. Paste ONLY the 11 characters — no https://, no spaces.
 *
 *  4. (Optional) Fill teacherName and teacherChannelUrl to credit the teacher.
 *
 *  Until you paste a real ID, the app shows a friendly "Video kommt bald" placeholder instead
 *  of a broken player — so leaving PLACEHOLDER values never breaks anything.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 *  ruleId  — the stable lesson key. The recommendation engine (Phase 2) maps a learner's
 *            grammar-checker error tags onto these ruleIds, so DO NOT rename an existing one.
 *  quiz    — EXACTLY 3 multiple-choice questions, each with EXACTLY 4 options and the index
 *            (0,1,2,3) of the correct one. Passing = at least 2 of 3 correct.
 */

// ── ONE fully-worked EXAMPLE (a template to copy — this is NOT shown in the app) ──────────
// Every real lesson in LESSONS (below) has exactly this shape. Use it as your reference.
export const EXAMPLE_LESSON = {
  ruleId:            'beispiel',                 // a unique id (no spaces) — never reuse one
  title_de:          'Beispiel-Lektion: Konjunktiv II',
  title_ar:          'درس نموذجي: صيغة الكونيونكتيف الثانية',
  youtubeId_de:      'PLACEHOLDER_DE',           // ←—— PASTE the 11-char German video ID here
  youtubeId_ar:      'PLACEHOLDER_AR',           // ←—— PASTE the 11-char Arabic video ID here
  teacherName:       '',                         // optional, e.g. 'Deutsch mit Marija'
  teacherChannelUrl: '',                         // optional, e.g. 'https://www.youtube.com/@...'
  quiz: [
    {
      question_de:      'Wie lautet die höfliche Bitte „Können Sie mir helfen?" im Konjunktiv II?',
      question_ar_hint: 'صيغة الطلب المهذّب (هل يمكنك مساعدتي؟)',
      options:          ['Könnten Sie mir helfen?', 'Konnten Sie mir helfen?', 'Können Sie mir geholfen?', 'Könnt Sie mir helfen?'],
      correctIndex:     0,
    },
    {
      question_de:      'Welcher Satz drückt einen irrealen Wunsch korrekt aus?',
      question_ar_hint: 'تمنٍّ غير واقعي (لو كان عندي وقت…)',
      options:          ['Wenn ich Zeit hätte, würde ich kommen.', 'Wenn ich Zeit habe, würde ich kommen.', 'Wenn ich Zeit hatte, werde ich kommen.', 'Wenn ich Zeit haben, würde ich kommen.'],
      correctIndex:     0,
    },
    {
      question_de:      'Was ist die Konjunktiv-II-Form von „sein" (ich)?',
      question_ar_hint: 'صيغة الفعل sein في الكونيونكتيف',
      options:          ['wäre', 'war', 'bin', 'wese'],
      correctIndex:     0,
    },
  ],
};

// ── THE 20 REAL LESSONS (12 grammar + 8 customer-service) ─────────────────────────────────
export const LESSONS = [
  // ===== GRAMMAR =====
  {
    ruleId: 'konjunktiv-2',
    title_de: 'Konjunktiv II (höfliche Bitten & Wünsche)',
    title_ar: 'الكونيونكتيف الثانية (الطلب المهذّب والتمني)',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Wie lautet die höfliche Bitte „Können Sie mir helfen?" im Konjunktiv II?', question_ar_hint: 'صيغة الطلب المهذّب (هل يمكنك مساعدتي؟)', options: ['Könnten Sie mir helfen?', 'Konnten Sie mir helfen?', 'Können Sie mir geholfen?', 'Könnt Sie mir helfen?'], correctIndex: 0 },
      { question_de: 'Welcher Satz drückt einen irrealen Wunsch korrekt aus?', question_ar_hint: 'تمنٍّ غير واقعي (لو كان عندي وقت…)', options: ['Wenn ich Zeit hätte, würde ich kommen.', 'Wenn ich Zeit habe, würde ich kommen.', 'Wenn ich Zeit hatte, werde ich kommen.', 'Wenn ich Zeit haben, würde ich kommen.'], correctIndex: 0 },
      { question_de: 'Was ist die Konjunktiv-II-Form von „haben" (ich)?', question_ar_hint: 'صيغة الفعل haben في الكونيونكتيف', options: ['hätte', 'hatte', 'habe', 'gehabt'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'dativ-akkusativ',
    title_de: 'Dativ & Akkusativ (Fälle richtig wählen)',
    title_ar: 'حالتا المفعول (Dativ و Akkusativ)',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ich gebe ___ Kunden die Rechnung.', question_ar_hint: 'أداة التعريف بعد فعل "يُعطي" (حالة Dativ)', options: ['dem', 'den', 'der', 'das'], correctIndex: 0 },
      { question_de: 'Ich sehe ___ Mann.', question_ar_hint: 'مفعول مباشر مذكّر (Akkusativ)', options: ['den', 'dem', 'der', 'das'], correctIndex: 0 },
      { question_de: 'Welche Präposition steht immer mit dem Dativ?', question_ar_hint: 'حرف جر يأتي دائمًا مع Dativ', options: ['mit', 'für', 'ohne', 'durch'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'trennbare-verben',
    title_de: 'Trennbare Verben (anrufen, aufstehen …)',
    title_ar: 'الأفعال المنفصلة',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ich ___ den Kunden ___. (anrufen)', question_ar_hint: 'أين يذهب المقطع المنفصل في الجملة؟', options: ['rufe … an', 'anrufe … —', 'ruf … ane', 'rufe an … an'], correctIndex: 0 },
      { question_de: 'Welches Verb ist trennbar?', question_ar_hint: 'أيّ فعل قابل للانفصال؟', options: ['aufstehen', 'verstehen', 'bekommen', 'erzählen'], correctIndex: 0 },
      { question_de: 'Nebensatz: „… weil ich früh ___." (aufstehen)', question_ar_hint: 'الفعل المنفصل داخل جملة بـ weil', options: ['aufstehe', 'auf stehe', 'stehe auf', 'aufstehen'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'passiv',
    title_de: 'Passiv (wird bearbeitet …)',
    title_ar: 'المبني للمجهول',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Aktiv: „Wir bearbeiten Ihre Anfrage." → Passiv:', question_ar_hint: 'تحويل الجملة للمبني للمجهول', options: ['Ihre Anfrage wird bearbeitet.', 'Ihre Anfrage ist bearbeiten.', 'Ihre Anfrage hat bearbeitet.', 'Ihre Anfrage wird bearbeiten.'], correctIndex: 0 },
      { question_de: 'Welches Hilfsverb bildet das Passiv?', question_ar_hint: 'الفعل المساعد للمبني للمجهول', options: ['werden', 'haben', 'sein', 'müssen'], correctIndex: 0 },
      { question_de: 'Das Paket ___ gestern geliefert. (Präteritum Passiv)', question_ar_hint: 'المبني للمجهول في الماضي', options: ['wurde', 'wird', 'war', 'hat'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'futur-1',
    title_de: 'Futur I (Ich werde Sie zurückrufen)',
    title_ar: 'زمن المستقبل (Futur I)',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ich ___ Sie morgen ___. (zurückrufen)', question_ar_hint: 'المستقبل: سأتصل بك غدًا', options: ['werde … zurückrufen', 'wird … zurückrufen', 'werde … zurückgerufen', 'bin … zurückrufen'], correctIndex: 0 },
      { question_de: 'Welches Hilfsverb bildet das Futur I?', question_ar_hint: 'الفعل المساعد لزمن المستقبل', options: ['werden', 'haben', 'sein', 'wollen'], correctIndex: 0 },
      { question_de: 'Welcher Satz ist korrektes Futur I?', question_ar_hint: 'جملة مستقبل صحيحة', options: ['Wir werden das Problem lösen.', 'Wir werden das Problem gelöst.', 'Wir haben das Problem lösen.', 'Wir sind das Problem lösen.'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'komparativ-superlativ',
    title_de: 'Komparativ & Superlativ (besser, am besten)',
    title_ar: 'صيغ المقارنة والتفضيل',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Steigerung von „gut":', question_ar_hint: 'تصريف gut في المقارنة والتفضيل', options: ['gut – besser – am besten', 'gut – guter – am gutsten', 'gut – mehr gut – am meisten', 'gut – besser – am beststen'], correctIndex: 0 },
      { question_de: 'Dieses Angebot ist ___ als das andere. (günstig)', question_ar_hint: 'صيغة المقارنة (أرخص من)', options: ['günstiger', 'günstigst', 'am günstigsten', 'günstig'], correctIndex: 0 },
      { question_de: 'Superlativ von „schnell":', question_ar_hint: 'صيغة التفضيل لـ schnell', options: ['am schnellsten', 'am schnellster', 'der schnell', 'mehr schnell'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'relativsaetze',
    title_de: 'Relativsätze (der Kunde, der …)',
    title_ar: 'الجمل الوصلية (الذي/التي)',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Der Kunde, ___ angerufen hat, ist zufrieden.', question_ar_hint: 'ضمير الوصل (العميل الذي اتصل)', options: ['der', 'den', 'dem', 'das'], correctIndex: 0 },
      { question_de: 'Das ist die Firma, ___ ich arbeite. (bei + Dativ)', question_ar_hint: 'ضمير وصل مع حرف جر (الشركة التي أعمل بها)', options: ['bei der', 'die', 'der', 'bei die'], correctIndex: 0 },
      { question_de: 'Die Bestellung, ___ ich aufgegeben habe, kam an. (Akkusativ)', question_ar_hint: 'ضمير وصل في حالة المفعول', options: ['die', 'der', 'dem', 'das'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'praeteritum',
    title_de: 'Präteritum (Erzählzeit: war, hatte, ging)',
    title_ar: 'الماضي البسيط (Präteritum)',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Präteritum von „haben" (ich):', question_ar_hint: 'ماضي haben', options: ['hatte', 'habte', 'gehabt', 'habe'], correctIndex: 0 },
      { question_de: 'Präteritum von „gehen" (er):', question_ar_hint: 'ماضي gehen', options: ['ging', 'gehte', 'gegangen', 'geht'], correctIndex: 0 },
      { question_de: 'Welcher Satz steht im Präteritum?', question_ar_hint: 'أي جملة في الماضي البسيط؟', options: ['Ich arbeitete bei einer Firma.', 'Ich habe gearbeitet.', 'Ich arbeite.', 'Ich werde arbeiten.'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'w-fragen',
    title_de: 'W-Fragen (wer, was, wann, warum, wie)',
    title_ar: 'أدوات الاستفهام',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Frage nach dem Grund:', question_ar_hint: 'السؤال عن السبب', options: ['Warum rufen Sie an?', 'Wann rufen Sie an?', 'Wer ruft an?', 'Wie rufen Sie an?'], correctIndex: 0 },
      { question_de: '„___ kann ich Ihnen helfen?" (Art und Weise)', question_ar_hint: 'السؤال عن الطريقة (كيف)', options: ['Wie', 'Wer', 'Was', 'Wo'], correctIndex: 0 },
      { question_de: 'Welches Fragewort fragt nach einer Person?', question_ar_hint: 'أداة السؤال عن شخص', options: ['Wer', 'Was', 'Wo', 'Wann'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'negation',
    title_de: 'Negation (nicht oder kein?)',
    title_ar: 'النفي (متى nicht ومتى kein)',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ich habe ___ Zeit.', question_ar_hint: 'نفي اسم (ليس عندي وقت)', options: ['keine', 'nicht', 'kein', 'nichts'], correctIndex: 0 },
      { question_de: 'Der Kunde ist ___ zufrieden.', question_ar_hint: 'نفي صفة بـ nicht', options: ['nicht', 'kein', 'keine', 'nichts'], correctIndex: 0 },
      { question_de: 'Wir haben ___ Termin frei. (maskulin)', question_ar_hint: 'نفي اسم مذكّر منصوب', options: ['keinen', 'nicht', 'kein', 'keine'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'adjektivendungen',
    title_de: 'Adjektivendungen (ein netter Kunde)',
    title_ar: 'نهايات الصفات',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'ein ___ Kunde (Nominativ, maskulin)', question_ar_hint: 'نهاية الصفة بعد ein (مذكّر فاعل)', options: ['netter', 'nette', 'nettes', 'netten'], correctIndex: 0 },
      { question_de: 'die ___ Lösung (Nominativ, feminin)', question_ar_hint: 'نهاية الصفة بعد die (مؤنّث)', options: ['beste', 'bester', 'bestes', 'besten'], correctIndex: 0 },
      { question_de: 'mit ___ Service (Dativ, maskulin)', question_ar_hint: 'نهاية الصفة في حالة Dativ', options: ['gutem', 'guter', 'gutes', 'gute'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'modalverben',
    title_de: 'Modalverben (können, müssen, dürfen)',
    title_ar: 'الأفعال الناقصة',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ich ___ Ihnen helfen. (Fähigkeit)', question_ar_hint: 'فعل القدرة (أستطيع)', options: ['kann', 'muss', 'darf', 'soll'], correctIndex: 0 },
      { question_de: 'Wo steht das zweite Verb bei Modalverben?', question_ar_hint: 'أين يقع الفعل الثاني مع الأفعال الناقصة؟', options: ['am Satzende im Infinitiv', 'direkt nach dem Subjekt', 'am Satzanfang', 'konjugiert in der Mitte'], correctIndex: 0 },
      { question_de: 'Sie ___ einen Termin machen. (Notwendigkeit)', question_ar_hint: 'فعل الضرورة (يجب)', options: ['müssen', 'dürfen', 'können', 'mögen'], correctIndex: 0 },
    ],
  },

  // ===== CUSTOMER SERVICE =====
  {
    ruleId: 'telefonalphabet',
    title_de: 'Telefonalphabet (A wie Anton)',
    title_ar: 'أبجدية الهاتف (تهجئة الأسماء)',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: '„A wie ___"', question_ar_hint: 'حرف A يُهجّى بـ…؟', options: ['Anton', 'Apfel', 'Adler', 'Anna'], correctIndex: 0 },
      { question_de: '„B wie ___"', question_ar_hint: 'حرف B يُهجّى بـ…؟', options: ['Berta', 'Bruno', 'Ball', 'Bär'], correctIndex: 0 },
      { question_de: 'Wozu dient das Telefonalphabet?', question_ar_hint: 'فائدة أبجدية الهاتف', options: ['Namen/Wörter klar buchstabieren', 'schneller sprechen', 'Zahlen nennen', 'Grüße austauschen'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'telefonieren',
    title_de: 'Telefonieren auf Deutsch (Gespräche führen)',
    title_ar: 'آداب المكالمة الهاتفية',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Wie meldet man sich höflich am Telefon?', question_ar_hint: 'كيف تردّ بأدب على الهاتف؟', options: ['Guten Tag, mein Name ist … Was kann ich für Sie tun?', 'Hallo, was willst du?', 'Ja?', 'Wer ist da?'], correctIndex: 0 },
      { question_de: 'Der Anrufer ist schwer zu verstehen. Was sagen Sie?', question_ar_hint: 'لو الصوت غير واضح، ماذا تقول؟', options: ['Könnten Sie das bitte wiederholen?', 'Sprich lauter!', 'Ich verstehe nichts, tschüss.', 'Was?'], correctIndex: 0 },
      { question_de: 'Wie beendet man das Gespräch höflich?', question_ar_hint: 'إنهاء المكالمة بأدب', options: ['Vielen Dank für Ihren Anruf. Auf Wiederhören!', 'Okay, ciao.', 'Ende.', 'Ich lege jetzt auf.'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'reklamation',
    title_de: 'Reklamation & Beschwerde (Probleme lösen)',
    title_ar: 'التعامل مع الشكاوى',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ein Kunde beschwert sich. Bester erster Satz?', question_ar_hint: 'أفضل ردّ أول على شكوى', options: ['Das tut mir leid. Ich kümmere mich sofort darum.', 'Das ist nicht mein Problem.', 'Da kann man nichts machen.', 'Sie haben sicher etwas falsch gemacht.'], correctIndex: 0 },
      { question_de: 'Wie zeigt man Verständnis?', question_ar_hint: 'إظهار التفهّم', options: ['Ich verstehe Ihren Ärger.', 'Beruhigen Sie sich.', 'Das ist doch nicht so schlimm.', 'Warum regen Sie sich auf?'], correctIndex: 0 },
      { question_de: 'Wie bietet man eine Lösung an?', question_ar_hint: 'عرض حل', options: ['Ich schlage vor, dass wir … – ist das in Ordnung?', 'Das geht nicht.', 'Vielleicht später.', 'Keine Ahnung.'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'vorstellungsgespraech',
    title_de: 'Vorstellungsgespräch (sich gut präsentieren)',
    title_ar: 'مقابلة العمل',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: '„Warum sollten wir Sie einstellen?" – beste Antwortstruktur?', question_ar_hint: 'هيكل الإجابة على "لماذا نوظّفك؟"', options: ['Stärke + konkretes Beispiel + Nutzen für die Firma', 'Weil ich Geld brauche', 'Weil ich nett bin', 'Keine Ahnung, probieren wir es'], correctIndex: 0 },
      { question_de: 'Welche Anrede ist im Gespräch korrekt?', question_ar_hint: 'صيغة المخاطبة الرسمية', options: ['Sie', 'du', 'ihr', 'man'], correctIndex: 0 },
      { question_de: 'Gute Frage am Ende des Gesprächs:', question_ar_hint: 'سؤال جيد في نهاية المقابلة', options: ['Wie sieht ein typischer Arbeitstag aus?', 'Wann habe ich frei?', 'Muss ich wirklich pünktlich sein?', 'Wie viel Urlaub bekomme ich sofort?'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'online-einkauf',
    title_de: 'Online-Einkauf & Shopping (Bestellungen)',
    title_ar: 'التسوّق والطلب أونلاين',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ich möchte meine Bestellung ___. (rückgängig machen)', question_ar_hint: 'إلغاء الطلب', options: ['stornieren', 'kaufen', 'liefern', 'bezahlen'], correctIndex: 0 },
      { question_de: 'Was ist die „Lieferadresse"?', question_ar_hint: 'ما معنى Lieferadresse؟', options: ['wohin das Paket geschickt wird', 'der Preis', 'die Rechnung', 'der Verkäufer'], correctIndex: 0 },
      { question_de: 'Die Ware ist ___. (nicht mehr verfügbar)', question_ar_hint: 'البضاعة "نفدت"', options: ['ausverkauft', 'kostenlos', 'geöffnet', 'pünktlich'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'kunden-beruhigen',
    title_de: 'Kunden beruhigen (Deeskalation)',
    title_ar: 'تهدئة العميل الغاضب',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Ein wütender Kunde schreit. Beste Reaktion?', question_ar_hint: 'أفضل ردّ على عميل غاضب يصرخ', options: ['Ruhig bleiben, zuhören, Verständnis zeigen', 'Zurückschreien', 'Auflegen', 'Ignorieren'], correctIndex: 0 },
      { question_de: 'Welcher Satz deeskaliert?', question_ar_hint: 'جملة تُهدّئ الموقف', options: ['Ich verstehe Sie – lassen Sie uns das gemeinsam lösen.', 'Das ist Ihre Schuld.', 'Regen Sie sich nicht auf.', 'Das interessiert mich nicht.'], correctIndex: 0 },
      { question_de: 'Was hilft beim Beruhigen?', question_ar_hint: 'ما الذي يساعد على التهدئة؟', options: ['aktiv zuhören und sich entschuldigen', 'schnell reden', 'den Kunden unterbrechen', 'Ausreden suchen'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'zahlen-datum-geld',
    title_de: 'Zahlen, Datum & Geld (149,99 €, der 3. Mai)',
    title_ar: 'الأرقام والتواريخ والمبالغ',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: '„149,99 €" spricht man:', question_ar_hint: 'نطق 149,99 يورو', options: ['einhundertneunundvierzig Euro neunundneunzig', 'hundert vierzig neun Euro', 'einhundert neunzig vier Euro', 'neunundvierzig hundert Euro'], correctIndex: 0 },
      { question_de: '„Der 3. Mai" – wie sagt man das Datum?', question_ar_hint: 'نطق التاريخ (الثالث من مايو)', options: ['der dritte Mai', 'der drei Mai', 'der dritter Mai', 'der dreite Mai'], correctIndex: 0 },
      { question_de: '„21" heißt:', question_ar_hint: 'الرقم 21', options: ['einundzwanzig', 'zwanzigeins', 'zweiundzehn', 'einzwanzig'], correctIndex: 0 },
    ],
  },
  {
    ruleId: 'hoeflichkeit',
    title_de: 'Höflichkeit & formelle Sprache (Sie-Form)',
    title_ar: 'الأدب والرسمية في الكلام',
    youtubeId_de: 'PLACEHOLDER_DE', youtubeId_ar: 'PLACEHOLDER_AR', teacherName: '', teacherChannelUrl: '',
    quiz: [
      { question_de: 'Welche Bitte ist am höflichsten?', question_ar_hint: 'أكثر طلب تهذيبًا', options: ['Könnten Sie mir bitte helfen?', 'Hilf mir.', 'Ich will Hilfe.', 'Helfen!'], correctIndex: 0 },
      { question_de: 'Formelle Anrede in einer E-Mail:', question_ar_hint: 'تحية رسمية في إيميل', options: ['Sehr geehrte Damen und Herren,', 'Hi,', 'Hallo Leute,', 'Na,'], correctIndex: 0 },
      { question_de: 'Höfliche Ablehnung:', question_ar_hint: 'رفض مهذّب', options: ['Leider ist das im Moment nicht möglich.', 'Nein.', 'Geht nicht.', 'Auf keinen Fall.'], correctIndex: 0 },
    ],
  },
];

// The hardcoded starter path for brand-new users with no error history (used by Phase 2).
export const STARTER_PATH = ['telefonalphabet', 'telefonieren', 'vorstellungsgespraech'];

// Fast lookups (kept here so every consumer shares one source of truth).
export const LESSON_BY_RULE = Object.fromEntries(LESSONS.map((l) => [l.ruleId, l]));
export function getLesson(ruleId) { return LESSON_BY_RULE[ruleId] || null; }
export function hasLesson(ruleId) { return !!LESSON_BY_RULE[ruleId]; }
