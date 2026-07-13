/**
 * vacancyTargetCore.js
 *
 * Canonical vacancy-target schema, deterministic analysis, plan schedule, and
 * privacy-safe live context. No source text or source URL belongs in a target.
 */
import { createHash } from 'node:crypto';
import { planOf, trialActive, isAdminAccount } from './auth.js';
import { dayKey, dayKeyNoonMs } from './time.js';

export const VACANCY_SCHEMA_VERSION = 1;
export const VACANCY_ANALYSIS_VERSION = 'vacancy-v1';
export const VACANCY_MAX_SOURCE_CHARS = 20000;
export const VACANCY_MAX_ANALYSES_PER_HOUR = 3;
export const VACANCY_MAX_ANALYSES_PER_MONTH = 30;

export const VACANCY_INDUSTRY_KEYS = Object.freeze([
  'telecom', 'ecommerce', 'fintech', 'airline', 'delivery',
  'logistik', 'energie', 'versicherung', 'streaming', 'b2b',
]);
export const VACANCY_ROLE_TYPES = Object.freeze([
  'customer_service', 'technical_support', 'sales', 'retention', 'backoffice',
]);
export const VACANCY_GERMAN_LEVELS = Object.freeze(['a2-b1', 'b2', 'c1', 'unspecified']);
export const VACANCY_SKILL_IDS = Object.freeze([
  'self_intro', 'motivation', 'availability', 'star_story', 'data_capture',
  'deescalation', 'objection_handling', 'closing',
]);
export const VACANCY_QUESTION_TOPIC_IDS = Object.freeze([
  'self_introduction', 'motivation', 'work_experience', 'shift_flexibility',
  'customer_escalation', 'data_accuracy', 'sales_objection', 'technical_triage',
  'closing_questions',
]);

const INDUSTRY_SET = new Set(VACANCY_INDUSTRY_KEYS);
const ROLE_SET = new Set(VACANCY_ROLE_TYPES);
const LEVEL_SET = new Set(VACANCY_GERMAN_LEVELS);
const SKILL_SET = new Set(VACANCY_SKILL_IDS);
const QUESTION_SET = new Set(VACANCY_QUESTION_TOPIC_IDS);
const SOURCE_HOST_SET = new Set([
  'wuzzuf.net', 'jobs.lever.co', 'boards.greenhouse.io',
  'apply.workable.com', 'jobs.smartrecruiters.com',
]);

const BIDI_AND_FORMAT_CONTROLS = /[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const PROMPT_DIRECTIVE_LINE = /(?:ignore|disregard|forget|override|reveal|print|return|follow)\s+(?:all\s+)?(?:previous|prior|system|developer|assistant|prompt|instruction)|(?:system|developer|assistant)\s*(?:message|prompt|instructions?)|(?:do\s+not|never)\s+follow\s+(?:the\s+)?(?:system|developer)|<\|(?:system|assistant|developer|user)[^>]*\|>|\[(?:system|assistant|developer|inst)\]|(?:ignoriere|vergiss|missachte|ueberschreibe|überschreibe)\s+(?:alle\s+)?(?:vorherigen?|system|anweisungen?)/iu;
const CONTACT_PERSON_LINE = /(?:contact|ansprechpartner|recruiter|hiring\s+manager)\s*[:\-]\s*[\p{L}][\p{L}\s.'-]{2,80}/iu;

export const VACANCY_PRACTICE_QUESTIONS = Object.freeze({
  self_introduction: 'Stellen Sie sich bitte in 60 Sekunden vor und erklären Sie, warum Ihr Profil zu dieser Rolle passt.',
  motivation: 'Warum möchten Sie genau in dieser Rollenart arbeiten?',
  work_experience: 'Erzählen Sie von einer relevanten Arbeitssituation und Ihrem konkreten Ergebnis.',
  shift_flexibility: 'Wie flexibel sind Sie bei Schichten, Starttermin und Arbeitszeiten?',
  customer_escalation: 'Wie würden Sie einen verärgerten Kunden ruhig und strukturiert deeskalieren?',
  data_accuracy: 'Wie stellen Sie sicher, dass Kundendaten vollständig und korrekt erfasst werden?',
  sales_objection: 'Wie behandeln Sie einen Einwand, ohne den Kunden unter Druck zu setzen?',
  technical_triage: 'Wie grenzen Sie ein technisches Problem Schritt für Schritt ein?',
  closing_questions: 'Welche professionellen Fragen würden Sie am Ende des Interviews stellen?',
});

export class VacancyTargetError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'VacancyTargetError';
    this.code = code;
    this.status = status;
  }
}

function targetError(code, status = 400) {
  throw new VacancyTargetError(code, status);
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const value = entity[1].toLowerCase() === 'x'
      ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  });
}

function stripMarkup(text) {
  return decodeEntities(String(text || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p\s*>|<\/li\s*>|<\/div\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' '));
}

