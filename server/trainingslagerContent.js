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
 *   • Add a TIER:    push a new {tier:4, band:'C1', …, quiz:[…]} into a section's `tiers`.
 *   • Add a SECTION: add a new {id:'mein-thema', …, minTier:2, tiers:[…]} object below.
 *   • Replace every  [PLATZHALTER …]  string with real, native German. Keep the shape.
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
      { tier: 1, band: 'A2–B1', title_de: 'Telefonieren — Grundlagen', title_ar: 'الأساسيات', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Telefon Grundlagen') },
      { tier: 2, band: 'B1–B2', title_de: 'Telefonieren — souverän führen', title_ar: 'إدارة المكالمة بثقة', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Telefon souverän') },
      { tier: 3, band: 'B2–C1', title_de: 'Telefonieren — komplexe Fälle', title_ar: 'حالات معقّدة', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Telefon komplex') },
    ],
  },
  {
    id: 'deeskalation', icon: '🧯', minTier: 1,
    title_de: 'Den wütenden Kunden beruhigen', title_ar: 'نزع فتيل العميل الغاضب',
    tiers: [
      { tier: 1, band: 'A2–B1', title_de: 'De-Eskalation — Grundlagen', title_ar: 'أساسيات التهدئة', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Deeskalation Grundlagen') },
      { tier: 2, band: 'B1–B2', title_de: 'De-Eskalation — Empathie & Lösung', title_ar: 'التعاطف والحل', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Deeskalation Empathie') },
      { tier: 3, band: 'B2–C1', title_de: 'De-Eskalation — der eskalierende Kunde', title_ar: 'العميل المتصاعد', youtubeId_de: '', youtubeId_ar: '', quiz: phQuiz('Deeskalation hart') },
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
    title_de:          `${section.title_de} — Stufe ${t.tier} · ${t.band}`,
    title_ar:          `${section.title_ar} — مستوى ${t.tier}`,
    youtubeId_de:      t.youtubeId_de || '',
    youtubeId_ar:      t.youtubeId_ar || '',
    teacherName:       t.teacherName || '',
    teacherChannelUrl: t.teacherChannelUrl || '',
    quiz:              t.quiz,
  };
}

// Highest authored tier across all sections (used to detect "ran out of content").
export function maxAuthoredTier() {
  let m = 0;
  for (const s of LAGER_SECTIONS) for (const t of s.tiers) if (t.tier > m) m = t.tier;
  return m;
}
