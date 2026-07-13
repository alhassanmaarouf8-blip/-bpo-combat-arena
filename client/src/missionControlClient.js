const RESPONSE_LIMIT = 512 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;

export const ROLE_OPTIONS = Object.freeze([
  { id: 'customer_service', de: 'Kundenservice', ar: 'خدمة العملاء' },
  { id: 'technical_support', de: 'Technischer Support', ar: 'الدعم الفني' },
  { id: 'sales', de: 'Vertrieb', ar: 'المبيعات' },
  { id: 'retention', de: 'Kundenbindung', ar: 'الاحتفاظ بالعملاء' },
  { id: 'backoffice', de: 'Backoffice', ar: 'العمل المكتبي' },
]);

export const INDUSTRY_OPTIONS = Object.freeze([
  { id: 'telecom', de: 'Telekommunikation', ar: 'الاتصالات' },
  { id: 'ecommerce', de: 'E-Commerce', ar: 'التجارة الإلكترونية' },
  { id: 'fintech', de: 'Banken & Fintech', ar: 'البنوك والتكنولوجيا المالية' },
  { id: 'airline', de: 'Airlines & Reisen', ar: 'الطيران والسياحة' },
  { id: 'delivery', de: 'Lieferdienste', ar: 'خدمات التوصيل' },
  { id: 'logistik', de: 'Logistik & Versand', ar: 'اللوجستيات والشحن' },
  { id: 'energie', de: 'Energie', ar: 'الطاقة' },
  { id: 'versicherung', de: 'Versicherung', ar: 'التأمين' },
  { id: 'streaming', de: 'Streaming & Abos', ar: 'البث والاشتراكات' },
  { id: 'b2b', de: 'B2B-Konten', ar: 'حسابات الشركات' },
]);

export const GERMAN_LEVEL_OPTIONS = Object.freeze([
  { id: 'a2-b1', de: 'A2–B1', ar: 'مستوى A2–B1' },
  { id: 'b2', de: 'B2', ar: 'مستوى B2' },
  { id: 'c1', de: 'C1', ar: 'مستوى C1' },
  { id: 'unspecified', de: 'Noch unsicher', ar: 'غير متأكد' },
]);

export const TIMING_OPTIONS = Object.freeze([
  { id: 'today', de: 'Heute', ar: 'اليوم' },
  { id: 'one_two_days', de: 'In 1–2 Tagen', ar: 'خلال يوم أو يومين' },
  { id: 'three_six_days', de: 'In 3–6 Tagen', ar: 'خلال 3–6 أيام' },
  { id: 'seven_plus_days', de: 'In 7+ Tagen', ar: 'بعد أسبوع أو أكثر' },
  { id: 'no_date', de: 'Noch kein Termin', ar: 'لا يوجد موعد بعد' },
]);

export const EVIDENCE_OPTIONS = Object.freeze([
  { id: 'customer_contact', de: 'Direkter Kundenkontakt', ar: 'تعامل مباشر مع العملاء' },
  { id: 'deescalation', de: 'Beschwerden deeskaliert', ar: 'حل شكاوى وتهدئة العملاء' },
  { id: 'sales_result', de: 'Verkaufs- oder Bindungserfolg', ar: 'نتيجة في البيع أو الاحتفاظ' },
  { id: 'technical_triage', de: 'Technische Probleme strukturiert gelöst', ar: 'حل مشكلات تقنية بطريقة منظمة' },
  { id: 'data_accuracy', de: 'Daten oder Fälle genau dokumentiert', ar: 'توثيق البيانات أو الحالات بدقة' },
  { id: 'shift_flexibility', de: 'Schicht- und Zeitflexibilität', ar: 'مرونة في الشيفتات والمواعيد' },
  { id: 'quantified_result', de: 'Messbares Ergebnis', ar: 'نتيجة يمكن قياسها' },
]);

