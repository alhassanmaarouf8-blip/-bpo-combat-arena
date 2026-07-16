import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, wilson } from './merlin-benchmark.mjs';

const GOLD_EXCLUDE = /PUNCT|SPELL|ORTH/iu;

export function parseM2(text) {
  const blocks = String(text).trim().split(/\r?\n\s*\r?\n/u);
  return blocks.map((block, index) => {
    const lines = block.split(/\r?\n/u);
    if (!lines[0]?.startsWith('S ')) throw new Error(`Malformed M2 sentence at block ${index + 1}`);
    const sentence = lines[0].slice(2).trim();
    const edits = [];
    for (const line of lines.slice(1)) {
      if (!line.startsWith('A ')) throw new Error(`Malformed M2 annotation at block ${index + 1}`);
      const [span, type, replacement] = line.slice(2).split('|||');
      const [start, end] = span.split(/\s+/u).map(Number);
      if (!Number.isInteger(start) || !Number.isInteger(end) || !type) throw new Error(`Malformed M2 edit at block ${index + 1}`);
      if (type === 'noop' || GOLD_EXCLUDE.test(type)) continue;
      edits.push({ start, end, replacement, type });
    }
    return { sentence, edits };
  });
}

export function sentenceEdit(before, after) {
  const source = String(before).trim().split(/\s+/u).filter(Boolean);
  const target = String(after).trim().split(/\s+/u).filter(Boolean);
  let start = 0;
  while (start < source.length && start < target.length && source[start] === target[start]) start += 1;
  let suffix = 0;
  while (suffix < source.length - start && suffix < target.length - start
    && source[source.length - 1 - suffix] === target[target.length - 1 - suffix]) suffix += 1;
  if (start === source.length && start === target.length) return null;
  return {
    start,
    end: source.length - suffix,
    replacement: target.slice(start, target.length - suffix).join(' '),
  };
}

function editKey(edit) {
  return `${edit.start}:${edit.end}:${edit.replacement}`;
}

function f05(precision, recall) {
  if (precision == null || recall == null || (0.25 * precision + recall) === 0) return null;
  return (1.25 * precision * recall) / (0.25 * precision + recall);
}

