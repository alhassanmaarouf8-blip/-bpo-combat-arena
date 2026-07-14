import { createHash } from 'node:crypto';
import { scenarioSupportsRole } from '../scenarios.js';
import { looksTruncatedDE } from './turnQuality.js';

/**
 * Observable evidence from a customer-service roleplay.
 *
 * This is deliberately narrower than "de-escalation skill": it records whether the learner
 * produced an ordered, non-contradictory three-step service-recovery structure. It does not infer
 * tone, employer acceptance, factual correctness, or real-world performance.
 */
export const SERVICE_RECOVERY_CRITERION_ID = 'service_recovery_structure';
export const SERVICE_RECOVERY_CRITERION_VERSION = 1;
export const SERVICE_RECOVERY_ROLE_TYPES = Object.freeze(['customer_service']);
const SERVICE_RECOVERY_ROLES = new Set(SERVICE_RECOVERY_ROLE_TYPES);
const TOTAL_STEPS = 3;
const MIN_TURNS = 2;
const MIN_WORDS = 20;

const ORDERED_SIGNALS = Object.freeze([
  Object.freeze({ id: 'empathy', patterns: Object.freeze([
    /\bich\s+(?:kann\s+)?(?:ihren?|den)\s+(?:\u00e4rger|frust)\s+(?:gut\s+)?(?:verstehen|nachvollziehen)\b/u,
    /\bich\s+(?:kann|k\u00f6nnte)\s+(?:das|ihren?\s+\u00e4rger|ihre\s+situation)\s+(?:gut\s+)?nachvollziehen\b/u,
    /\bdas\s+tut\s+mir\s+(?:wirklich\s+|aufrichtig\s+)?leid\b/u,
    /\bich\s+bedauere\s+(?:die\s+situation|den\s+vorfall|dass)\b/u,
  ]) }),
  Object.freeze({ id: 'ownership', patterns: Object.freeze([
    /\bich\s+k\u00fcmmere\s+mich\s+(?:(?:jetzt|sofort|pers\u00f6nlich)\s+)?(?:um|darum)\b/u,
    /\bich\s+(?:pr\u00fcfe|kl\u00e4re|eskaliere|veranlasse)\s+(?:(?:jetzt|sofort|pers\u00f6nlich)\s+)?(?:das|den|die|ihren?|ihre)\b/u,
    /\bich\s+\u00fcbernehme\s+(?:(?:jetzt|pers\u00f6nlich)\s+)?(?:die\s+kl\u00e4rung|die\s+pr\u00fcfung|den\s+fall|ihr\s+anliegen)\b/u,
    /\bwir\s+(?:pr\u00fcfen|kl\u00e4ren|eskalieren|veranlassen)\s+(?:das|den|die|ihren?|ihre)\b/u,
  ]) }),
  Object.freeze({ id: 'nextStep', patterns: Object.freeze([
    /\bals\s+n\u00e4chstes\s+(?:werde\s+ich\s+.{0,60}\b(?:pr\u00fcfen|kl\u00e4ren|kontaktieren|veranlassen|eskalieren)|(?:pr\u00fcfe|kl\u00e4re|kontaktiere|veranlasse|eskaliere)\s+ich)\b/u,
    /\bich\s+melde\s+mich\s+(?:noch\s+)?(?:heute|morgen|innerhalb\s+von\s+\d{1,3}\s+(?:minuten?|stunden?|tagen?))\b/u,
    /\bsie\s+(?:erhalten|bekommen)\s+(?:von\s+mir\s+)?(?:noch\s+)?(?:heute|morgen|innerhalb\s+von\s+\d{1,3}\s+(?:minuten?|stunden?|tagen?))\b/u,
    /\bich\s+(?:pr\u00fcfe|kl\u00e4re|kontaktiere|veranlasse|eskaliere)\s+.{0,60}\b(?:jetzt|sofort|heute)\b/u,
  ]) }),
]);

const HARD_NEGATIVES = Object.freeze([
  /\b(?:keine|null)\s+verantwortung\b/u,
  /\b(?:nicht|niemals)\s+(?:mein|unser)\s+problem\b/u,
  /\b(?:wir|ich)\s+(?:werden|werde|k\u00f6nnen|kann)\s+(?:gar\s+)?(?:nichts|nicht)\s+(?:tun|machen|pr\u00fcfen|kl\u00e4ren)\b/u,
  /\bich\s+k\u00fcmmere\s+mich\s+(?:gar\s+)?nicht\b/u,
  /\b(?:sie\s+sind|das\s+ist)\s+selbst\s+schuld\b/u,
]);

function wordsIn(text) {
  return String(text || '').match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function normalizedTurn(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase('de-DE').trim() : '';
}

function boundedId(value, max = 100) {
  return typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9_-]+$/u.test(value) ? value : null;
}

function normalizeContext(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const roleType = SERVICE_RECOVERY_ROLES.has(raw.roleType) ? raw.roleType : null;
  const scenarioId = boundedId(raw.scenarioId, 80);
  const sessionId = boundedId(raw.sessionId, 100);
  const targetId = raw.targetId == null ? null : boundedId(raw.targetId, 100);
  const observedAt = Number.isSafeInteger(raw.observedAt) && raw.observedAt > 0 ? raw.observedAt : null;
  const registryMatch = roleType !== null && scenarioSupportsRole(scenarioId, roleType);
  return { roleType, scenarioId, sessionId, targetId, observedAt, registryMatch };
}

