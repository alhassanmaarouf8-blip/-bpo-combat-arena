import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildGrammar } from '../server/grammarCheck.js';
import {
  buildIndex,
  deterministicSample,
  grammarExamples,
  merlinItemHash,
  parseCsv,
  redactAdjudicationFragment,
  sha256,
} from './lib/merlin-benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'benchmarks', 'merlin-v1.2.manifest.json');
const resultPath = path.join(root, 'benchmarks', 'results', 'merlin-v1.2-languagetool-calibration-summary.json');

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error(`Invalid argument near ${argv[i] || '<end>'}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetries(operation, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await wait(Math.min(30000, 2000 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  for (const required of ['metadata', 'texts', 'predictions', 'out-pack', 'out-key']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const sampleSize = Number(args['sample-size'] ?? 40);
  if (!Number.isInteger(sampleSize) || sampleSize < 10 || sampleSize > 100) throw new Error('--sample-size must be an integer from 10 to 100');
  const delayMs = Number(args['delay-ms'] ?? 1500);
  if (!Number.isInteger(delayMs) || delayMs < 250 || delayMs > 60000) throw new Error('--delay-ms must be an integer from 250 to 60000');
  const outputs = [path.resolve(args['out-pack']), path.resolve(args['out-key'])];
  if (outputs.some((output) => output === root || output.startsWith(`${root}${path.sep}`))) {
    throw new Error('Adjudication packs must stay outside the application repository');
  }

  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const summary = JSON.parse(await readFile(resultPath, 'utf8'));
  const metadataBuffer = await readFile(path.resolve(args.metadata));
  const predictionsBuffer = await readFile(path.resolve(args.predictions));
  if (sha256(metadataBuffer) !== manifest.metadataSha256) throw new Error('Metadata hash does not match the frozen manifest');
  if (sha256(predictionsBuffer) !== summary.predictionFileSha256) throw new Error('Prediction hash does not match the completed calibration arm');
  const rows = parseCsv(metadataBuffer.toString('utf8'));
  const items = buildIndex(rows, manifest);
  const itemByHash = new Map(items.map((item) => [item.itemHash, item]));
  const authorByHash = new Map(rows.filter((row) => row._test_language === 'German').map(
    (row) => [merlinItemHash(manifest.version, row._author_id), row._author_id],
  ));
  const predictions = predictionsBuffer.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const unmatched = predictions
    .filter((prediction) => prediction.system === 'languagetool' && prediction.correctionCount > 0)
    .map((prediction) => itemByHash.get(prediction.itemHash))
    .filter((item) => item?.split === 'calibration' && !item.hasGrammarError);
  const selected = deterministicSample(unmatched, sampleSize, 'merlin-lt-unmatched-v1', (item) => item.arabicL1);
  const blindItems = [];
  const keyItems = [];

  for (const [index, item] of selected.entries()) {
    const authorId = authorByHash.get(item.itemHash);
    const text = (await readFile(path.join(path.resolve(args.texts), `${authorId}.txt`), 'utf8')).trim();
    const grammar = await withRetries(() => buildGrammar([{ text, words: text.split(/\s+/).filter(Boolean).length }]));
    const reviewId = sha256(`review|merlin-lt-unmatched-v1|${item.itemHash}`).slice(0, 16);
    const corrections = [];
    const correctionKeys = [];
    for (const rule of grammar) {
      for (const example of grammarExamples(rule)) {
        const before = redactAdjudicationFragment(example.wrongFragment || example.wrongWord || example.wrong);
        const after = redactAdjudicationFragment(example.rightFragment || example.rightWord || example.right);
        if (!before || !after || before === after) continue;
        const correctionId = sha256(`${reviewId}|${rule.ltRuleId}|${before}|${after}`).slice(0, 16);
        corrections.push({ correctionId, before, after, verdict: null, reviewerNote: '' });
        correctionKeys.push({ correctionId, ltRuleId: rule.ltRuleId || 'unknown', ltCategoryId: rule.ltCategoryId || 'unknown' });
      }
    }
    if (corrections.length) {
      blindItems.push({ reviewId, corrections });
      keyItems.push({ reviewId, itemHash: item.itemHash, fairCefr: item.fairCefr, arabicL1: item.arabicL1, corrections: correctionKeys });
    }
    if (index < selected.length - 1) await wait(delayMs);
  }

  const pack = {
    schemaVersion: 1,
    study: 'MERLIN LanguageTool unmatched-positive blinded adjudication',
    generatedAt: new Date().toISOString(),
    containsFullLearnerDocuments: false,
    hiddenFromReviewer: ['provider', 'MERLIN label', 'CEFR', 'L1', 'rule ID', 'item hash'],
    verdicts: ['valid', 'acceptable_alternative', 'harmful', 'unclear'],
    instructions: 'Judge only whether changing BEFORE to AFTER is a valid necessary correction in the shown context. Do not infer spoken ability, CEFR, or hiring readiness.',
    items: blindItems,
  };
  const key = {
    schemaVersion: 1,
    sampleSeed: 'merlin-lt-unmatched-v1',
    predictionFileSha256: summary.predictionFileSha256,
    sampleDocuments: blindItems.length,
    corrections: blindItems.reduce((total, item) => total + item.corrections.length, 0),
    items: keyItems,
  };
  if (!blindItems.length || !key.corrections) {
    throw new Error('Selected unmatched positives produced no reviewable corrections');
  }
  await writeFile(outputs[0], `${JSON.stringify(pack, null, 2)}\n`, { flag: 'wx' });
  await writeFile(outputs[1], `${JSON.stringify(key, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, sampleDocuments: key.sampleDocuments, corrections: key.corrections, pack: outputs[0], key: outputs[1], fullDocumentsWritten: false }));
}

main().catch((error) => {
  console.error(`[benchmark:merlin:adjudicate] ${error.message}`);
  process.exitCode = 1;
});
