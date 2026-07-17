import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  EXPERT_GOLD_SCHEMA_VERSION,
  buildExpertGoldStudy,
  compareExpertReviews,
  createExpertDisagreementPack,
  finalizeExpertGoldStudy,
  loadExpertGoldProfiles,
  sha256,
  verifyFrozenExpertGoldStudy,
} from './lib/expert-gold-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILENAMES = Object.freeze({
  pack: 'expert-gold-blind-pack.json', key: 'expert-gold-hidden-key.json',
  reviewA: 'expert-gold-review-a.json', reviewB: 'expert-gold-review-b.json',
  interRater: 'expert-gold-inter-rater.json', disagreements: 'expert-gold-disagreements.json',
  adjudication: 'expert-gold-adjudication.json', report: 'expert-gold-final-report.json',
  holdoutReceipt: 'expert-gold-holdout-opened.json',
});

function parseArgs(argv) {
  const [command, ...rest] = argv; const args = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith('--') || rest[index + 1] == null) throw new Error(`Invalid argument near ${rest[index] || '<end>'}`);
    args[rest[index].slice(2)] = rest[index + 1];
  }
  if (!['create', 'validate', 'compare', 'adjudicate', 'finalize'].includes(command)) {
    throw new Error('Usage: study:expert-gold -- create|validate|compare|adjudicate|finalize --input <outside-repo.json> --dir <outside-repo-dir>');
  }
  if (!args.dir || (['create', 'validate', 'finalize'].includes(command) && !args.input)) throw new Error('--dir and, for create/validate/finalize, --input are required');
  return { command, args };
}
function outsideRepository(value, label) {
  const resolved = path.resolve(value);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} must stay outside the application repository`);
  return resolved;
}
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
function file(directory, key) { return path.join(directory, FILENAMES[key]); }
async function writeNew(filePath, value) { await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }

async function rebuild(inputPath, directory) {
  const input = await json(inputPath);
  const profiles = await loadExpertGoldProfiles(input, path.dirname(inputPath));
  return { input, built: await buildExpertGoldStudy(input, { profiles, baseDirectory: path.dirname(inputPath) }) };
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const directory = outsideRepository(args.dir, 'Study directory');
  const inputPath = args.input ? outsideRepository(args.input, 'Study input') : null;
  await mkdir(directory, { recursive: true });
  if (command === 'create') {
    const source = await readFile(inputPath); const { built } = await rebuild(inputPath, directory);
    await Promise.all([
      writeNew(file(directory, 'pack'), built.pack), writeNew(file(directory, 'key'), built.key),
      writeNew(file(directory, 'reviewA'), { ...built.reviewTemplate, reviewerId: 'rater_a' }),
      writeNew(file(directory, 'reviewB'), { ...built.reviewTemplate, reviewerId: 'rater_b' }),
    ]);
    console.log(JSON.stringify({ ok: true, command, cases: built.pack.items.length, inputSha256: sha256(source) }));
    return;
  }
  if (command === 'validate') {
    const { built } = await rebuild(inputPath, directory);
    verifyFrozenExpertGoldStudy(null, built, await json(file(directory, 'pack')), await json(file(directory, 'key')));
    console.log(JSON.stringify({ ok: true, command, cases: built.pack.items.length })); return;
  }
  if (command === 'compare') {
    const pack = await json(file(directory, 'pack')); const a = await json(file(directory, 'reviewA')); const b = await json(file(directory, 'reviewB'));
    const compared = compareExpertReviews(pack, a, b); const disagreements = createExpertDisagreementPack(pack, a, b);
    const report = { schemaVersion: EXPERT_GOLD_SCHEMA_VERSION, status: 'two-independent-raters-not-yet-adjudicated',
      reviewed: compared.reviewed, agreements: compared.agreements, disagreements: compared.disagreements,
      evidenceState: compared.evidenceState, topBottleneck: compared.topBottleneck, analytic: compared.analytic,
      containsRawAudioOrTranscript: false, reviewerIdentityStored: false };
    await Promise.all([writeNew(file(directory, 'interRater'), report), writeNew(file(directory, 'disagreements'), disagreements)]);
    console.log(JSON.stringify({ ok: true, command, reviewed: compared.reviewed, disagreements: compared.disagreements })); return;
  }
  if (command === 'adjudicate') {
    const pack = await json(file(directory, 'pack')); const a = await json(file(directory, 'reviewA')); const b = await json(file(directory, 'reviewB'));
    const expected = createExpertDisagreementPack(pack, a, b); const supplied = await json(file(directory, 'adjudication'));
    if (supplied.schemaVersion !== EXPERT_GOLD_SCHEMA_VERSION || supplied.qualificationAttested !== true
      || !Array.isArray(supplied.items) || supplied.items.length !== expected.items.length) throw new Error('Adjudication is incomplete or unattested');
    finalizeExpertGoldStudy(pack, await json(file(directory, 'key')), a, b, supplied);
    console.log(JSON.stringify({ ok: true, command, disagreements: expected.items.length })); return;
  }
  const { built } = await rebuild(inputPath, directory);
  const pack = await json(file(directory, 'pack')); const key = await json(file(directory, 'key'));
  verifyFrozenExpertGoldStudy(null, built, pack, key);
  const a = await json(file(directory, 'reviewA')); const b = await json(file(directory, 'reviewB'));
  const adjudication = await json(file(directory, 'adjudication'));
  const report = finalizeExpertGoldStudy(pack, key, a, b, adjudication);
  const sources = { input: sha256(await readFile(inputPath)), pack: sha256(await readFile(file(directory, 'pack'))),
    key: sha256(await readFile(file(directory, 'key'))), reviews: [sha256(await readFile(file(directory, 'reviewA'))),
      sha256(await readFile(file(directory, 'reviewB')))].sort(), adjudication: sha256(await readFile(file(directory, 'adjudication'))) };
  const holdoutCases = key.items.filter((item) => item.split === 'holdout').length;
  if (holdoutCases > 0) {
    await writeNew(file(directory, 'holdoutReceipt'), { schemaVersion: EXPERT_GOLD_SCHEMA_VERSION,
      openedAt: new Date().toISOString(), appVersion: pack.appVersion, packHash: key.packHash,
      holdoutCases, finalReportHash: sha256(JSON.stringify(report)) });
  }
  await writeNew(args.out ? outsideRepository(args.out, 'Final report') : file(directory, 'report'), { ...report, sourceHashes: sources });
  console.log(JSON.stringify({ ok: true, command, status: report.status, participants: report.appComparison.targetParticipantCount }));
}

main().catch((error) => { console.error(`[study:expert-gold] ${error.message}`); process.exitCode = 1; });
