import { looksTruncatedDE } from './turnQuality.js';

/**
 * Observable evidence from the customer-roleplay stage.
 *
 * This is deliberately narrower than "de-escalation skill": it records whether the learner
 * produced the three service-recovery building blocks the simulation can detect reliably.
 * It does not infer tone, employer acceptance, or a complete real-world performance verdict.
 */
export const SERVICE_RECOVERY_CRITERION_ID = 'service_recovery_structure';
const TOTAL_STEPS = 3;
const MIN_TURNS = 2;
const MIN_WORDS = 20;

const SIGNALS = Object.freeze({
  empathy: [
    /\bich\s+(?:kann\s+)?(?:ihren?|den)\s+(?:ärger|frust)\s+(?:gut\s+)?(?:verstehen|nachvollziehen)\b/u,
    /\bich\s+(?:kann|könnte)\s+(?:das|ihren?\s+ärger|ihre\s+situation)\s+(?:gut\s+)?nachvollziehen\b/u,
    /\bdas\s+tut\s+mir\s+(?:wirklich\s+|aufrichtig\s+)?leid\b/u,
    /\bich\s+bedauere\b/u,
    /\bentschuldigen\s+sie\b/u,
  ],
  ownership: [
    /\bich\s+(?:kümmere\s+mich|übernehme|kläre|prüfe|schaue|veranlasse|eskaliere)\b/u,
    /\bich\s+nehme\s+(?:ihr\s+anliegen|ihren\s+fall|das)\b/u,
    /\bwir\s+(?:klären|prüfen|veranlassen|eskalieren)\b/u,
  ],
  nextStep: [
    /\bals\s+nächstes\b/u,
    /\bich\s+(?:werde|würde\s+vorschlagen|schlage\s+vor|melde\s+mich)\b/u,
    /\bwir\s+werden\b/u,
    /\b(?:sie\s+)?(?:erhalten|bekommen)\s+(?:von\s+mir\s+)?(?:noch\s+)?(?:heute|morgen|innerhalb)\b/u,
    /\binnerhalb\s+von\s+\d{1,3}\s+(?:minuten?|stunden?|tagen?)\b/u,
  ],
});

function wordsIn(text) {
  return String(text || '').match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function normalizedTurn(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase('de-DE').trim() : '';
}

export function serviceRecoveryEvidence(turns) {
  const meaningful = (Array.isArray(turns) ? turns : [])
    .map(normalizedTurn)
    .filter((text) => wordsIn(text) >= 5)
    .slice(0, 20);
  const wordCount = meaningful.reduce((sum, text) => sum + wordsIn(text), 0);
  const joined = meaningful.join(' ');
  const signals = Object.fromEntries(Object.entries(SIGNALS)
    .map(([key, patterns]) => [key, patterns.some((pattern) => pattern.test(joined))]));
  const observedSteps = Object.values(signals).filter(Boolean).length;
  const eligible = meaningful.length >= MIN_TURNS && wordCount >= MIN_WORDS;
  return Object.freeze({
    version: 1,
    criterionId: SERVICE_RECOVERY_CRITERION_ID,
    eligible,
    turnCount: meaningful.length,
    wordCount,
    observedSteps,
    totalSteps: TOTAL_STEPS,
    score: eligible ? observedSteps / TOTAL_STEPS : null,
    signals: Object.freeze(signals),
  });
}

/** Only completed, spoken, confidently transcribed stage-3 turns may enter the proxy. */
export function serviceRecoveryEvidenceFromUtterances(utterances) {
  const trustworthy = (Array.isArray(utterances) ? utterances : [])
    .filter((turn) => turn?.stage === 2
      && Number(turn?.durationMs) >= 1000
      && typeof turn?.text === 'string'
      && !looksTruncatedDE(turn.text)
      && (!Array.isArray(turn.lowConf) || turn.lowConf.length === 0))
    .map((turn) => turn.text);
  return serviceRecoveryEvidence(trustworthy);
}

/** Validate persisted bounded evidence and derive the score instead of trusting a client value. */
export function serviceRecoveryScoreFromSession(session) {
  const evidence = session?.deescalationEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || evidence.version !== 1 || evidence.criterionId !== SERVICE_RECOVERY_CRITERION_ID
    || !Number.isInteger(evidence.observedSteps) || evidence.observedSteps < 0 || evidence.observedSteps > TOTAL_STEPS
    || evidence.totalSteps !== TOTAL_STEPS
    || !Number.isInteger(evidence.turnCount) || evidence.turnCount < MIN_TURNS || evidence.turnCount > 20
    || !Number.isInteger(evidence.wordCount) || evidence.wordCount < MIN_WORDS || evidence.wordCount > 5000) return null;
  return evidence.observedSteps / TOTAL_STEPS;
}