// Keep these IDs byte-for-byte aligned with server/missionControlCore.js. The
// UI imports this single catalogue so a translated label can never invent an
// API value that the server rejects.
export const LOCATION_MODE_OPTIONS = Object.freeze([
  { id: 'onsite', de: 'Vor Ort', ar: 'من مقر العمل' },
  { id: 'hybrid', de: 'Hybrid', ar: 'هجين' },
  { id: 'remote', de: 'Remote', ar: 'عن بُعد' },
  { id: 'flexible', de: 'Flexibel', ar: 'مرن' },
]);

export const SHIFT_PREFERENCE_OPTIONS = Object.freeze([
  { id: 'day', de: 'Tagschicht', ar: 'شيفت نهاري' },
  { id: 'evening', de: 'Spätschicht', ar: 'شيفت مسائي' },
  { id: 'night', de: 'Nachtschicht', ar: 'شيفت ليلي' },
  { id: 'rotating', de: 'Wechselschicht', ar: 'شيفتات متغيرة' },
  { id: 'weekends', de: 'Wochenenden', ar: 'عطلات نهاية الأسبوع' },
]);

export const EXPERIENCE_BAND_OPTIONS = Object.freeze([
  { id: 'entry', de: 'Berufseinstieg', ar: 'بداية مهنية' },
  { id: 'under_1_year', de: 'Unter 1 Jahr', ar: 'أقل من سنة' },
  { id: '1_2_years', de: '1–2 Jahre', ar: '1–2 سنوات' },
  { id: '3_5_years', de: '3–5 Jahre', ar: '3–5 سنوات' },
  { id: '5_plus_years', de: 'Mehr als 5 Jahre', ar: 'أكثر من 5 سنوات' },
]);

export const WORK_AUTHORIZATION_OPTIONS = Object.freeze([
  { id: 'egypt_authorized', de: 'Arbeitsberechtigt in Ägypten', ar: 'مصرح لي بالعمل في مصر' },
  { id: 'eu_authorized', de: 'Arbeitsberechtigt in der EU', ar: 'مصرح لي بالعمل في الاتحاد الأوروبي' },
  { id: 'gulf_authorized', de: 'Arbeitsberechtigt in der Golfregion', ar: 'مصرح لي بالعمل في الخليج' },
  { id: 'requires_sponsorship', de: 'Benötige Sponsoring', ar: 'أحتاج إلى رعاية عمل' },
  { id: 'other', de: 'Andere Situation', ar: 'وضع آخر' },
]);

export const PASSPORT_SKILL_OPTIONS = Object.freeze([
  { id: 'self_intro', de: 'Selbstvorstellung', ar: 'التعريف بالنفس' },
  { id: 'motivation', de: 'Motivation erklären', ar: 'شرح الدافع' },
  { id: 'availability', de: 'Verfügbarkeit klären', ar: 'توضيح التوفر' },
  { id: 'star_story', de: 'STAR-Beispiel', ar: 'مثال بطريقة STAR' },
  { id: 'data_capture', de: 'Datenerfassung', ar: 'تسجيل البيانات' },
  { id: 'deescalation', de: 'Deeskalation', ar: 'تهدئة التصعيد' },
  { id: 'objection_handling', de: 'Einwandbehandlung', ar: 'التعامل مع الاعتراضات' },
  { id: 'closing', de: 'Gesprächsabschluss', ar: 'إنهاء المحادثة' },
]);

export const FACT_TYPE_OPTIONS = Object.freeze([
  { id: 'experience', de: 'Berufserfahrung', ar: 'خبرة عملية' },
  { id: 'achievement', de: 'Messbares Ergebnis', ar: 'نتيجة قابلة للقياس' },
  { id: 'skill', de: 'Fähigkeit', ar: 'مهارة' },
  { id: 'language', de: 'Sprache', ar: 'اللغة' },
  { id: 'education', de: 'Ausbildung', ar: 'التعليم' },
  { id: 'certification', de: 'Zertifikat', ar: 'شهادة' },
  { id: 'availability', de: 'Verfügbarkeit', ar: 'التوفر' },
]);

