import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  HOLDOUT_UNLOCK,
  buildIndex,
  parseCsv,
  publicIndex,
  scorePredictions,
  sha256,
} from './lib/merlin-benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'benchmarks', 'merlin-v1.2.manifest.json');

function argsOf(argv) {
  const command = argv[0];
  const args = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] == null) throw new Error(`Invalid argument near ${argv[i] || '<end>'}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return { command, args };
}

async function loadVerified(args) {
  for (const required of ['metadata', 'license', 'texts']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const metadata = await readFile(path.resolve(args.metadata));
  const license = await readFile(path.resolve(args.license));
  if (sha256(metadata) !== manifest.metadataSha256) throw new Error('Metadata hash does not match the frozen MERLIN v1.2 manifest');
  if (sha256(license) !== manifest.licenseSha256) throw new Error('License hash does not match the frozen MERLIN v1.2 manifest');
  const textFiles = (await readdir(path.resolve(args.texts), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.txt'));
  if (textFiles.length !== manifest.expected.germanTextFiles) throw new Error(`German text-file count mismatch: ${textFiles.length}`);
  const rows = parseCsv(metadata.toString('utf8'));
  return { manifest, manifestHash: sha256(manifestText), items: buildIndex(rows, manifest) };
}

async function main() {
  const { command, args } = argsOf(process.argv.slice(2));
  if (!['prepare', 'score'].includes(command)) {
    throw new Error('Usage: npm run benchmark:merlin -- prepare|score --metadata <csv> --license <LICENSE> --texts <german-dir> ...');
  }
  const loaded = await loadVerified(args);
  if (command === 'prepare') {
    if (!args.out) throw new Error('--out is required and must point outside the application repository');
    const out = path.resolve(args.out);
    if (out === root || out.startsWith(`${root}${path.sep}`)) throw new Error('Benchmark indexes containing corpus-derived metadata must stay outside the application repository');
    await writeFile(out, `${JSON.stringify(publicIndex(loaded.items, loaded.manifestHash), null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ ok: true, out, items: loaded.items.length, rawLearnerDataWritten: false }));
    return;
  }

  if (!args.predictions || !args.split) throw new Error('score requires --predictions and --split');
  if (!['calibration', 'development', 'holdout'].includes(args.split)) throw new Error('Invalid --split');
  if (args.split === 'holdout' && args['unlock-holdout'] !== HOLDOUT_UNLOCK) {
    throw new Error(`Holdout is locked. A deliberate one-time run requires --unlock-holdout ${HOLDOUT_UNLOCK}`);
  }
  const lines = (await readFile(path.resolve(args.predictions), 'utf8')).split(/\r?\n/).filter(Boolean);
  const predictions = lines.map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid prediction JSON on line ${index + 1}`); }
  });
  const report = {
    schemaVersion: 1,
    datasetManifestHash: loaded.manifestHash,
    split: args.split,
    generatedAt: new Date().toISOString(),
    containsRawLearnerData: false,
    construct: 'document-level presence of an annotated grammar error (count_G > 0)',
    limitation: 'This is not correction-span accuracy, spoken accuracy, coaching accuracy, or hiring readiness.',
    systems: scorePredictions(loaded.items, predictions, args.split),
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) await writeFile(path.resolve(args.out), output, { flag: 'wx' });
  else process.stdout.write(output);
}

main().catch((error) => {
  console.error(`[benchmark:merlin] ${error.message}`);
  process.exitCode = 1;
});
