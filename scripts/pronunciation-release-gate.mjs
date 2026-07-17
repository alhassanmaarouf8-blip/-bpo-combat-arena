import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { evaluatePronunciationRelease } from '../server/pronunciationCore.js';
import { PRONUNCIATION_PROTOCOL_VERSION, pronunciationDeviation } from '../server/pronunciationRegistry.js';

const PRIVATE = /(?:audio|transcript|email|phone|name|account|participant|reviewer|session|employer|url)/iu;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
function inspect(value, at = 'input') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key) || PRIVATE.test(key)) throw new Error(`${at}.${key} is forbidden private data`);
    inspect(child, `${at}.${key}`);
  }
}
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${label} has missing or unknown fields`);
}

export function finalizePronunciationRelease(input) {
  inspect(input);
  exact(input, ['schemaVersion', 'categoryId', 'protocolVersion', 'modelVersion', 'targetLearners', 'metrics'], 'input');
  exact(input.metrics, ['expertKappa', 'correctionTruePositive', 'correctionTotal', 'abstentionCorrect',
    'abstentionTotal', 'highImpactDetected', 'highImpactTotal', 'harmfulAcceptedVariantCorrections'], 'metrics');
  if (input.schemaVersion !== 1 || input.protocolVersion !== PRONUNCIATION_PROTOCOL_VERSION
    || !pronunciationDeviation(input.categoryId) || !/^[a-zA-Z0-9._-]{3,80}$/u.test(input.modelVersion || '')) {
    throw new Error('Unknown category, version, or model binding');
  }
  if (!Number.isInteger(input.targetLearners) || input.targetLearners < 0) throw new Error('Invalid target learner denominator');
  const evaluation = evaluatePronunciationRelease(input.metrics);
  const enoughLearners = input.targetLearners >= 30;
  return Object.freeze({ schemaVersion: 1, categoryId: input.categoryId, protocolVersion: input.protocolVersion,
    modelVersion: input.modelVersion, evidenceClass: enoughLearners ? 'validation' : 'pilot', targetLearners: input.targetLearners,
    passed: enoughLearners && evaluation.passed, ...(enoughLearners ? {} : { reason: 'fewer_than_30_target_learners' }),
    metrics: evaluation });
}

async function main() {
  const args = process.argv.slice(2); const inputAt = args.indexOf('--input'); const outputAt = args.indexOf('--output');
  if (inputAt < 0 || outputAt < 0) throw new Error('Usage: study:pronunciation:gate -- --input <aggregate.json> --output <report.json>');
  const inputPath = path.resolve(args[inputAt + 1]); const outputPath = path.resolve(args[outputAt + 1]);
  const parsed = JSON.parse(await readFile(inputPath, 'utf8')); const report = finalizePronunciationRelease(parsed);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`[pronunciation-gate] ${report.categoryId}: ${report.passed ? 'PASS' : 'FAIL'} (${report.evidenceClass})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'))) {
  main().catch((error) => { console.error(`[pronunciation-gate] ${error.message}`); process.exitCode = 1; });
}