export const APPLICATION_OUTCOME_OPTIONS = Object.freeze([
  { id: 'rejected', de: 'Abgelehnt' },
  { id: 'offer', de: 'Angebot erhalten' },
  { id: 'hired', de: 'Eingestellt' },
  { id: 'withdrawn', de: 'Zurückgezogen' },
  { id: 'expired', de: 'Stelle abgelaufen' },
]);

const OPTION_IDS = Object.freeze({
  roleType: new Set(ROLE_OPTIONS.map((item) => item.id)),
  industryKey: new Set(INDUSTRY_OPTIONS.map((item) => item.id)),
  germanLevel: new Set(GERMAN_LEVEL_OPTIONS.map((item) => item.id)),
  timing: new Set(TIMING_OPTIONS.map((item) => item.id)),
  evidenceCategories: new Set(EVIDENCE_OPTIONS.map((item) => item.id)),
});

export class MissionControlRequestError extends Error {
  constructor(code = 'request_failed', status = 0, retryAfter = null) {
    super(code);
    this.name = 'MissionControlRequestError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textOf(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function idOf(value, max = 120) {
  return textOf(value, max).replace(/[^a-zA-Z0-9:_-]/g, '');
}

function listOf(value, max = 12) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function stringList(value, max = 12, itemMax = 300) {
  return listOf(value, max).map((item) => textOf(typeof item === 'string' ? item : item?.text || item?.label, itemMax)).filter(Boolean);
}

function pickPayload(payload, keys) {
  const root = objectOf(payload);
  const data = objectOf(root.data);
  for (const key of keys) {
    if (root[key] !== undefined) return root[key];
    if (data[key] !== undefined) return data[key];
  }
  return data && Object.keys(data).length ? data : root;
}

function normalizeQuestion(item, index) {
  if (typeof item === 'string') return { id: `prediction_${index + 1}`, label: 'Übungsprognose', text: textOf(item, 500) };
  const row = objectOf(item);
  const text = textOf(row.text || row.question || row.prompt, 500);
  const label = textOf(row.label, 80);
  return text ? {
    id: idOf(row.id || `prediction_${index + 1}`),
    label: label === 'practice_prediction' ? 'Übungsprognose' : label || 'Übungsprognose',
    text,
  } : null;
}

function normalizeStructure(value) {
  const fallback = [
    { seconds: '0–10', title: 'Kontext', detail: 'Situation und Ziel in einem Satz.' },
    { seconds: '10–45', title: 'Handlung', detail: 'Dein konkreter Beitrag, nicht nur das Team.' },
    { seconds: '45–60', title: 'Ergebnis', detail: 'Wirkung, Zahl oder gelernte Verbesserung.' },
  ];
  const approved = Object.freeze({
    direct_answer: { title: 'Direkte Antwort', detail: 'Beantworte die Frage zuerst in einem klaren Satz.' },
    specific_evidence: { title: 'Konkreter Beleg', detail: 'Nenne eine echte Situation und deinen eigenen Beitrag.' },
    role_relevance: { title: 'Rollenbezug', detail: 'Verbinde das Ergebnis direkt mit der Zielrolle.' },
  });
  const rows = listOf(value, 6).map((item, index) => {
    if (typeof item === 'string') {
      const curated = approved[item];
      return {
        seconds: index === 0 ? '0–10' : index === 1 ? '10–45' : '45–60',
        title: curated?.title || `Schritt ${index + 1}`,
        detail: curated?.detail || textOf(item, 300),
      };
    }
    const row = objectOf(item);
    const detail = textOf(row.detail || row.text || row.instruction, 300);
    return detail ? {
      seconds: textOf(row.seconds || row.time || row.duration, 30),
      title: textOf(row.title || row.label, 80) || `Schritt ${index + 1}`,
      detail,
    } : null;
  }).filter(Boolean);
  return rows.length ? rows : fallback;
}

export function normalizeInterviewPassPreview(payload) {
  const root = objectOf(payload);
  const row = objectOf(pickPayload(root, ['preview', 'pass', 'result']));
  const questionsRaw = row.predictions || row.practicePredictions || row.practiceQuestions || row.questions
    || root.predictions || root.practicePredictions || root.practiceQuestions || root.questions;
  const questions = listOf(questionsRaw, 3).map(normalizeQuestion).filter(Boolean).slice(0, 3);
  if (questions.length !== 3) throw new MissionControlRequestError('invalid_response', 502);
  const strongest = row.strongestEvidence || root.strongestEvidence;
  const evidenceRaw = row.confirmedEvidence || row.evidenceCategories || root.confirmedEvidence
    || (strongest ? (Array.isArray(strongest) ? strongest : [strongest]) : []);
  const gapRow = objectOf(row.evidenceGap || row.gap || row.honestGap || root.evidenceGap || root.gap);
  return {
    previewToken: textOf(root.previewToken || row.previewToken || root.token || row.token, 6000),
    expiresAt: textOf(root.expiresAt || row.expiresAt, 80),
    roleTitle: textOf(row.roleTitle || row.title, 120),
    practicePredictions: questions,
    answerStructure: normalizeStructure(row.answerStructure || row.sixtySecondStructure || root.answerStructure),
    confirmedEvidence: stringList(evidenceRaw, 8, 120),
    gap: {
      title: textOf(gapRow.title || gapRow.label, 100) === 'evidence_gap'
        ? 'Ehrliche Lücke' : textOf(gapRow.title || gapRow.label, 100) || 'Nächster Beleg',
      detail: textOf(gapRow.detail || gapRow.text || gapRow.message, 500),
    },
    dayOne: objectOf(row.dayOne || row.day1 || root.dayOne || root.day1),
  };
}

function normalizePassMilestone(item, index) {
  const row = objectOf(item);
  const id = idOf(row.id || `pass_step_${index + 1}`, 100);
  return id ? {
    id,
    title: textOf(row.title, 120) || id,
    actions: stringList(row.actions, 8, 100),
    day: Number.isSafeInteger(Number(row.day)) ? Math.max(1, Math.min(7, Number(row.day))) : index + 1,
    live: row.live === true,
    emergency: row.emergency === true,
  } : null;
}

export function normalizeClaimedInterviewPass(payload) {
  const row = objectOf(pickPayload(payload, ['interviewPass', 'pass']));
  const id = idOf(row.id, 100);
  if (!id) return null;
  return {
    id,
    roleType:textOf(row.roleType, 50),
    industryKey:textOf(row.industryKey, 50),
    germanLevel:textOf(row.germanLevel, 30),
    timing:textOf(row.timing, 40),
    evidenceCategories:stringList(row.evidenceCategories, 8, 50),
    schedule:listOf(row.schedule, 7).map(normalizePassMilestone).filter(Boolean),
    planAccess:row.planAccess === 'full' ? 'full' : 'day_one',
    targetedLive:row.targetedLive === true,
    claimedAt:Number.isFinite(Number(row.claimedAt)) ? Math.trunc(Number(row.claimedAt)) : null,
  };
}

export function normalizeMissionBundle(payload) {
  const root = objectOf(payload);
  return {
    enabled:root.enabled === true,
    paused:root.paused === true,
    passport:normalizePassport(root),
    interviewPass:normalizeClaimedInterviewPass(root),
    capabilities:objectOf(root.capabilities),
  };
}

function normalizeConfirmedFact(item, index) {
  const row = objectOf(item);
  const value = textOf(row.value || row.text, 500);
  return value ? {
    id: idOf(row.id || `passport_fact_${index + 1}`),
    type: textOf(row.type, 50) || 'experience',
    value,
    provenance: textOf(row.provenance, 80) || 'user_confirmed',
    confirmedAt: Number.isFinite(Number(row.confirmedAt)) ? Math.trunc(Number(row.confirmedAt)) : null,
    shareAllowed: row.shareAllowed === true,
  } : null;
}

export function normalizePassport(payload) {
  const row = objectOf(pickPayload(payload, ['passport', 'candidatePassport']));
  return {
    roleTypes: stringList(row.roleTypes, 5, 40),
    industryKeys: stringList(row.industryKeys || row.industries, 10, 40),
    germanLevel: textOf(row.germanLevel, 30) || 'unspecified',
    locationMode: textOf(row.locationMode, 30) || 'flexible',
    shiftPreferences: stringList(row.shiftPreferences || row.shiftIds, 8, 40),
    availabilityDate: textOf(row.availabilityDate, 20),
    experienceBand: textOf(row.experienceBand, 30) || 'entry',
    salaryFloorEGP: row.salaryFloorEGP !== null && row.salaryFloorEGP !== undefined
      && Number.isFinite(Number(row.salaryFloorEGP)) ? Math.max(0, Math.round(Number(row.salaryFloorEGP))) : null,
    workAuthorization: textOf(row.workAuthorization, 40) || 'egypt_authorized',
    locationEligibilities:stringList(row.locationEligibilities, 7, 40),
    skillIds: stringList(row.skillIds, 16, 50),
    facts: listOf(row.facts || row.confirmedFacts || row.factCards, 30).map(normalizeConfirmedFact).filter(Boolean),
    consentVersion: Number.isSafeInteger(Number(row.consentVersion)) ? Number(row.consentVersion) : null,
    completeness: Number.isFinite(Number(row.completeness)) ? Math.max(0, Math.min(100, Math.round(Number(row.completeness)))) : null,
    updatedAt: Number.isFinite(Number(row.updatedAt)) ? Math.trunc(Number(row.updatedAt)) : null,
  };
}

function normalizePackRef(value) {
  const row = objectOf(value);
  const id = idOf(row.id || row.packId || value);
  return id ? {
    id,
    status: textOf(row.status, 40) || 'draft',
    trackingOnly: row.trackingOnly === true,
  } : null;
}

export function normalizeOpportunity(value) {
  const row = objectOf(value);
  const fit = objectOf(row.fit);
  const readiness = objectOf(row.readiness);
  const response = objectOf(row.response || row.latestResponse);
  const interview = objectOf(row.interview);
  return {
    id: idOf(row.id || row.opportunityId),
    title: textOf(row.title || row.roleTitle || row.jobTitle, 160) || 'Unbenannte Stelle',
    employerDisplay: textOf(row.employerDisplay || row.employer || row.company, 120) || 'Arbeitgeber nicht genannt',
    location: textOf(row.location || row.locationLabel, 120),
    sourceHost: textOf(row.sourceHost || row.source, 100),
    postedDate: textOf(row.postedDate || row.publishedAt, 40),
    applyUrl: textOf(row.applyUrl || row.officialApplyUrl, 600),
    status: textOf(row.status || row.pipelineStatus, 40) || 'discovered',
    hardFit: row.hardFit === true || fit.hardFit === true,
    fitScore: Number.isFinite(Number(row.fitScore ?? fit.score)) ? Math.max(0, Math.min(100, Math.round(Number(row.fitScore ?? fit.score)))) : 0,
    fitReasons: stringList(row.fitReasons || fit.reasons, 8, 240),
    fitGaps: stringList(row.fitGaps || fit.gaps, 8, 240),
    readinessState: textOf(row.readinessState || readiness.state, 40) || 'MEASURE_FIRST',
    readinessReasons: stringList(row.readinessReasons || readiness.reasons, 8, 240),
    applicationPack: normalizePackRef(row.applicationPack || row.pack),
    response: {
      classification: textOf(response.classification || response.type, 40),
      proposedDate: textOf(response.proposedDate || response.interviewDate, 30),
      proposedTime: textOf(response.proposedTime || response.interviewTime, 30),
    },
    interviewDate: textOf(interview.interviewDate || row.interviewDate, 30),
    interviewTime: textOf(interview.interviewTime || row.interviewTime, 30),
    interviewTimezone:textOf(interview.timezone || row.interviewTimezone, 80),
    updatedAt: textOf(row.updatedAt, 80),
  };
}

export function normalizeOpportunityList(payload) {
  const value = pickPayload(payload, ['opportunities', 'items', 'today', 'radar']);
  const source = Array.isArray(value) ? value : listOf(objectOf(value).items || objectOf(value).opportunities, 100);
  return source.map(normalizeOpportunity).filter((item) => item.id);
}

function normalizeFact(item, index) {
  const row = objectOf(item);
  const value = textOf(typeof item === 'string' ? item : row.value || row.text || row.fact, 500);
  return value ? {
    id: idOf(row.id || row.factId || `fact_${index + 1}`),
    label: textOf(row.label || row.title, 120) || `Bestätigte Tatsache ${index + 1}`,
    value,
    source: textOf(row.source, 80),
  } : null;
}

function normalizeAnswer(item, index) {
  const row = objectOf(item);
  const answer = textOf(row.answer || row.value || row.text, 1200);
  return answer ? {
    id: idOf(row.id || `answer_${index + 1}`),
    question: textOf(row.question || row.label || row.title, 300) || `Antwort ${index + 1}`,
    answer,
  } : null;
}

export function normalizeApplicationPack(payload) {
  const row = objectOf(pickPayload(payload, ['applicationPack', 'pack']));
  const facts = listOf(row.facts || row.factLocks || row.confirmedFacts, 30).map(normalizeFact).filter(Boolean);
  const answers = listOf(row.answers || row.applicationAnswers, 20).map(normalizeAnswer).filter(Boolean);
  return {
    id: idOf(row.id || row.packId),
    opportunityId: idOf(row.opportunityId),
    status: textOf(row.status, 40) || 'draft',
    employerDisplay: textOf(row.employerDisplay || row.employer, 120),
    title: textOf(row.title || row.roleTitle, 160),
    summary: textOf(row.summary || row.profileSummary, 1600),
    coverNote: textOf(row.coverNote || row.coverLetter, 3000),
    facts,
    answers,
    trackingOnly: row.trackingOnly === true,
    factLockIds: stringList(row.factLockIds, 30, 80),
    answerMap: listOf(row.answerMap, 20).map((item) => {
      const answer = objectOf(item);
      return {
        topicId: idOf(answer.topicId, 80),
        factLockIds: stringList(answer.factLockIds, 5, 80),
      };
    }).filter((item) => item.topicId),
    checklist: stringList(row.checklist, 8, 60),
    warnings: stringList(row.warnings, 12, 500),
    applyUrl: textOf(row.applyUrl || row.officialApplyUrl, 600),
  };
}

export function normalizeResponseClassification(payload) {
  const root = objectOf(payload);
  const picked = pickPayload(payload, ['classification', 'result', 'response']);
  const row = typeof picked === 'string' ? root : objectOf(picked);
  return {
    classification: textOf(typeof picked === 'string' ? picked : row.classification || row.type, 40) || 'other',
    proposedDate: textOf(row.proposedDate || row.interviewDate, 30),
    proposedTime: textOf(row.proposedTime || row.interviewTime, 30),
    timezone: textOf(row.timezone, 80) || 'Africa/Cairo',
    needsConfirmation: row.needsConfirmation !== false,
    confidence: textOf(row.confidence, 20),
    suggestedAction: textOf(row.suggestedAction, 60),
  };
}

export function validatePreviewInput(value) {
  const row = objectOf(value);
  const evidence = stringList(row.evidenceCategories, 8, 50).filter((id) => OPTION_IDS.evidenceCategories.has(id));
  if (!OPTION_IDS.roleType.has(row.roleType) || !OPTION_IDS.industryKey.has(row.industryKey)
    || !OPTION_IDS.germanLevel.has(row.germanLevel) || !OPTION_IDS.timing.has(row.timing)
    || !evidence.length) throw new MissionControlRequestError('invalid_preview_input', 400);
  return {
    roleType: row.roleType,
    industryKey: row.industryKey,
    germanLevel: row.germanLevel,
    timing: row.timing,
    evidenceCategories: evidence,
  };
}

function cleanId(value, name) {
  const result = idOf(value);
  if (!result) throw new MissionControlRequestError(`invalid_${name}`, 400);
  return encodeURIComponent(result);
}

function cleanBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/**
 * Every authenticated mutation carries a caller-visible key. Callers may pass
 * one in `options.idempotencyKey` when retrying after a network interruption;
 * otherwise the client creates a collision-resistant key before the request.
 */
export function createMissionIdempotencyKey(scope = 'mutation') {
  const safeScope = String(scope || 'mutation').replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 18) || 'mutation';
  const cryptoApi = globalThis.crypto;
  let entropy = '';
  if (typeof cryptoApi?.randomUUID === 'function') entropy = cryptoApi.randomUUID().replaceAll('-', '');
  else if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    entropy = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } else {
    // Old embedded browsers still get a unique-enough request key; the server
    // binds it to account + payload and never treats it as a security token.
    entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
  }
  return `${safeScope}_${entropy}`.slice(0, 80);
}