export function redactVacancyText(text) {
  return String(text || '')
    .replace(/\bhttps?:\/\/[^\s<>{}\[\]"']+/giu, '[link]')
    .replace(/\bwww\.[^\s<>{}\[\]"']+/giu, '[link]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[email]')
    .replace(/(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/gu, '[phone]');
}

function stripUntrustedDirectives(value) {
  return String(value || '')
    .replace(BIDI_AND_FORMAT_CONTROLS, '')
    .split(/\r?\n/gu)
    .filter((line) => !PROMPT_DIRECTIVE_LINE.test(line) && !CONTACT_PERSON_LINE.test(line))
    .join('\n');
}

export function sanitizeVacancyString(value, max = 160, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return nullable ? null : '';
  const clean = redactVacancyText(stripUntrustedDirectives(stripMarkup(value).normalize('NFKC')))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, max);
  return clean || (nullable ? null : '');
}

function sourceText(value) {
  if (typeof value !== 'string') targetError('unsupported_source');
  if (value.length > VACANCY_MAX_SOURCE_CHARS) targetError('analysis_limit', 413);
  const clean = redactVacancyText(stripUntrustedDirectives(stripMarkup(value).normalize('NFKC')))
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .split('\n').map((line) => line.replace(/[ \t]+/gu, ' ').trim()).join('\n')
    .replace(/\n{3,}/gu, '\n\n').trim();
  if (clean.length < 60) targetError('unsupported_vacancy', 422);
  return clean;
}

const BPO_ROLE_SIGNAL = /\b(?:customer\s+(?:service|support|care)|kunden(?:service|dienst|beratung)|call[ -]?cent(?:er|re)|contact[ -]?cent(?:er|re)|technical\s+support|technischer\s+support|helpdesk|service\s+agent|support\s+agent|sales\s+agent|telesales|retention|kundenrückgewinnung|back[ -]?office|telefonischer\s+kunden(?:service|support)|deutschsprachig(?:e[snr]?)?\s+(?:agent|kunden|support|service|vertrieb))\b/iu;
const GERMAN_ROLE_SIGNAL = /\b(?:german|deutsch|deutschsprachig|dach|a2|b1|b2|c1|c2)\b/iu;

function assertSupportedBpoVacancy(text) {
  if (!BPO_ROLE_SIGNAL.test(text) || !GERMAN_ROLE_SIGNAL.test(text)) targetError('unsupported_vacancy', 422);
}

export function vacancySourceHash(text) {
  const canonical = String(text || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function preparePastedVacancy(value) {
  const text = sourceText(value);
  assertSupportedBpoVacancy(text);
  return { text, sourceHash: vacancySourceHash(text), sourceHost: null, titleHint: null, employerHint: null };
}

export function prepareImportedVacancy(posting) {
  const titleHint = sanitizeVacancyString(posting?.title, 100);
  const employerHint = sanitizeVacancyString(posting?.employer, 80, { nullable: true });
  const description = typeof posting?.description === 'string'
    ? posting.description.slice(0, Math.max(0, VACANCY_MAX_SOURCE_CHARS - titleHint.length - 1)) : '';
  if (!titleHint) targetError('unsupported_vacancy', 422);
  const sourceHost = sanitizeVacancyString(posting?.sourceHost, 64);
  if (!SOURCE_HOST_SET.has(sourceHost)) targetError('unsupported_source');
  const text = sourceText(`${titleHint}\n${description}`);
  assertSupportedBpoVacancy(text);
  const sourceHash = vacancySourceHash(`${sourceHost}\n${titleHint}\n${employerHint || ''}\n${text}`);
  return { text, sourceHash, sourceHost, titleHint, employerHint };
}

function keywordPick(lower, choices, fallback) {
  let best = fallback;
  let bestScore = 0;
  for (const [id, words] of Object.entries(choices)) {
    let score = 0;
    for (const word of words) if (lower.includes(word)) score += word.includes(' ') ? 3 : 1;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}

function deriveRoleType(text) {
  const lower = text.toLocaleLowerCase('de');
  return keywordPick(lower, {
    technical_support: ['technical support', 'technischer support', 'helpdesk', 'troubleshoot', 'fehlerbehebung', 'it support', 'ticketing'],
    retention: ['retention', 'kundenrückgewinnung', 'kündigungsvermeidung', 'churn', 'customer retention', 'verlängerung'],
    sales: ['sales', 'vertrieb', 'verkauf', 'telesales', 'upselling', 'cross-selling', 'lead generation', 'abschluss'],
    backoffice: ['backoffice', 'back office', 'datenerfassung', 'data entry', 'sachbearbeitung', 'administrative', 'documentation'],
    customer_service: ['customer service', 'customer support', 'kundenservice', 'kundendienst', 'call center', 'contact center', 'customer care'],
  }, 'customer_service');
}

function deriveIndustry(text, roleType) {
  const lower = text.toLocaleLowerCase('de');
  return keywordPick(lower, {
    telecom: ['telecom', 'telekommunikation', 'internet provider', 'mobilfunk', 'broadband'],
    ecommerce: ['e-commerce', 'ecommerce', 'online shop', 'retail', 'handel', 'bestellung'],
    fintech: ['fintech', 'banking', 'bank', 'payment', 'zahlung', 'kreditkarte', 'financial'],
    airline: ['airline', 'flug', 'reise', 'travel', 'booking', 'reservierung'],
    delivery: ['delivery', 'lieferdienst', 'food delivery', 'kurier'],
    logistik: ['logistik', 'logistics', 'shipping', 'versand', 'warehouse', 'fracht'],
    energie: ['energie', 'energy', 'utility', 'strom', 'gasversorger'],
    versicherung: ['versicherung', 'insurance', 'claim', 'schaden'],
    streaming: ['streaming', 'subscription service', 'abo-dienst', 'entertainment'],
    b2b: ['b2b', 'business customer', 'geschäftskunden', 'advertising account', 'werbekonto'],
  }, roleType === 'technical_support' ? 'telecom' : roleType === 'sales' ? 'b2b' : 'ecommerce');
}

function deriveGermanLevel(text) {
  const lower = text.toLocaleLowerCase('de');
  if (/\b(?:c1|c2|fließend(?:e[snr]?)?|fluent|verhandlungssicher)\b/u.test(lower)) return 'c1';
  if (/\b(?:b2|upper[ -]?intermediate|gute(?:n|r|s)? deutschkenntnisse)\b/u.test(lower)) return 'b2';
  if (/\b(?:a2|b1|intermediate|grundkenntnisse|basic german)\b/u.test(lower)) return 'a2-b1';
  return 'unspecified';
}

const ROLE_LABELS = Object.freeze({
  customer_service: 'Customer Service Agent',
  technical_support: 'Technical Support Agent',
  sales: 'Sales Agent',
  retention: 'Retention Agent',
  backoffice: 'Backoffice Agent',
});

function deriveRoleTitle(text, roleType, hint) {
  if (hint) return sanitizeVacancyString(hint, 100);
  const labelled = text.match(/(?:job\s*title|position|rolle|stelle|titel)\s*[:\-–]\s*([^\n.]{3,100})/iu)?.[1];
  if (labelled) return sanitizeVacancyString(labelled, 100);
  const first = text
    .split(/\n|(?=\b(?:aufgaben|anforderungen|responsibilities|requirements)\s*:)/iu)
    .map((line) => sanitizeVacancyString(line, 100))
    .find((line) => line.length >= 4
      && /(?:agent|support|service|sales|retention|back\s?office|mitarbeiter|berater)/iu.test(line));
  if (!first) return ROLE_LABELS[roleType];
  // Pasted ads are frequently a single paragraph. Keep the actual role heading,
  // not the first sentence or account description, on the private target card.
  return sanitizeVacancyString(first.split(/\s+(?:für|for|bei|at)\s+/iu)[0], 80) || ROLE_LABELS[roleType];
}

export function deriveVacancySkillIds(roleType) {
  const specific = {
    customer_service: ['star_story', 'data_capture', 'deescalation'],
    technical_support: ['star_story', 'data_capture', 'deescalation'],
    sales: ['star_story', 'objection_handling', 'closing'],
    retention: ['deescalation', 'objection_handling', 'closing'],
    backoffice: ['star_story', 'data_capture'],
  }[ROLE_SET.has(roleType) ? roleType : 'customer_service'];
  return [...new Set(['self_intro', 'motivation', 'availability', ...specific])].slice(0, 8);
}

export function deriveVacancyQuestionTopicIds(roleType) {
  const specific = {
    customer_service: ['customer_escalation', 'data_accuracy'],
    technical_support: ['technical_triage', 'customer_escalation', 'data_accuracy'],
    sales: ['sales_objection', 'closing_questions'],
    retention: ['customer_escalation', 'sales_objection', 'closing_questions'],
    backoffice: ['data_accuracy', 'closing_questions'],
  }[ROLE_SET.has(roleType) ? roleType : 'customer_service'];
  return [...new Set([
    'self_introduction', 'motivation', 'work_experience', 'shift_flexibility', ...specific,
  ])].slice(0, 9);
}

const GENERIC_REQUIREMENTS = Object.freeze({
  customer_service: ['Kunden professionell betreuen', 'Beschwerden ruhig deeskalieren', 'Informationen genau dokumentieren'],
  technical_support: ['Technische Anliegen strukturiert eingrenzen', 'Lösungen klar erklären', 'Tickets genau dokumentieren'],
  sales: ['Bedarf gezielt ermitteln', 'Einwände professionell behandeln', 'Gespräche verbindlich abschließen'],
  retention: ['Kündigungsgründe aktiv erfragen', 'Passende Lösungen anbieten', 'Einwände ruhig behandeln'],
  backoffice: ['Daten sorgfältig erfassen', 'Vorgänge nachvollziehbar dokumentieren', 'Fristen zuverlässig einhalten'],
});

function deriveDisplayRequirements(text, roleType) {
  const requirements = [...GENERIC_REQUIREMENTS[roleType]];
  if (/\b(?:shift|schicht|weekend|wochenende|night|nacht)\b/iu.test(text)) requirements.push('Schicht- und Einsatzzeiten verbindlich klären');
  if (/\b(?:b2|c1|c2|fluent|fließend|verhandlungssicher)\b/iu.test(text)) requirements.push('Deutsch im Interview klar und sicher einsetzen');
  if (/\b(?:crm|ticket|documentation|dokumentation|data entry|datenerfassung)\b/iu.test(text)) requirements.push('Vorgänge nachvollziehbar und genau dokumentieren');
  return [...new Set(requirements)].slice(0, 6);
}

function controlledList(value, allowed, max, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string' && allowed.has(item) && !out.includes(item)) out.push(item);
    if (out.length === max) break;
  }
  return out.length ? out : [...fallback];
}

export function analyzeVacancyDeterministically(source) {
  const roleType = deriveRoleType(source.text);
  return {
    roleTitle: deriveRoleTitle(source.text, roleType, source.titleHint),
    employerDisplay: sanitizeVacancyString(source.employerHint, 80, { nullable: true }),
    industryKey: deriveIndustry(source.text, roleType),
    roleType,
    germanLevel: deriveGermanLevel(source.text),
    skillIds: deriveVacancySkillIds(roleType),
    questionTopicIds: deriveVacancyQuestionTopicIds(roleType),
    displayRequirements: deriveDisplayRequirements(source.text, roleType),
  };
}

export function mergeVacancyAnalysis(base, candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ...base };
  const allowedKeys = new Set(['roleTitle', 'industryKey', 'roleType', 'germanLevel', 'skillIds', 'questionTopicIds', 'displayRequirements']);
  const keys = Object.keys(candidate);
  const strict = keys.every((key) => allowedKeys.has(key))
    && ['roleTitle', 'industryKey', 'roleType', 'germanLevel', 'skillIds', 'questionTopicIds'].every((key) => Object.hasOwn(candidate, key))
    && typeof candidate.roleTitle === 'string'
    && INDUSTRY_SET.has(candidate.industryKey)
    && ROLE_SET.has(candidate.roleType)
    && LEVEL_SET.has(candidate.germanLevel)
    && Array.isArray(candidate.skillIds) && candidate.skillIds.length <= 8 && candidate.skillIds.every((id) => SKILL_SET.has(id))
    && Array.isArray(candidate.questionTopicIds) && candidate.questionTopicIds.length <= 9 && candidate.questionTopicIds.every((id) => QUESTION_SET.has(id))
    && (!Object.hasOwn(candidate, 'displayRequirements') || (Array.isArray(candidate.displayRequirements)
      && candidate.displayRequirements.length <= 6 && candidate.displayRequirements.every((item) => typeof item === 'string')));
  if (!strict) return { ...base };
  const roleType = candidate.roleType;
  const roleTitle = sanitizeVacancyString(candidate.roleTitle, 100) || base.roleTitle;
  return {
    roleTitle,
    employerDisplay: base.employerDisplay,
    industryKey: candidate.industryKey,
    roleType,
    germanLevel: candidate.germanLevel,
    skillIds: controlledList(candidate.skillIds, SKILL_SET, 8, deriveVacancySkillIds(roleType)),
    questionTopicIds: controlledList(candidate.questionTopicIds, QUESTION_SET, 9, deriveVacancyQuestionTopicIds(roleType)),
    // Model-authored prose is never durable. Only the curated deterministic
    // requirement library reaches storage or a customer-facing response.
    displayRequirements: [...base.displayRequirements],
  };
}

function pickExisting(list, preferred, fallback) {
  const selected = preferred.filter((item) => list.includes(item));
  return selected.length ? selected : list.slice(0, fallback);
}

function addCalendarDays(key, days) {
  return dayKey(dayKeyNoonMs(key) + (Number(days) * 86400000));
}

function calendarDayDistance(fromKey, toKey) {
  return Math.round((dayKeyNoonMs(toKey) - dayKeyNoonMs(fromKey)) / 86400000);
}

function normalizeCompletion(row) {
  const completedAt = validTimestamp(row?.completedAt);
  if (!completedAt) return {};
  const out = { completedAt };
  if (typeof row?.completionSessionId === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/u.test(row.completionSessionId)) {
    out.completionSessionId = row.completionSessionId;
  }
  return out;
}

function scheduleTemplate(input) {
  const roleType = ROLE_SET.has(input?.roleType) ? input.roleType : 'customer_service';
  const skills = controlledList(input?.skillIds, SKILL_SET, 8, deriveVacancySkillIds(roleType));
  const topics = controlledList(input?.questionTopicIds, QUESTION_SET, 9, deriveVacancyQuestionTopicIds(roleType));
  const roleSkill = roleType === 'sales' || roleType === 'retention' ? 'objection_handling'
    : roleType === 'backoffice' ? 'data_capture' : 'deescalation';
  const roleTopic = roleType === 'technical_support' ? 'technical_triage'
    : roleType === 'sales' || roleType === 'retention' ? 'sales_objection'
      : roleType === 'backoffice' ? 'data_accuracy' : 'customer_escalation';
  const rows = [
    ['day_1_foundation', 'Anforderungen und 60-Sekunden-Profil', 'Ordne die Stellenanforderungen und baue eine klare 60-Sekunden-Vorstellung.', ['self_intro'], ['self_introduction']],
    ['day_2_motivation', 'Motivation, Verfügbarkeit und Logistik', 'Verbinde deine Motivation mit Rolle, Starttermin und Arbeitszeiten.', ['motivation', 'availability'], ['motivation', 'shift_flexibility']],
    ['day_3_evidence', 'Relevante STAR-Geschichte', 'Formuliere eine kurze STAR-Geschichte mit einem konkreten Ergebnis.', ['star_story'], ['work_experience']],
    ['day_4_roleplay', 'Rollenbezogene Kundensituation', 'Löse eine typische Kunden- oder Kontosituation strukturiert.', [roleSkill], [roleTopic]],
    ['day_5_pressure', 'Druck und Deeskalation', 'Bleibe unter Druck klar und deeskaliere professionell.', ['deescalation'], ['customer_escalation']],
    ['day_6_mock', 'Komplettes Probeinterview', 'Verbinde Profil, Erfahrung und Rollensituation ohne Brüche.', skills.slice(0, 4), topics.slice(0, 6)],
    ['day_7_rehearsal', 'Schwächen-Retest und Abschluss', 'Teste schwache Antworten erneut und schließe mit guten eigenen Fragen.', skills.slice(-4), [...topics.slice(-4), 'closing_questions']],
  ];
  return rows.map(([id, title, objective, wantedSkills, wantedTopics], index) => ({
    id,
    day: index + 1,
    title,
    objective,
    skillIds: [...new Set(pickExisting(skills, wantedSkills, 1))],
    questionTopicIds: [...new Set(pickExisting(topics, wantedTopics, 1).filter((item) => QUESTION_SET.has(item)))],
  }));
}

function emergencyTemplate(input) {
  const base = scheduleTemplate(input);
  const byId = new Map(base.map((row) => [row.id, row]));
  const combine = (id, title, objective, ids) => ({
    id,
    title,
    objective,
    skillIds: [...new Set(ids.flatMap((key) => byId.get(key)?.skillIds || []))],
    questionTopicIds: [...new Set(ids.flatMap((key) => byId.get(key)?.questionTopicIds || []))],
  });
  return [
    combine('emergency_intro', 'Sofort: Profil und Motivation', 'Trainiere Vorstellung, Motivation, Verfügbarkeit und Logistik kompakt.', ['day_1_foundation', 'day_2_motivation']),
    combine('emergency_evidence', 'Sofort: Beleg und Drucksituation', 'Schärfe eine STAR-Geschichte und eine belastbare Rollenreaktion.', ['day_3_evidence', 'day_4_roleplay', 'day_5_pressure']),
    combine('emergency_mock', 'Sofort: Probeinterview und Abschluss', 'Führe eine Generalprobe mit Schwächen-Retest und Abschlussfragen durch.', ['day_6_mock', 'day_7_rehearsal']),
  ];
}

export function buildVacancySchedule(input, { now = Date.now(), preserve = input?.schedule } = {}) {
  const today = dayKey(now);
  const anchor = dayKey(validTimestamp(input?.createdAt) || now);
  const interviewDate = input?.interviewDate || null;
  const daysUntil = interviewDate ? calendarDayDistance(today, interviewDate) : null;
  let rows = scheduleTemplate(input);
  let dates;
  let omittedMilestoneIds = [];
  let mode = 'rolling';

  if (daysUntil === 0) {
    rows = emergencyTemplate(input);
    dates = rows.map(() => today);
    omittedMilestoneIds = scheduleTemplate(input).map((row) => row.id);
    mode = 'emergency';
  } else if (daysUntil === 1) {
    const keep = new Set(['day_1_foundation', 'day_3_evidence', 'day_6_mock', 'day_7_rehearsal']);
    const all = rows;
    rows = all.filter((row) => keep.has(row.id));
    omittedMilestoneIds = all.filter((row) => !keep.has(row.id)).map((row) => row.id);
    dates = [today, today, interviewDate, interviewDate];
    mode = 'compressed_4';
  } else if (daysUntil === 2) {
    const keep = new Set(['day_1_foundation', 'day_2_motivation', 'day_3_evidence', 'day_4_roleplay', 'day_6_mock', 'day_7_rehearsal']);
    const all = rows;
    rows = all.filter((row) => keep.has(row.id));
    omittedMilestoneIds = all.filter((row) => !keep.has(row.id)).map((row) => row.id);
    dates = [today, today, addCalendarDays(today, 1), addCalendarDays(today, 1), interviewDate, interviewDate];
    mode = 'compressed_6';
  } else if (daysUntil !== null && daysUntil >= 3 && daysUntil <= 6) {
    const slots = [];
    for (let offset = 0; offset <= daysUntil; offset += 1) {
      const date = addCalendarDays(today, offset);
      slots.push(date, date);
    }
    dates = slots.slice(0, rows.length);
    mode = 'compressed_7';
  } else {
    const start = interviewDate ? today : anchor;
    dates = rows.map((_, index) => addCalendarDays(start, index));
    mode = interviewDate ? 'daily' : 'rolling';
  }

  const preserved = new Map((Array.isArray(preserve) ? preserve : []).map((row) => [row?.id, normalizeCompletion(row)]));
  return rows.map((row, index) => ({
    ...row,
    day: index + 1,
    scheduledDate: dates[index],
    scheduleMode: mode,
    ...(omittedMilestoneIds.length ? { omittedMilestoneIds } : {}),
    ...(preserved.get(row.id) || {}),
  }));
}

export function normalizeInterviewDate(value, { now = Date.now() } = {}) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) targetError('bad_interview_date');
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) targetError('bad_interview_date');
  const today = dayKey(now);
  const latest = new Date(`${today}T12:00:00.000Z`);
  latest.setUTCDate(latest.getUTCDate() + 366);
  if (value < today || value > latest.toISOString().slice(0, 10)) targetError('bad_interview_date');
  return value;
}

export function buildVacancyDraft({ source, analysis, interviewDate = null, now = Date.now() }) {
  const roleType = ROLE_SET.has(analysis?.roleType) ? analysis.roleType : 'customer_service';
  const target = {
    version: VACANCY_SCHEMA_VERSION,
    id: `vac_${source.sourceHash.slice(0, 24)}`,
    status: 'draft',
    sourceHash: source.sourceHash,
    sourceHost: source.sourceHost || null,
    roleTitle: sanitizeVacancyString(analysis?.roleTitle, 100) || ROLE_LABELS[roleType],
    employerDisplay: sanitizeVacancyString(analysis?.employerDisplay, 80, { nullable: true }),
    industryKey: INDUSTRY_SET.has(analysis?.industryKey) ? analysis.industryKey : 'b2b',
    roleType,
    germanLevel: LEVEL_SET.has(analysis?.germanLevel) ? analysis.germanLevel : 'unspecified',
    skillIds: controlledList(analysis?.skillIds, SKILL_SET, 8, deriveVacancySkillIds(roleType)),
    questionTopicIds: controlledList(analysis?.questionTopicIds, QUESTION_SET, 9, deriveVacancyQuestionTopicIds(roleType)),
    displayRequirements: Array.isArray(analysis?.displayRequirements)
      ? [...new Set(analysis.displayRequirements.map((value) => sanitizeVacancyString(value, 160)).filter(Boolean))].slice(0, 6) : [],
    interviewDate: normalizeInterviewDate(interviewDate, { now }),
    schedule: [],
    analysisVersion: VACANCY_ANALYSIS_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  target.schedule = buildVacancySchedule(target, { now });
  return target;
}

function validTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeVacancyTarget(value, expectedStatus = null, { now = Date.now() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== VACANCY_SCHEMA_VERSION || value.analysisVersion !== VACANCY_ANALYSIS_VERSION) return null;
  if (!/^vac_[a-f0-9]{24}$/u.test(value.id) || !/^[a-f0-9]{64}$/u.test(value.sourceHash)) return null;
  const status = value.status === 'active' || value.status === 'draft' ? value.status : null;
  if (!status || (expectedStatus && status !== expectedStatus)) return null;
  const sourceHost = value.sourceHost === null || value.sourceHost === undefined ? null : sanitizeVacancyString(value.sourceHost, 64);
  if (sourceHost !== null && !SOURCE_HOST_SET.has(sourceHost)) return null;
  const roleTitle = sanitizeVacancyString(value.roleTitle, 100);
  if (!roleTitle || !INDUSTRY_SET.has(value.industryKey) || !ROLE_SET.has(value.roleType) || !LEVEL_SET.has(value.germanLevel)) return null;
  const createdAt = validTimestamp(value.createdAt);
  const updatedAt = validTimestamp(value.updatedAt);
  if (!createdAt || !updatedAt) return null;
  let interviewDate;
  try {
    // Persisted dates may now be in the past; they remain valid historical facts.
    interviewDate = value.interviewDate === null ? null : (() => {
      if (typeof value.interviewDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value.interviewDate)) throw new Error('date');
      const parsed = new Date(`${value.interviewDate}T12:00:00.000Z`);
      if (parsed.toISOString().slice(0, 10) !== value.interviewDate) throw new Error('date');
      return value.interviewDate;
    })();
  } catch { return null; }
  const skillIds = controlledList(value.skillIds, SKILL_SET, 8, deriveVacancySkillIds(value.roleType));
  const questionTopicIds = controlledList(value.questionTopicIds, QUESTION_SET, 9, deriveVacancyQuestionTopicIds(value.roleType));
  const target = {
    version: VACANCY_SCHEMA_VERSION,
    id: value.id,
    status,
    sourceHash: value.sourceHash,
    sourceHost,
    roleTitle,
    employerDisplay: sanitizeVacancyString(value.employerDisplay, 80, { nullable: true }),
    industryKey: value.industryKey,
    roleType: value.roleType,
    germanLevel: value.germanLevel,
    skillIds,
    questionTopicIds,
    displayRequirements: Array.isArray(value.displayRequirements)
      ? [...new Set(value.displayRequirements.map((item) => sanitizeVacancyString(item, 160)).filter(Boolean))].slice(0, 6) : [],
    interviewDate,
    schedule: [],
    analysisVersion: VACANCY_ANALYSIS_VERSION,
    createdAt,
    updatedAt,
  };
  target.schedule = buildVacancySchedule(target, { now, preserve: value.schedule });
  return target;
}

export function emptyVacancyState() {
  return {
    version: 1,
    draft: null,
    active: null,
    previewUsedAt: null,
    analysisUsage: { hour: '', hourCount: 0, month: '', monthCount: 0 },
  };
}

export function normalizeVacancyState(value) {
  const state = emptyVacancyState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state;
  state.draft = normalizeVacancyTarget(value.draft, 'draft');
  state.active = normalizeVacancyTarget(value.active, 'active');
  state.previewUsedAt = validTimestamp(value.previewUsedAt);
  const usage = value.analysisUsage || {};
  state.analysisUsage = {
    hour: typeof usage.hour === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}$/u.test(usage.hour) ? usage.hour : '',
    hourCount: Number.isSafeInteger(usage.hourCount) && usage.hourCount >= 0
      ? Math.min(usage.hourCount, VACANCY_MAX_ANALYSES_PER_HOUR) : 0,
    month: typeof usage.month === 'string' && /^\d{4}-\d{2}$/u.test(usage.month) ? usage.month : '',
    monthCount: Number.isSafeInteger(usage.monthCount) && usage.monthCount >= 0
      ? Math.min(usage.monthCount, VACANCY_MAX_ANALYSES_PER_MONTH) : 0,
  };
  return state;
}

function flagEnabled(value) {
  return /^(?:1|true|on)$/iu.test(String(value || '').trim());
}

export function vacancyMode(env = process.env) {
  const mode = String(env.VACANCY_MODE || 'off').trim().toLowerCase();
  return mode === 'beta' || mode === 'on' ? mode : 'off';
}

function resolveFlagOptions(options) {
  if (options && Object.hasOwn(options, 'VACANCY_MODE')) return { env: options, now: Date.now() };
  return { env: options?.env || process.env, now: Number(options?.now) || Date.now() };
}

export function vacancyFlagsFor(account, options = {}) {
  const { env, now } = resolveFlagOptions(options);
  const mode = vacancyMode(env);
  const admin = isAdminAccount(account);
  const betaIds = new Set(String(env.VACANCY_BETA_ACCOUNT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
  const betaAllowed = admin || account?.subscription?.vacancyBeta === true || betaIds.has(String(account?.id || ''));
  const enabled = mode === 'on' || (mode === 'beta' && betaAllowed);
  const plan = planOf(account, now);
  const trial = trialActive(account, now);
  const fullPlan = plan === 'basic' || plan === 'elite' || trial || admin;
  const liveEligible = plan === 'elite' || trial || admin;
  const aiEnabled = enabled && flagEnabled(env.VACANCY_AI_ENABLED) && !!String(env.GROQ_API_KEY || '').trim();
  return {
    mode,
    enabled,
    plan,
    trial,
    previewOnly: !fullPlan,
    fullPlan,
    liveEligible,
    live: enabled && liveEligible && flagEnabled(env.VACANCY_LIVE_ENABLED),
    aiEnabled,
    urlImport: enabled,
  };
}

export function vacancyTargetView(target, capabilities) {
  const normalized = normalizeVacancyTarget(target);
  if (!normalized) return null;
  const topicIds = capabilities?.fullPlan
    ? normalized.questionTopicIds
    : normalized.questionTopicIds.slice(0, 3);
  const publicSchedule = (capabilities?.fullPlan ? normalized.schedule : normalized.schedule.slice(0, 1))
    .map(({ completionSessionId: _privateSession, ...row }) => row);
  const { sourceHash: _privateHash, ...safe } = normalized;
  return {
    ...safe,
    questionTopicIds: topicIds,
    practiceQuestions: topicIds.slice(0, 3).map((id) => ({
      id,
      label: 'Übungsprognose',
      text: VACANCY_PRACTICE_QUESTIONS[id],
    })).filter((item) => !!item.text),
    schedule: publicSchedule,
  };
}

export function safeVacancyContext(target) {
  const normalized = normalizeVacancyTarget(target, 'active');
  if (!normalized) return null;
  return {
    targetId: normalized.id,
    industryKey: normalized.industryKey,
    roleType: normalized.roleType,
    germanLevel: normalized.germanLevel,
    skillIds: normalized.skillIds,
    questionTopicIds: normalized.questionTopicIds,
  };
}

export function vacancyLiveContext(profile, account, options = {}) {
  const capabilities = vacancyFlagsFor(account, options);
  if (!capabilities.live) return null;
  const state = normalizeVacancyState(profile?.vacancyTarget);
  return safeVacancyContext(state.active);
}

export function usageForWindow(state, now = Date.now()) {
  const normalized = normalizeVacancyState(state);
  const hour = new Date(now).toISOString().slice(0, 13);
  const month = dayKey(now).slice(0, 7);
  return {
    hour,
    hourCount: normalized.analysisUsage.hour === hour ? normalized.analysisUsage.hourCount : 0,
    month,
    monthCount: normalized.analysisUsage.month === month ? normalized.analysisUsage.monthCount : 0,
  };
}

export function dueVacancyMilestone(target, now = Date.now()) {
  const normalized = normalizeVacancyTarget(target, 'active', { now });
  if (!normalized) return null;
  const today = dayKey(now);
  return normalized.schedule.find((row) => !row.completedAt && row.scheduledDate <= today)
    || normalized.schedule.find((row) => !row.completedAt)
    || null;
}

export function isLiveVacancyMilestone(id) {
  return id === 'day_6_mock' || id === 'day_7_rehearsal' || id === 'emergency_mock';
}

export function markVacancyMilestoneComplete(target, {
  milestoneId = null,
  sessionId = null,
  meaningful = false,
  source = 'manual',
  now = Date.now(),
} = {}) {
  const normalized = normalizeVacancyTarget(target, 'active', { now });
  if (!normalized) targetError('target_not_found', 404);
  let selectedId = milestoneId;
  if (source === 'live') {
    if (!meaningful || typeof sessionId !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/u.test(sessionId)) {
      targetError('meaningful_debrief_required', 409);
    }
    selectedId = normalized.schedule.find((row) => isLiveVacancyMilestone(row.id) && !row.completedAt)?.id || null;
  }
  const row = normalized.schedule.find((item) => item.id === selectedId);
  if (!row) targetError('milestone_not_found', 404);
  if (source !== 'live' && isLiveVacancyMilestone(row.id)) targetError('meaningful_debrief_required', 409);
  if (row.completedAt) return normalized;
  const schedule = normalized.schedule.map((item) => item.id === row.id ? {
    ...item,
    completedAt: now,
    ...(source === 'live' ? { completionSessionId: sessionId } : {}),
  } : item);
  return { ...normalized, schedule, updatedAt: now };
}

export function completeVacancySession(profile, snapshot, { sessionId, meaningful, now = Date.now() } = {}) {
  if (!profile || !snapshot?.targetId) return false;
  const state = normalizeVacancyState(profile.vacancyTarget);
  if (state.active?.id !== snapshot.targetId) return false;
  if (typeof sessionId === 'string' && state.active.schedule.some((row) => row.completionSessionId === sessionId)) return false;
  const completedBefore = state.active.schedule.filter((row) => row.completedAt).length;
  try {
    state.active = markVacancyMilestoneComplete(state.active, {
      source: 'live', sessionId, meaningful, now,
    });
  } catch (error) {
    if (error?.code === 'milestone_not_found') return false;
    throw error;
  }
  const changed = state.active.schedule.filter((row) => row.completedAt).length > completedBefore;
  if (changed) profile.vacancyTarget = state;
  return changed;
}

export function activationOverrides(body, draft, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) targetError('unsupported_source');
  const allowed = new Set(['roleTitle', 'employerDisplay', 'industryKey', 'roleType', 'germanLevel', 'interviewDate']);
  if (Object.keys(body).some((key) => !allowed.has(key))) targetError('unsupported_source');
  const next = { ...draft };
  if (Object.hasOwn(body, 'roleTitle')) {
    next.roleTitle = sanitizeVacancyString(body.roleTitle, 100);
    if (!next.roleTitle) targetError('unsupported_vacancy', 422);
  }
  if (Object.hasOwn(body, 'employerDisplay')) next.employerDisplay = sanitizeVacancyString(body.employerDisplay, 80, { nullable: true });
  if (Object.hasOwn(body, 'industryKey')) {
    if (!INDUSTRY_SET.has(body.industryKey)) targetError('unsupported_vacancy', 422);
    next.industryKey = body.industryKey;
  }
  if (Object.hasOwn(body, 'roleType')) {
    if (!ROLE_SET.has(body.roleType)) targetError('unsupported_vacancy', 422);
    next.roleType = body.roleType;
  }
  if (Object.hasOwn(body, 'germanLevel')) {
    if (!LEVEL_SET.has(body.germanLevel)) targetError('unsupported_vacancy', 422);
    next.germanLevel = body.germanLevel;
  }
  if (Object.hasOwn(body, 'interviewDate')) next.interviewDate = normalizeInterviewDate(body.interviewDate, { now });
  // Skills/topics are always server-derived after a controlled role override.
  next.skillIds = deriveVacancySkillIds(next.roleType);
  next.questionTopicIds = deriveVacancyQuestionTopicIds(next.roleType);
  next.schedule = buildVacancySchedule(next, { now, preserve: draft.schedule });
  return next;
}
