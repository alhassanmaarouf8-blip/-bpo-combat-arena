import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildSpokenGoldStudy,
  loadStudyProfileSnapshots,
  sha256,
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
    throw new Error('Private study inputs, media references, keys, and human-review files must stay outside the application repository');
  }
  return resolved;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  for (const required of ['input', 'out-pack', 'out-key', 'out-review-a', 'out-review-b']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const paths = Object.fromEntries(Object.entries(args).map(([name, file]) => [name, outsideRepository(file)]));
  if (new Set(Object.values(paths)).size !== Object.values(paths).length) throw new Error('Every study file path must be distinct');
  const source = await readFile(paths.input);
  const input = JSON.parse(source.toString('utf8'));
  const profileSnapshots = await loadStudyProfileSnapshots(input, path.dirname(paths.input));
  const { pack, key, reviewTemplate } = buildSpokenGoldStudy(input, { profileSnapshots });
  const media = await verifyStudyMediaFiles(pack, path.dirname(paths.input));
  const reviewA = { ...reviewTemplate, reviewerId: 'rater_a' };
  const reviewB = { ...reviewTemplate, reviewerId: 'rater_b' };
  await Promise.all([
    writeFile(paths['out-pack'], `${JSON.stringify(pack, null, 2)}\n`, { flag: 'wx' }),
    writeFile(paths['out-key'], `${JSON.stringify(key, null, 2)}\n`, { flag: 'wx' }),
    writeFile(paths['out-review-a'], `${JSON.stringify(reviewA, null, 2)}\n`, { flag: 'wx' }),
    writeFile(paths['out-review-b'], `${JSON.stringify(reviewB, null, 2)}\n`, { flag: 'wx' }),
  ]);
  console.log(JSON.stringify({ ok: true, cases: pack.items.length, verifiedMediaFiles: media.verifiedFiles,
    inputSha256: sha256(source) }));
}

main().catch((error) => {
  console.error(`[study:spoken:create] ${error.message}`);
  process.exitCode = 1;
});
