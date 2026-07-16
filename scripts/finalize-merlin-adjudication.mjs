import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { finalizeAdjudication, sha256 } from './lib/merlin-benchmark.mjs';

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
  for (const required of ['pack', 'key', 'rater-a', 'rater-b', 'resolution', 'out']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const output = path.resolve(args.out);
  if (output === root || output.startsWith(`${root}${path.sep}`)) {
    throw new Error('Unreviewed human adjudication output must stay outside the application repository');
  }
  const files = {};
  for (const [name, file] of Object.entries({ pack: args.pack, key: args.key, a: args['rater-a'], b: args['rater-b'], resolution: args.resolution })) {
    files[name] = await readFile(path.resolve(file));
  }
  const result = finalizeAdjudication(
    JSON.parse(files.pack.toString('utf8')),
    JSON.parse(files.key.toString('utf8')),
    JSON.parse(files.a.toString('utf8')),
    JSON.parse(files.b.toString('utf8')),
    JSON.parse(files.resolution.toString('utf8')),
  );
  const report = {
    schemaVersion: 1,
    status: 'qualified-two-rater-adjudication-complete',
    sourceHashes: {
      pack: sha256(files.pack),
      key: sha256(files.key),
      reviews: [sha256(files.a), sha256(files.b)].sort(),
      resolution: sha256(files.resolution),
    },
    reviewerIdentityStored: false,
    containsLearnerText: false,
    agreement: Object.fromEntries(Object.entries(result.agreement).filter(([key]) => key !== 'disagreementItems')),
    final: result.final,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, reviewed: result.final.reviewed, harmfulRate: result.final.harmfulRate, output }));
}

main().catch((error) => {
  console.error(`[benchmark:merlin:finalize-adjudication] ${error.message}`);
  process.exitCode = 1;
});
