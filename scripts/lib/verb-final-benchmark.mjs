import { createHash } from 'node:crypto';

export function alignDocumentIds(sentences, sourceRows, expectedSkipped) {
  if (!Array.isArray(sentences) || !Array.isArray(sourceRows)) throw new Error('Sentences and source rows are required');
  const aligned = [];
  const skipped = [];
  let rowIndex = 0;
  for (const sentence of sentences) {
    while (rowIndex < sourceRows.length && sourceRows[rowIndex].sentence !== sentence) {
      skipped.push(sourceRows[rowIndex]);
      rowIndex += 1;
      if (skipped.length > expectedSkipped) throw new Error('Frozen source-map alignment exceeded its skip allowance');
    }
    if (rowIndex >= sourceRows.length) throw new Error('Frozen source-map alignment was exhausted');
    aligned.push(sourceRows[rowIndex].documentId);
    rowIndex += 1;
  }
  while (rowIndex < sourceRows.length) {
    skipped.push(sourceRows[rowIndex]);
    rowIndex += 1;
  }
  if (skipped.length !== expectedSkipped || aligned.length !== sentences.length) {
    throw new Error('Frozen source-map alignment count mismatch');
  }
  return { documentIds: aligned, skippedRows: skipped.length };
}

export function isHoldoutDocument(documentId, seed, modulo) {
  if (typeof documentId !== 'string' || !documentId || typeof seed !== 'string' || !seed) throw new Error('Holdout identity is required');
  if (!Number.isInteger(modulo) || modulo < 2 || modulo > 20) throw new Error('Invalid holdout modulo');
  const prefix = createHash('sha256').update(`${seed}|${documentId}`).digest().readUInt32BE(0);
  return prefix % modulo === 0;
}

export function tokenDistance(left, right) {
  const a = String(left).trim().split(/\s+/u).filter(Boolean);
  const b = String(right).trim().split(/\s+/u).filter(Boolean);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

export function referenceDelta(source, target, candidate) {
  return tokenDistance(source, target) - tokenDistance(candidate, target);
}
