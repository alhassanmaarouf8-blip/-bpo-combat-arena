import test from 'node:test';
import assert from 'node:assert/strict';
import { alignDocumentIds, isHoldoutDocument, referenceDelta, tokenDistance } from '../scripts/lib/verb-final-benchmark.mjs';

test('document alignment allows only the frozen number of source-map omissions', () => {
  const rows = [
    { documentId: 'a', sentence: 'eins' },
    { documentId: 'x', sentence: 'omitted' },
    { documentId: 'b', sentence: 'zwei' },
  ];
  assert.deepEqual(alignDocumentIds(['eins', 'zwei'], rows, 1), { documentIds: ['a', 'b'], skippedRows: 1 });
  assert.throws(() => alignDocumentIds(['eins', 'zwei'], rows, 0), /skip allowance/);
});

test('holdout assignment is deterministic and document-bound', () => {
  assert.equal(isHoldoutDocument('same-document', 'seed', 5), isHoldoutDocument('same-document', 'seed', 5));
  assert.throws(() => isHoldoutDocument('', 'seed', 5), /identity/);
  assert.throws(() => isHoldoutDocument('doc', 'seed', 1), /modulo/);
});

test('token distance and target-reference delta measure whether a rewrite moves toward TH1', () => {
  assert.equal(tokenDistance('weil ich habe Zeit', 'weil ich Zeit habe'), 2);
  assert.equal(referenceDelta('weil ich habe Zeit', 'weil ich Zeit habe', 'weil ich Zeit habe'), 2);
  assert.ok(referenceDelta('weil ich habe Zeit', 'weil ich Zeit habe', 'weil Zeit ich habe') < 2);
});