function canonicalPayload(value) {
  return {
    contradicted: value.contradicted,
    observedSteps: value.observedSteps,
    totalSteps: value.totalSteps,
    turnCount: value.turnCount,
    wordCount: value.wordCount,
  };
}

function evidenceBinding(context, payload) {
  return createHash('sha256').update(JSON.stringify({
    sessionId: context.sessionId,
    targetId: context.targetId,
    roleType: context.roleType,
    scenarioId: context.scenarioId,
    criterionId: SERVICE_RECOVERY_CRITERION_ID,
    criterionVersion: SERVICE_RECOVERY_CRITERION_VERSION,
    observedAt: context.observedAt,
    payload: canonicalPayload(payload),
  })).digest('hex').slice(0, 24);
}

function firstMatchAfter(text, patterns, offset) {
  let best = null;
  for (const pattern of patterns) {
    const match = pattern.exec(text.slice(offset));
    if (!match) continue;
    const index = offset + match.index;
    if (!best || index < best.index) best = { index, end: index + match[0].length };
  }
  return best;
}

function orderedSignals(text, contradicted) {
  const result = { empathy: false, ownership: false, nextStep: false };
  if (contradicted) return result;
  let offset = 0;
  for (const signal of ORDERED_SIGNALS) {
    const match = firstMatchAfter(text, signal.patterns, offset);
    if (!match) continue;
    result[signal.id] = true;
    offset = match.end;
  }
  return result;
}

export function serviceRecoveryEvidence(turns, context = null) {
  const source = normalizeContext(context);
  const meaningful = (Array.isArray(turns) ? turns : [])
    .map(normalizedTurn)
    .filter((text) => wordsIn(text) >= 5)
    .slice(0, 20);
  const wordCount = meaningful.reduce((sum, text) => sum + wordsIn(text), 0);
  const joined = meaningful.join(' ');
  const contradicted = HARD_NEGATIVES.some((pattern) => pattern.test(joined));
  const signals = orderedSignals(joined, contradicted);
  const observedSteps = Object.values(signals).filter(Boolean).length;
  const contextComplete = source.registryMatch && source.sessionId !== null && source.observedAt !== null
    && (context?.targetId == null || source.targetId !== null);
  const eligible = contextComplete && meaningful.length >= MIN_TURNS && wordCount >= MIN_WORDS;
  const payload = { contradicted, observedSteps, totalSteps: TOTAL_STEPS,
    turnCount: meaningful.length, wordCount };
  return Object.freeze({
    version: 2,
    criterionId: SERVICE_RECOVERY_CRITERION_ID,
    criterionVersion: SERVICE_RECOVERY_CRITERION_VERSION,
    binding: contextComplete ? evidenceBinding(source, payload) : null,
    roleType: source.roleType,
    scenarioId: source.scenarioId,
    targetId: source.targetId,
    sessionId: source.sessionId,
    observedAt: source.observedAt,
    eligible,
    ...payload,
    score: eligible ? observedSteps / TOTAL_STEPS : null,
    signals: Object.freeze(signals),
  });
}

/** Only completed, spoken, confidently transcribed stage-3 turns may enter the proxy. */
export function serviceRecoveryEvidenceFromUtterances(utterances, context = null) {
  const trustworthy = (Array.isArray(utterances) ? utterances : [])
    .filter((turn) => turn?.stage === 2
      && Number(turn?.durationMs) >= 1000
      && typeof turn?.text === 'string'
      && !looksTruncatedDE(turn.text)
      && (!Array.isArray(turn.lowConf) || turn.lowConf.length === 0))
    .map((turn) => turn.text);
  return serviceRecoveryEvidence(trustworthy, context);
}

/** Validate the immutable evidence tuple and derive the score instead of trusting client values. */
export function serviceRecoveryScoreFromSession(session) {
  const evidence = session?.deescalationEvidence;
  const context = normalizeContext({
    sessionId: session?.sessionId,
    targetId: session?.vacancyTargetId ?? null,
    roleType: session?.targetRoleType,
    scenarioId: session?.scenarioId,
    observedAt: session?.date,
  });
  if (!context.registryMatch || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || evidence.version !== 2 || evidence.criterionId !== SERVICE_RECOVERY_CRITERION_ID
    || evidence.criterionVersion !== SERVICE_RECOVERY_CRITERION_VERSION
    || typeof evidence.contradicted !== 'boolean'
    || evidence.binding !== evidenceBinding(context, evidence)
    || evidence.roleType !== context.roleType || evidence.scenarioId !== context.scenarioId
    || evidence.targetId !== context.targetId || evidence.sessionId !== context.sessionId
    || evidence.observedAt !== context.observedAt
    || !Number.isInteger(evidence.observedSteps) || evidence.observedSteps < 0 || evidence.observedSteps > TOTAL_STEPS
    || (evidence.contradicted === true && evidence.observedSteps !== 0)
    || evidence.totalSteps !== TOTAL_STEPS
    || !Number.isInteger(evidence.turnCount) || evidence.turnCount < MIN_TURNS || evidence.turnCount > 20
    || !Number.isInteger(evidence.wordCount) || evidence.wordCount < MIN_WORDS || evidence.wordCount > 5000) return null;
  return evidence.contradicted ? 0 : evidence.observedSteps / TOTAL_STEPS;
}
