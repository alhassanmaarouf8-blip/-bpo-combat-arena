import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { detectL1Patterns } from '../server/scoring/l1Errors.js';
import { parseM2 } from './lib/gec-benchmark.mjs';
import { alignDocumentIds, isHoldoutDocument, referenceDelta } from './lib/verb-final-benchmark.mjs';
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

function lines(buffer) {
  return buffer.toString('utf8').trimEnd().split(/\r?\n/u).map((line) => line.trim());
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (!args.data) throw new Error('--data is required');
  const dataRoot = path.resolve(args.data);
  const manifestBuffer = await readFile(path.join(root, 'benchmarks', 'falko-merlin-gec-wnut2018.manifest.json'));
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  const config = manifest.training;
  const buffers = {};
  for (const [relative, expectedHash] of Object.entries(config.files)) {
    const file = path.resolve(dataRoot, relative);
    if (file !== dataRoot && !file.startsWith(`${dataRoot}${path.sep}`)) throw new Error('Dataset path escaped its root');
    const buffer = await readFile(file);
    if (sha256(buffer) !== expectedHash) throw new Error(`Frozen training hash mismatch: ${relative}`);
    buffers[relative] = buffer;
  }
  const source = lines(buffers['fm-train.src']);
  const target = lines(buffers['fm-train.trg']);
  const gold = parseM2(buffers['fm-train.m2'].toString('utf8'));
  if (source.length !== config.sentences || target.length !== source.length || gold.length !== source.length) {
    throw new Error('Frozen training sentence count mismatch');
  }
  const sourceRows = ['falko', 'merlin'].flatMap((name) => lines(buffers[`source/${name}-id-ctok-zh1.txt.train`]).map((line) => {
    const columns = line.split('\t');
    if (columns.length < 2 || columns.length > 3 || !columns[0]) throw new Error('Malformed frozen training source row');
    return { documentId: columns[0], sentence: (columns[1] || '').trim() };
  }));
  if (sourceRows.length !== config.sourceMapRows) throw new Error('Frozen training source-map count mismatch');
  const { documentIds, skippedRows } = alignDocumentIds(source, sourceRows, config.expectedUnalignedSourceMapRows);
  const holdoutIndexes = documentIds.map((documentId, index) => ({ documentId, index }))
    .filter(({ documentId }) => isHoldoutDocument(documentId, config.holdoutSeed, config.holdoutModulo));
  const holdoutDocuments = new Set(holdoutIndexes.map(({ documentId }) => documentId));
  if (holdoutIndexes.length !== config.holdoutSentences || holdoutDocuments.size !== config.holdoutDocuments) {
    throw new Error('Frozen holdout assignment mismatch');
  }

  let detectedSignals = 0;
  let rewriteCandidates = 0;
  let referenceSupported = 0;
  let referenceNeutral = 0;
  let referenceContradicted = 0;
  let goldWordOrderEdits = 0;
  for (const { index } of holdoutIndexes) {
    goldWordOrderEdits += gold[index].edits.filter((edit) => edit.type === 'R:WO').length;
    const pattern = detectL1Patterns([{ text: source[index] }]).find((item) => item.key === 'verb-final');
    if (!pattern) continue;
    detectedSignals += pattern.count;
    for (const example of pattern.examples) {
      if (!example.better) continue;
      const start = source[index].toLocaleLowerCase('de-DE').indexOf(example.quote.toLocaleLowerCase('de-DE'));
      if (start < 0) throw new Error('Detector quote is not grounded in the frozen sentence');
      const candidate = `${source[index].slice(0, start)}${example.better}${source[index].slice(start + example.quote.length)}`;
      const delta = referenceDelta(source[index], target[index], candidate);
      rewriteCandidates += 1;
      if (delta > 0) referenceSupported += 1;
      else if (delta === 0) referenceNeutral += 1;
      else referenceContradicted += 1;
    }
  }
  const report = {
    schemaVersion: 1,
    status: 'single-open-frozen-document-disjoint-holdout',
    manifestSha256: sha256(manifestBuffer),
    containsLearnerText: false,
    holdout: { documents: holdoutDocuments.size, sentences: holdoutIndexes.length, skippedSourceRows: skippedRows },
    evidence: { goldWordOrderEdits, detectedSignals, rewriteCandidates, referenceSupported, referenceNeutral, referenceContradicted },
    warning: 'A neutral or contradicted target-hypothesis distance is not automatically a harmful correction because human target hypotheses are not exhaustive. Such rewrites require blinded adjudication.',
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    const outputPath = path.resolve(args.out);
    if (outputPath === root || outputPath.startsWith(`${root}${path.sep}`)) throw new Error('Holdout detail must stay outside the repository');
    await writeFile(outputPath, output, { flag: 'wx' });
  } else process.stdout.write(output);
}

main().catch((error) => {
  console.error(`[benchmark:verb-final:holdout] ${error.message}`);
  process.exitCode = 1;
});
