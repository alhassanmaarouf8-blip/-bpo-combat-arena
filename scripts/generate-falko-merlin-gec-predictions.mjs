import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildGrammarForBenchmark } from '../server/grammarCheck.js';
import { loadFrozenGecTest, sentenceEdit } from './lib/gec-benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'benchmarks', 'falko-merlin-gec-wnut2018.manifest.json');

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error(`Invalid argument near ${argv[i] || '<end>'}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetries(operation, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await wait(Math.min(30000, 1500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function makeBatches(items, size) {
  const batches = [];
  let batch = [];
  let sentences = new Set();
  for (const item of items) {
    if (batch.length >= size || sentences.has(item.sentence)) {
      batches.push(batch);
      batch = [];
      sentences = new Set();
    }
    batch.push(item);
    sentences.add(item.sentence);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (!args.data || !args.out) throw new Error('--data and --out are required');
  const output = path.resolve(args.out);
  if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error('GEC predictions must stay outside the application repository');
  const delayMs = Number(args['delay-ms'] ?? 1500);
  const batchSize = Number(args['batch-size'] ?? 20);
  if (!Number.isInteger(delayMs) || delayMs < 250 || delayMs > 60000) throw new Error('--delay-ms must be an integer from 250 to 60000');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 30) throw new Error('--batch-size must be an integer from 1 to 30');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const items = await loadFrozenGecTest(path.resolve(args.data), manifest);
  const existing = new Map();
  try {
    for (const line of (await readFile(output, 'utf8')).split(/\r?\n/u).filter(Boolean)) {
      const row = JSON.parse(line);
      if (existing.has(row.itemId)) throw new Error(`Duplicate existing prediction: ${row.itemId}`);
      existing.set(row.itemId, row);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const expectedIds = new Set(items.map((item) => item.itemId));
  if ([...existing.keys()].some((itemId) => !expectedIds.has(itemId))) throw new Error('Existing prediction file belongs to a different frozen dataset');
  const pending = items.filter((item) => !existing.has(item.itemId));
  const batches = makeBatches(pending, batchSize);
  let completed = existing.size;

  for (const [batchIndex, batch] of batches.entries()) {
    const grammar = await withRetries(() => buildGrammarForBenchmark(batch.map((item) => ({
      text: item.sentence,
      words: item.sentence.split(/\s+/u).filter(Boolean).length,
    }))));
    const editsBySentence = new Map(batch.map((item) => [item.sentence, []]));
    for (const rule of grammar) {
      for (const example of rule.allExamples || []) {
        if (!editsBySentence.has(example.wrong)) throw new Error('Production checker returned an example outside its benchmark batch');
        const edit = sentenceEdit(example.wrong, example.right);
        if (edit) editsBySentence.get(example.wrong).push({ ...edit, ruleId: rule.ltRuleId || 'unknown' });
      }
    }
    const rows = batch.map((item) => {
      const unique = new Map(editsBySentence.get(item.sentence).map((edit) => [`${edit.start}:${edit.end}:${edit.replacement}`, edit]));
      return { itemId: item.itemId, source: item.source, predicted: [...unique.values()] };
    });
    await appendFile(output, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    completed += rows.length;
    process.stdout.write(`${JSON.stringify({ completed, total: items.length, batch: batchIndex + 1, batches: batches.length })}\n`);
    if (batchIndex < batches.length - 1) await wait(delayMs);
  }
}

main().catch((error) => {
  console.error(`[benchmark:gec:generate] ${error.message}`);
  process.exitCode = 1;
});
