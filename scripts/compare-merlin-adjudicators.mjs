import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sha256, summarizeInterRaterAgreement } from './lib/merlin-benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  for (const required of ['pack', 'rater-a', 'rater-b', 'out-report', 'out-disagreements']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const protectedPaths = [args['rater-a'], args['rater-b'], args['out-report'], args['out-disagreements']].map((file) => path.resolve(file));
  if (protectedPaths.some((file) => file === root || file.startsWith(`${root}${path.sep}`))) {
    throw new Error('Human review and adjudication files must stay outside the application repository');
  }
  const inputs = {};
  for (const [name, file] of Object.entries({ pack: args.pack, a: args['rater-a'], b: args['rater-b'] })) {
    inputs[name] = await readFile(path.resolve(file));
  }
  const pack = JSON.parse(inputs.pack.toString('utf8'));
  const reviewA = JSON.parse(inputs.a.toString('utf8'));
  const reviewB = JSON.parse(inputs.b.toString('utf8'));
  const summary = summarizeInterRaterAgreement(pack, reviewA, reviewB);
  const correctionIndex = new Map((pack.items || []).flatMap((item) => (item.corrections || []).map((correction) => [
    correction.correctionId,
    { correctionId: correction.correctionId, before: correction.before, after: correction.after },
  ])));
  const disagreementPack = {
    schemaVersion: 1,
    adjudicatorId: '',
    qualificationAttested: false,
    items: summary.disagreementItems.map((item) => ({ ...correctionIndex.get(item.correctionId), ...item, finalVerdict: null, rationale: '' })),
  };
  const report = {
    schemaVersion: 1,
    status: 'two-independent-qualified-raters-not-yet-adjudicated',
    packSha256: sha256(inputs.pack),
    raterFileHashes: [sha256(inputs.a), sha256(inputs.b)].sort(),
    reviewerIdentityStored: false,
    containsLearnerText: false,
    ...Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'disagreementItems')),
  };
  await writeFile(path.resolve(args['out-report']), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.resolve(args['out-disagreements']), `${JSON.stringify(disagreementPack, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, reviewed: summary.reviewed, agreements: summary.agreements, disagreements: summary.disagreements }));
}

main().catch((error) => {
  console.error(`[benchmark:merlin:compare-adjudicators] ${error.message}`);
  process.exitCode = 1;
});
