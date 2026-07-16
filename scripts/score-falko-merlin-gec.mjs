import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadFrozenGecTest, scoreGecPredictions } from './lib/gec-benchmark.mjs';
import { sha256 } from './lib/merlin-benchmark.mjs';

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
  if (!args.data || !args.predictions) throw new Error('--data and --predictions are required');
  const manifestBuffer = await readFile(path.join(root, 'benchmarks', 'falko-merlin-gec-wnut2018.manifest.json'));
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  const gold = await loadFrozenGecTest(path.resolve(args.data), manifest);
  const predictionBuffer = await readFile(path.resolve(args.predictions));
  const predictions = predictionBuffer.toString('utf8').split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const report = {
    schemaVersion: 1,
    status: 'written-german-exact-reference-benchmark',
    manifestSha256: sha256(manifestBuffer),
    predictionsSha256: sha256(predictionBuffer),
    containsLearnerText: false,
    ...scoreGecPredictions(gold, predictions),
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) await writeFile(path.resolve(args.out), output, { flag: 'wx' });
  else process.stdout.write(output);
}

main().catch((error) => {
  console.error(`[benchmark:gec:score] ${error.message}`);
  process.exitCode = 1;
});
