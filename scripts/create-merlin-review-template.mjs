import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
  for (const required of ['pack', 'reviewer-id', 'out']) if (!args[required]) throw new Error(`--${required} is required`);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(args['reviewer-id'])) throw new Error('--reviewer-id must be an opaque 3-64 character identifier');
  const output = path.resolve(args.out);
  if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error('Human review files must stay outside the application repository');
  const pack = JSON.parse(await readFile(path.resolve(args.pack), 'utf8'));
  const verdicts = (pack.items || []).flatMap((item) => (item.corrections || []).map((correction) => ({
    correctionId: correction.correctionId,
    verdict: '',
    reviewerNote: '',
  })));
  if (!verdicts.length || new Set(verdicts.map((entry) => entry.correctionId)).size !== verdicts.length) {
    throw new Error('Pack has no corrections or contains duplicate correction IDs');
  }
  const review = {
    schemaVersion: 1,
    reviewerId: args['reviewer-id'],
    qualificationAttested: false,
    independentReviewAttested: false,
    verdicts,
  };
  await writeFile(output, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, corrections: verdicts.length, output }));
}

main().catch((error) => {
  console.error(`[benchmark:merlin:create-review] ${error.message}`);
  process.exitCode = 1;
});
