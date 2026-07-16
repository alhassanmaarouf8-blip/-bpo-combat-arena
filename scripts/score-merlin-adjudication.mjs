import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { summarizeAdjudication, sha256 } from './lib/merlin-benchmark.mjs';

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error(`Invalid argument near ${argv[i] || '<end>'}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  for (const required of ['pack', 'key', 'verdicts']) if (!args[required]) throw new Error(`--${required} is required`);
  const packBuffer = await readFile(path.resolve(args.pack));
  const keyBuffer = await readFile(path.resolve(args.key));
  const verdictBuffer = await readFile(path.resolve(args.verdicts));
  const pack = JSON.parse(packBuffer.toString('utf8'));
  const key = JSON.parse(keyBuffer.toString('utf8'));
  const verdicts = JSON.parse(verdictBuffer.toString('utf8'));
  if (verdicts.notGoldTruth !== true || verdicts.reviewerType !== 'single-ai-internal-triage') {
    throw new Error('Internal triage must be explicitly marked notGoldTruth');
  }
  const blindIds = new Set((pack.items || []).flatMap((item) => (item.corrections || []).map((correction) => correction.correctionId)));
  for (const verdict of verdicts.verdicts || []) {
    if (!blindIds.has(verdict.correctionId)) throw new Error(`Verdict is not present in the blinded pack: ${verdict.correctionId}`);
  }
  const summary = summarizeAdjudication(key, verdicts);
  const report = {
    schemaVersion: 1,
    status: 'internal-triage-not-gold-truth',
    reviewerType: verdicts.reviewerType,
    packSha256: sha256(packBuffer),
    keySha256: sha256(keyBuffer),
    verdictsSha256: sha256(verdictBuffer),
    containsLearnerText: false,
    warning: 'A single AI review cannot validate product accuracy or replace independent qualified German raters.',
    ...summary,
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) await writeFile(path.resolve(args.out), output, { flag: 'wx' });
  else process.stdout.write(output);
}

main().catch((error) => {
  console.error(`[benchmark:merlin:score-adjudication] ${error.message}`);
  process.exitCode = 1;
});
