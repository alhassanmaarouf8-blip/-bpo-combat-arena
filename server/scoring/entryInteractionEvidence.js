import { createHash } from 'node:crypto';
import { scenarioSupportsRole } from '../scenarios.js';
import { isTrustedSpokenEvidence } from '../spokenEvidence.js';
import { looksTruncatedDE } from './turnQuality.js';

/**
 * Bound, transcript-derived evidence for the two observable entry competencies that used to have
 * no path into transfer mastery: consistent formal address and structured handling of a clear
 * customer request. The packet stores counts only; raw turns never leave the session pipeline.
 */
export const ENTRY_INTERACTION_EVIDENCE_VERSION = 1;
export const FORMAL_REGISTER_CRITERION_ID = 'formal_customer_register';
export const CLEAR_REQUEST_CRITERION_ID = 'clear_request_handling';

const ROLE_TYPES = new Set(['customer_service', 'technical_support', 'sales', 'retention', 'backoffice']);
const MIN_TURNS = 2;
const MIN_WORDS = 24;
const TOTAL_REGISTER_SIGNALS = 4;
const TOTAL_REQUEST_STEPS = 3;

const REGISTER_SIGNALS = Object.freeze([
  /\b(?:k\u00f6nnten|w\u00fcrden|m\u00f6chten|d\u00fcrfen)\s+sie\b/u,
  /\b(?:ich\s+(?:kann|werde|m\u00f6chte)\s+)?ihnen\b/u,
  /\bihr(?:e|en|er|em|es)?\s+(?:anliegen|anfrage|problem|fall|konto|bestellung|vertrag|entscheidung|daten|adresse|k\u00fcndigungswunsch|einwand|ziel|priorit\u00e4t|situation|\u00e4rger|nummer)\b/u,
  /\b(?:bitte\s+)?(?:best\u00e4tigen|pr\u00fcfen|nennen|beschreiben|sagen)\s+sie\b/u,
]);

const INFORMAL_ADDRESS = /\b(?:du|dich|dir|dein(?:e|en|er|em|es)?|euch|euer(?:e|en|er|em|es)?)\b/u;

const REQUEST_STEPS = Object.freeze([
  Object.freeze([
    /\bwenn\s+ich\s+sie\s+richtig\s+verstehe\b/u,
    /\bsie\s+(?:m\u00f6chten|brauchen|sagen),?\s+dass\b/u,
    /\b(?:ihr\s+anliegen|ihre\s+anfrage|das\s+problem)\s+(?:ist|betrifft)\b/u,
    /\bes\s+geht\s+ihnen\s+um\b/u,
    /\b(?:seit\s+wann|welche\s+fehlermeldung|welches\s+problem)\b[^?]{0,100}\?/u,
  ]),
  Object.freeze([
    /\bich\s+k\u00fcmmere\s+mich\s+(?:(?:jetzt|sofort|pers\u00f6nlich)\s+)?(?:um|darum)\b/u,
    /\b(?:ich|wir)\s+(?:pr\u00fcfe|pr\u00fcfen|kl\u00e4re|kl\u00e4ren|eskaliere|eskalieren|veranlasse|veranlassen|teste|testen)\b/u,
    /\bich\s+\u00fcbernehme\s+(?:die\s+kl\u00e4rung|die\s+pr\u00fcfung|den\s+fall|ihr\s+anliegen)\b/u,
  ]),
  Object.freeze([
    /\bals\s+n\u00e4chstes\b/u,
    /\bich\s+melde\s+mich\s+(?:noch\s+)?(?:heute|morgen|innerhalb\s+von\s+\d{1,3}\s+(?:minuten?|stunden?|tagen?))\b/u,
    /\bsie\s+(?:erhalten|bekommen)\s+.{0,50}\b(?:heute|morgen|innerhalb\s+von\s+\d{1,3}\s+(?:minuten?|stunden?|tagen?))\b/u,
    /\b(?:zuerst|im\s+n\u00e4chsten\s+schritt)\s+(?:pr\u00fcfe|kl\u00e4re|teste|kontaktiere|veranlasse|eskaliere|wir)\b/u,
  ]),
]);

