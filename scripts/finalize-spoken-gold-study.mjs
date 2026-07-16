import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  finalizeSpokenGoldStudy,
  loadStudyProfileSnapshots,
  sha256,
  verifySpokenGoldStudyProvenance,
  verifyStudyMediaFiles,
} from './lib/spoken-gold-study.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argsOf(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] == null) throw new Error(`Invalid argument near ${argv[index] || '<end>'}`);
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

function outsideRepository(file) {
  const resolved = path.resolve(file);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Human spoken-study files and unreviewed aggregate output must stay outside the application repository');
  }
  return resolved;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  for (const required of ['input', 'pack', 'key', 'rater-a', 'rater-b', 'resolution', 'out']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const paths = Object.fromEntries(Object.entries(args).map(([name, file]) => [name, outsideRepository(file)]));
  if (new Set(Object.values(paths)).size !== Object.values(paths).length) throw new Error('Every study file path must be distinct');
  const files = {};
  for (const name of ['input', 'pack', 'key', 'rater-a', 'rater-b', 'resolution']) {
    files[name] = await readFile(paths[name]);
  }
  const input = JSON.parse(files.input.toString('utf8'));
  const profileSnapshots = await loadStudyProfileSnapshots(input, path.dirname(paths.input));
  const suppliedPack = JSON.parse(files.pack.toString('utf8'));
  const suppliedKey = JSON.parse(files.key.toString('utf8'));
  const { pack, key } = verifySpokenGoldStudyProvenance(
    input,
    profileSnapshots,
    suppliedPack,
    suppliedKey,
  );
  await verifyStudyMediaFiles(pack, path.dirname(paths.input));
  const report = finalizeSpokenGoldStudy(
    pack,
    key,
    JSON.parse(files['rater-a'].toString('utf8')),
    JSON.parse(files['rater-b'].toString('utf8')),
    JSON.parse(files.resolution.toString('utf8')),
  );
  const output = {
    ...report,
    sourceHashes: {
      input: sha256(files.input), pack: sha256(files.pack), key: sha256(files.key),
      reviews: [sha256(files['rater-a']), sha256(files['rater-b'])].sort(),
      resolution: sha256(files.resolution),
    },
  };
  await writeFile(paths.out, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, status: report.status,
    targetParticipants: report.appComparison.targetParticipantCount }));
}

main().catch((error) => {
  console.error(`[study:spoken:finalize] ${error.message}`);
  process.exitCode = 1;
});