function metrics(records) {
  let gold = 0;
  let predicted = 0;
  let matched = 0;
  const byGoldType = {};
  const byRule = {};
  for (const record of records) {
    const goldKeys = new Set(record.gold.map(editKey));
    const predictedKeys = new Set(record.predicted.map(editKey));
    gold += goldKeys.size;
    predicted += predictedKeys.size;
    matched += [...predictedKeys].filter((key) => goldKeys.has(key)).length;
    for (const edit of record.gold) {
      byGoldType[edit.type] ||= { goldEdits: 0, exactMatches: 0 };
      byGoldType[edit.type].goldEdits += 1;
      if (predictedKeys.has(editKey(edit))) byGoldType[edit.type].exactMatches += 1;
    }
    for (const edit of record.predicted) {
      const ruleId = edit.ruleId || 'unknown';
      byRule[ruleId] ||= { predictedEdits: 0, exactMatches: 0 };
      byRule[ruleId].predictedEdits += 1;
      if (goldKeys.has(editKey(edit))) byRule[ruleId].exactMatches += 1;
    }
  }
  const precision = predicted ? matched / predicted : null;
  const recall = gold ? matched / gold : null;
  return {
    sentences: records.length,
    goldEdits: gold,
    predictedEdits: predicted,
    exactMatches: matched,
    exactReferencePrecision: precision,
    exactReferencePrecisionWilson95: wilson(matched, predicted),
    exactReferenceRecall: recall,
    exactReferenceRecallWilson95: wilson(matched, gold),
    exactReferenceF05: f05(precision, recall),
    byGoldType: Object.fromEntries(Object.entries(byGoldType).map(([type, counts]) => [type, {
      ...counts,
      exactReferenceRecall: counts.exactMatches / counts.goldEdits,
    }]).sort(([a], [b]) => a.localeCompare(b))),
    byRule: Object.fromEntries(Object.entries(byRule).map(([ruleId, counts]) => [ruleId, {
      ...counts,
      exactReferencePrecision: counts.exactMatches / counts.predictedEdits,
    }]).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function scoreGecPredictions(goldItems, predictionRows) {
  if (!Array.isArray(goldItems) || !goldItems.length) throw new Error('Gold items are required');
  const byId = new Map(goldItems.map((item) => [item.itemId, item]));
  const seen = new Set();
  const records = [];
  for (const row of predictionRows) {
    if (Object.keys(row || {}).sort().join(',') !== 'itemId,predicted,source') throw new Error('Prediction contains missing or unknown fields');
    if (!byId.has(row.itemId)) throw new Error(`Unknown GEC item: ${row.itemId}`);
    if (seen.has(row.itemId)) throw new Error(`Duplicate GEC prediction: ${row.itemId}`);
    if (!['falko', 'merlin'].includes(row.source) || row.source !== byId.get(row.itemId).source) throw new Error('Prediction source mismatch');
    if (!Array.isArray(row.predicted) || row.predicted.some((edit) => Object.keys(edit || {}).sort().join(',') !== 'end,replacement,ruleId,start'
      || !/^[\p{L}\p{N}_.:-]{1,120}$/u.test(edit.ruleId || ''))) {
      throw new Error('Malformed predicted edit list');
    }
    seen.add(row.itemId);
    records.push({ ...byId.get(row.itemId), predicted: row.predicted });
  }
  if (seen.size !== byId.size) throw new Error(`Incomplete GEC predictions: expected ${byId.size}, received ${seen.size}`);
  return {
    all: metrics(records),
    bySource: {
      falko: metrics(records.filter((record) => record.source === 'falko')),
      merlin: metrics(records.filter((record) => record.source === 'merlin')),
    },
    warning: 'Exact reference alignment is a conservative written-German metric. Unmatched predictions may be valid alternatives and require blinded adjudication before being called harmful.',
  };
}

export async function loadFrozenGecTest(dataDir, manifest) {
  const files = manifest?.test?.files || {};
  const buffers = {};
  for (const [relative, expectedHash] of Object.entries(files)) {
    const file = path.resolve(dataDir, relative);
    if (file !== path.resolve(dataDir) && !file.startsWith(`${path.resolve(dataDir)}${path.sep}`)) throw new Error('Dataset path escaped its root');
    const buffer = await readFile(file);
    if (sha256(buffer) !== expectedHash) throw new Error(`Frozen GEC hash mismatch: ${relative}`);
    buffers[relative] = buffer;
  }
  const sourceLines = buffers['fm-test.src'].toString('utf8').trimEnd().split(/\r?\n/u).map((line) => line.trim());
  const targetLines = buffers['fm-test.trg'].toString('utf8').trimEnd().split(/\r?\n/u).map((line) => line.trim());
  const gold = parseM2(buffers['fm-test.m2'].toString('utf8'));
  if (sourceLines.length !== manifest.test.sentences || targetLines.length !== sourceLines.length || gold.length !== sourceLines.length) {
    throw new Error('Frozen GEC sentence count mismatch');
  }
  const parseSourceRows = (relative) => buffers[relative].toString('utf8').trimEnd().split(/\r?\n/u).map((line, index) => {
    const columns = line.split('\t');
    if (columns.length !== 3) throw new Error(`Malformed frozen source map ${relative} at line ${index + 1}`);
    return { original: columns[1].trim(), target: columns[2].trim() };
  });
  const falkoRows = parseSourceRows('source/falko-id-ctok-zh1.txt.test');
  const merlinRows = parseSourceRows('source/merlin-id-ctok-zh1.txt.test');
  const falkoCount = falkoRows.length;
  const merlinCount = merlinRows.length;
  if (falkoCount !== manifest.test.falkoSentences || merlinCount !== manifest.test.merlinSentences || falkoCount + merlinCount !== sourceLines.length) {
    throw new Error('Frozen GEC source-slice count mismatch');
  }
  const sourceMap = [...falkoRows, ...merlinRows];
  return sourceLines.map((sentence, index) => {
    if (gold[index].sentence !== sentence || sourceMap[index].original !== sentence || sourceMap[index].target !== targetLines[index]) {
      throw new Error(`M2/source-map mismatch at sentence ${index + 1}`);
    }
    return {
      itemId: sha256(`falko-merlin-gec-test|${index}|${sentence}`).slice(0, 24),
      sentence,
      source: index < falkoCount ? 'falko' : 'merlin',
      gold: gold[index].edits.map(({ start, end, replacement, type }) => ({ start, end, replacement, type })),
    };
  });
}
