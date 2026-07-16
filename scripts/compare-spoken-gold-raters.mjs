import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSpokenDisagreementTemplate, sha256, summarizeSpokenInterRater } from './lib/spoken-gold-study.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argsOf(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] == null) throw new Error(`Invalid argument near ${argv[index] || '<end>'}`);
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

function protectedPath(file) {
  const resolved = path.resolve(file);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Human spoken-review and disagreement files must stay outside the application repository');
  }
  return resolved;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  for (const required of ['pack', 'rater-a', 'rater-b', 'out-report', 'out-disagreements']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const paths = Object.fromEntries(Object.entries(args).map(([name, file]) => [name, protectedPath(file)]));
  const files = {};
  for (const [name, file] of Object.entries({ pack: paths.pack, a: paths['rater-a'], b: paths['rater-b'] })) {
    files[name] = await readFile(file);
  }
  const pack = JSON.parse(files.pack.toString('utf8'));
  const reviewA = JSON.parse(files.a.toString('utf8'));
  const reviewB = JSON.parse(files.b.toString('utf8'));
  const summary = summarizeSpokenInterRater(pack, reviewA, reviewB);
  const disagreementTemplate = createSpokenDisagreementTemplate(pack, reviewA, reviewB);
  const report = {
    schemaVersion: 1,
    status: 'two-independent-qualified-raters-not-yet-adjudicated',
    packSha256: sha256(files.pack),
    raterFileHashes: [sha256(files.a), sha256(files.b)].sort(),
    reviewerIdentityStored: false,
    containsRawAudioOrTranscript: false,
    ...Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'disagreementItems')),
  };
  await Promise.all([
    writeFile(paths['out-report'], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' }),
    writeFile(paths['out-disagreements'], `${JSON.stringify(disagreementTemplate, null, 2)}\n`, { flag: 'wx' }),
  ]);
  console.log(JSON.stringify({ ok: true, reviewed: summary.reviewed, agreements: summary.agreements,
    disagreements: summary.disagreements }));
}

main().catch((error) => {
  console.error(`[study:spoken:compare] ${error.message}`);
  process.exitCode = 1;
});
