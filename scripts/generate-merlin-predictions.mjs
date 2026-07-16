import { access, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildGrammar } from '../server/grammarCheck.js';
import { buildGrammarLLM } from '../server/grammarLLM.js';
import { mergeGrammarSources } from '../server/grammarProvenance.js';
import { buildIndex, merlinItemHash, parseCsv, sha256 } from './lib/merlin-benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'benchmarks', 'merlin-v1.2.manifest.json');
const ALLOWED_SYSTEMS = new Set(['languagetool', 'llm', 'all']);

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error(`Invalid argument near ${argv[i] || '<end>'}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

const integerArg = (value, fallback, name, min, max) => {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return parsed;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetries(label, operation, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const backoffMs = Math.min(30000, 2000 * (2 ** (attempt - 1)));
      console.error(`[benchmark:merlin:generate] ${label} transient failure; retry ${attempt}/${attempts - 1} after ${backoffMs}ms`);
      await wait(backoffMs);
    }
  }
  throw lastError;
}

async function existingKeys(output) {
  try {
    const lines = (await readFile(output, 'utf8')).split(/\r?\n/).filter(Boolean);
    const keys = new Set();
    for (const [index, line] of lines.entries()) {
      let value;
      try { value = JSON.parse(line); } catch { throw new Error(`Existing output has invalid JSON on line ${index + 1}`); }
      const fields = Object.keys(value).sort().join(',');
      if (fields !== 'correctionCount,itemHash,system') throw new Error(`Existing output has invalid fields on line ${index + 1}`);
      keys.add(`${value.system}|${value.itemHash}`);
    }
    return keys;
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  for (const required of ['metadata', 'texts', 'out', 'system', 'split']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  if (!ALLOWED_SYSTEMS.has(args.system)) throw new Error('Invalid --system; use languagetool, llm, or all');
  if (!['calibration', 'development'].includes(args.split)) throw new Error('Generation is limited to calibration/development; holdout remains locked');
  if ((args.system === 'llm' || args.system === 'all') && !process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured; refusing to manufacture LLM/merged predictions');
  }
  const limit = integerArg(args.limit, 25, 'limit', 1, 1000);
  const delayMs = integerArg(args['delay-ms'], 1500, 'delay-ms', 250, 60000);
  const output = path.resolve(args.out);
  if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error('Predictions must be written outside the application repository');

  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const metadataBuffer = await readFile(path.resolve(args.metadata));
  if (sha256(metadataBuffer) !== manifest.metadataSha256) throw new Error('Metadata hash does not match the frozen manifest');
  const rows = parseCsv(metadataBuffer.toString('utf8'));
  const items = buildIndex(rows, manifest);
  const selected = new Set(items.filter((item) => item.split === args.split).map((item) => item.itemHash));
  const candidates = rows
    .filter((row) => row._test_language === 'German')
    .map((row) => ({ authorId: row._author_id, itemHash: merlinItemHash(manifest.version, row._author_id) }))
    .filter((item) => selected.has(item.itemHash))
    .sort((a, b) => a.itemHash.localeCompare(b.itemHash));
  const done = await existingKeys(output);
  const requested = args.system === 'all' ? ['languagetool', 'llm', 'merged'] : [args.system];
  let processed = 0;

  for (const candidate of candidates) {
    if (processed >= limit) break;
    if (requested.every((system) => done.has(`${system}|${candidate.itemHash}`))) continue;
    const textPath = path.join(path.resolve(args.texts), `${candidate.authorId}.txt`);
    await access(textPath);
    const text = (await readFile(textPath, 'utf8')).trim();
    if (!text) throw new Error(`Empty corpus item for hash ${candidate.itemHash}`);
    const utterances = [{ text, words: text.split(/\s+/).filter(Boolean).length }];
    let languageTool = null;
    let llm = null;
    if (requested.includes('languagetool') || requested.includes('merged')) {
      languageTool = await withRetries('languagetool', () => buildGrammar(utterances));
    }
    if (requested.includes('llm') || requested.includes('merged')) llm = await buildGrammarLLM(utterances);
    if (requested.includes('llm') && !Array.isArray(llm)) throw new Error('LLM provider did not return a usable result; run stopped without writing a false prediction');
    if ((requested.includes('languagetool') || requested.includes('merged')) && !Array.isArray(languageTool)) {
      throw new Error('LanguageTool did not return a usable result; run stopped without writing a false prediction');
    }
    const merged = mergeGrammarSources({ languageTool, llm });
    const counts = {
      languagetool: Array.isArray(languageTool) ? languageTool.length : null,
      llm: Array.isArray(llm) ? llm.length : null,
      merged: merged.grammar.length,
    };
    for (const system of requested) {
      const key = `${system}|${candidate.itemHash}`;
      if (done.has(key)) continue;
      if (counts[system] == null) throw new Error(`${system} prediction is unavailable`);
      await appendFile(output, `${JSON.stringify({ itemHash: candidate.itemHash, system, correctionCount: counts[system] })}\n`, 'utf8');
      done.add(key);
    }
    processed += 1;
    if (processed < limit) await wait(delayMs);
  }
  console.log(JSON.stringify({ ok: true, split: args.split, requested, newlyProcessedItems: processed, output, rawLearnerDataWritten: false }));
}

main().catch((error) => {
  console.error(`[benchmark:merlin:generate] ${error.message}`);
  process.exitCode = 1;
});