function mutationBody(body, options, scope) {
  const row = objectOf(body);
  const requested = textOf(options?.idempotencyKey || row.idempotencyKey, 80);
  const idempotencyKey = /^[a-zA-Z0-9_-]{8,80}$/u.test(requested)
    ? requested : createMissionIdempotencyKey(scope);
  return { ...row, idempotencyKey };
}

function errorCode(payload, fallback) {
  const row = objectOf(payload);
  return textOf(row.error?.code || row.error || row.code, 120) || fallback;
}

export function createMissionControlClient({ apiUrl, token = '', fetchFn = globalThis.fetch } = {}) {
  const base = cleanBase(apiUrl);
  if (!base || typeof fetchFn !== 'function') throw new MissionControlRequestError('client_not_configured');

  async function request(path, { method = 'GET', body, signal, auth = true } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const headers = { Accept: 'application/json' };
      if (auth && token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetchFn(`${base}${path}`, {
        method,
        headers,
        signal: controller.signal,
        cache: method === 'GET' ? 'no-store' : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await response.text();
      if (raw.length > RESPONSE_LIMIT) throw new MissionControlRequestError('response_too_large', 502);
      let payload = {};
      if (raw) {
        try { payload = JSON.parse(raw); }
        catch { throw new MissionControlRequestError('invalid_response', response.status); }
      }
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after')) || null;
        throw new MissionControlRequestError(errorCode(payload, `http_${response.status}`), response.status, retryAfter);
      }
      return payload;
    } catch (error) {
      if (timedOut) throw new MissionControlRequestError('request_timeout', 408);
      if (error?.name === 'AbortError') throw error;
      if (error instanceof MissionControlRequestError) throw error;
      throw new MissionControlRequestError('network_error');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  return Object.freeze({
    getPreviewStatus: async (options = {}) => {
      const payload = await request('/api/interview-pass/preview', { signal: options.signal, auth: false });
      return {
        enabled: objectOf(payload).enabled === true,
        mode: textOf(objectOf(payload).mode, 20),
      };
    },
    preview: async (input, options = {}) => normalizeInterviewPassPreview(await request('/api/interview-pass/preview', {
      method: 'POST', body: validatePreviewInput(input), signal: options.signal, auth: false,
    })),
    claim: async (previewToken, options = {}) => request('/api/interview-pass/claim', {
      method: 'POST', body: mutationBody({ previewToken: textOf(previewToken, 6000) }, options, 'pass_claim'), signal: options.signal,
    }),
    getMissionBundle: async (options = {}) => normalizeMissionBundle(await request('/api/candidate-passport', { signal: options.signal })),
    getPassport: async (options = {}) => normalizePassport(await request('/api/candidate-passport', { signal: options.signal })),
    savePassport: async (passport, options = {}) => normalizePassport(await request('/api/candidate-passport', {
      method: 'PUT', body: mutationBody(passport, options, 'passport'), signal: options.signal,
    })),
    getRadar: async (options = {}) => normalizeOpportunityList(await request('/api/job-radar/today', { signal: options.signal })),
    importOpportunity: async (source, options = {}) => normalizeOpportunity(await request('/api/opportunities/import', {
      method: 'POST', body: mutationBody(source, options, 'opportunity'), signal: options.signal,
    })),
    getOpportunities: async ({ status = '', signal } = {}) => normalizeOpportunityList(await request(
      `/api/opportunities${status ? `?status=${encodeURIComponent(textOf(status, 40))}` : ''}`, { signal },
    )),
    createApplicationPack: async (opportunityId, options = {}) => normalizeApplicationPack(await request(
      `/api/opportunities/${cleanId(opportunityId, 'opportunity')}/application-pack`,
      { method: 'POST', body: mutationBody({}, options, 'pack_create'), signal: options.signal },
    )),
    approveApplicationPack: async (packId, approval, options = {}) => normalizeApplicationPack(await request(
      `/api/application-packs/${cleanId(packId, 'pack')}/approve`,
      { method: 'POST', body: mutationBody(approval, options, 'pack_approve'), signal: options.signal },
    )),
    markSubmitted: async (packId, options = {}) => request(
      `/api/application-packs/${cleanId(packId, 'pack')}/mark-submitted`,
      { method: 'POST', body: mutationBody({ confirmed: true }, options, 'submitted'), signal: options.signal },
    ),
    classifyResponse: async (opportunityId, responseText, options = {}) => normalizeResponseClassification(await request(
      `/api/opportunities/${cleanId(opportunityId, 'opportunity')}/response`,
      { method: 'POST', body: mutationBody({ responseText }, options, 'response'), signal: options.signal },
    )),
    confirmInterview: async (opportunityId, confirmation, options = {}) => request(
      `/api/opportunities/${cleanId(opportunityId, 'opportunity')}/confirm-interview`,
      { method: 'POST', body: mutationBody(confirmation, options, 'interview'), signal: options.signal },
    ),
    verifyOfficialPage: async (opportunityId, options = {}) => {
      const payload = await request(
        `/api/opportunities/${cleanId(opportunityId, 'opportunity')}/verify-official-page`,
        { method:'POST', body:mutationBody({}, options, 'official_verify'), signal:options.signal },
      );
      const row = objectOf(payload);
      const officialApplyUrl = textOf(row.officialApplyUrl, 1000);
      const verifiedAt = Number(row.verifiedAt);
      if (!idOf(row.opportunityId) || !officialApplyUrl || !Number.isFinite(verifiedAt)) {
        throw new MissionControlRequestError('invalid_response', 502);
      }
      return { opportunityId:idOf(row.opportunityId), officialApplyUrl, verifiedAt:Math.trunc(verifiedAt) };
    },
    updateOutcome: async (opportunityId, outcome, options = {}) => normalizeOpportunity(await request(
      `/api/opportunities/${cleanId(opportunityId, 'opportunity')}/outcome`,
      { method: 'PATCH', body: mutationBody({ outcome }, options, 'outcome'), signal: options.signal },
    )),
  });
}