const REQUEST_CONTRADICTIONS = Object.freeze([
  /\b(?:keine|null)\s+verantwortung\b/u,
  /\b(?:nicht|niemals)\s+(?:mein|unser)\s+problem\b/u,
  /\b(?:sie\s+sind|das\s+ist)\s+selbst\s+schuld\b/u,
  /\b(?:ich|wir)\s+(?:werde|werden|kann|k\u00f6nnen)\s+(?:gar\s+)?(?:nichts|nicht)\s+(?:tun|machen|pr\u00fcfen|kl\u00e4ren)\b/u,
  /\bich\s+k\u00fcmmere\s+mich\s+(?:gar\s+)?nicht\b/u,
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
  const roleType = ROLE_TYPES.has(raw.roleType) ? raw.roleType : null;
  const scenarioId = boundedId(raw.scenarioId, 80);
  const sessionId = boundedId(raw.sessionId, 100);
  const targetId = raw.targetId == null ? null : boundedId(raw.targetId, 100);
  const observedAt = Number.isSafeInteger(raw.observedAt) && raw.observedAt > 0 ? raw.observedAt : null;
  return { roleType, scenarioId, sessionId, targetId, observedAt,
    registryMatch: roleType !== null && scenarioSupportsRole(scenarioId, roleType) };
}

function canonicalPayload(value) {
  return {
    turnCount: value.turnCount,
    wordCount: value.wordCount,
    registerSignals: value.registerSignals,
    informalAddressDetected: value.informalAddressDetected,
    requestSteps: value.requestSteps,
    requestContradicted: value.requestContradicted,
  };
}

function evidenceBinding(context, payload) {
  return createHash('sha256').update(JSON.stringify({
    sessionId: context.sessionId,
    targetId: context.targetId,
    roleType: context.roleType,
    scenarioId: context.scenarioId,
    version: ENTRY_INTERACTION_EVIDENCE_VERSION,
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

function orderedRequestSteps(text, contradicted) {
  if (contradicted) return 0;
  let offset = 0;
  let observed = 0;
  for (const patterns of REQUEST_STEPS) {
    const match = firstMatchAfter(text, patterns, offset);
    if (!match) continue;
    observed += 1;
    offset = match.end;
  }
  return observed;
}

export function entryInteractionEvidence(turns, context = null) {
  const source = normalizeContext(context);
  const meaningful = (Array.isArray(turns) ? turns : [])
    .map(normalizedTurn)
    .filter((text) => wordsIn(text) >= 5)
    .slice(0, 20);
  const joined = meaningful.join(' ');
  const wordCount = meaningful.reduce((sum, text) => sum + wordsIn(text), 0);
  const registerSignals = REGISTER_SIGNALS.filter((pattern) => pattern.test(joined)).length;
  const informalAddressDetected = INFORMAL_ADDRESS.test(joined);
  const requestContradicted = REQUEST_CONTRADICTIONS.some((pattern) => pattern.test(joined));
  const requestSteps = orderedRequestSteps(joined, requestContradicted);
  const contextComplete = source.registryMatch && source.sessionId !== null && source.observedAt !== null
    && (context?.targetId == null || source.targetId !== null);
  const eligible = contextComplete && meaningful.length >= MIN_TURNS && wordCount >= MIN_WORDS;
  const payload = { turnCount: meaningful.length, wordCount, registerSignals,
    informalAddressDetected, requestSteps, requestContradicted };
  return Object.freeze({
    version: ENTRY_INTERACTION_EVIDENCE_VERSION,
    binding: contextComplete ? evidenceBinding(source, payload) : null,
    roleType: source.roleType,
    scenarioId: source.scenarioId,
    targetId: source.targetId,
    sessionId: source.sessionId,
    observedAt: source.observedAt,
    eligible,
    ...payload,
    formalRegisterScore: eligible
      ? (informalAddressDetected ? 0 : Math.min(1, registerSignals / 2)) : null,
    clearRequestScore: eligible
      ? (requestContradicted ? 0 : requestSteps / TOTAL_REQUEST_STEPS) : null,
  });
}

/** Only server-observed, completed, confidently transcribed roleplay speech may enter the packet. */
export function entryInteractionEvidenceFromUtterances(utterances, context = null) {
  const trustworthy = (Array.isArray(utterances) ? utterances : [])
    .filter((turn) => turn?.stage === 2
      && Number(turn?.durationMs) >= 1000
      && typeof turn?.text === 'string'
      && isTrustedSpokenEvidence(turn?.spokenEvidence)
      && !looksTruncatedDE(turn.text)
      && (!Array.isArray(turn.lowConf) || turn.lowConf.length === 0))
    .map((turn) => turn.text);
  return entryInteractionEvidence(trustworthy, context);
}

function validatedScores(session) {
  const evidence = session?.entryInteractionEvidence;
  const context = normalizeContext({
    sessionId: session?.sessionId,
    targetId: session?.vacancyTargetId ?? null,
    roleType: session?.targetRoleType,
    scenarioId: session?.scenarioId,
    observedAt: session?.date,
  });
  if (!context.registryMatch || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || evidence.version !== ENTRY_INTERACTION_EVIDENCE_VERSION
    || evidence.binding !== evidenceBinding(context, evidence)
    || evidence.roleType !== context.roleType || evidence.scenarioId !== context.scenarioId
    || evidence.targetId !== context.targetId || evidence.sessionId !== context.sessionId
    || evidence.observedAt !== context.observedAt
    || !Number.isInteger(evidence.turnCount) || evidence.turnCount < MIN_TURNS || evidence.turnCount > 20
    || !Number.isInteger(evidence.wordCount) || evidence.wordCount < MIN_WORDS || evidence.wordCount > 5000
    || !Number.isInteger(evidence.registerSignals) || evidence.registerSignals < 0
    || evidence.registerSignals > TOTAL_REGISTER_SIGNALS
    || typeof evidence.informalAddressDetected !== 'boolean'
    || !Number.isInteger(evidence.requestSteps) || evidence.requestSteps < 0
    || evidence.requestSteps > TOTAL_REQUEST_STEPS
    || typeof evidence.requestContradicted !== 'boolean'
    || (evidence.requestContradicted && evidence.requestSteps !== 0)) return null;
  return Object.freeze({
    formalRegisterScore: evidence.informalAddressDetected ? 0 : Math.min(1, evidence.registerSignals / 2),
    clearRequestScore: evidence.requestContradicted ? 0 : evidence.requestSteps / TOTAL_REQUEST_STEPS,
    binding: evidence.binding,
  });
}

export function formalRegisterScoreFromSession(session) {
  return validatedScores(session)?.formalRegisterScore ?? null;
}

export function clearRequestScoreFromSession(session) {
  return validatedScores(session)?.clearRequestScore ?? null;
}
