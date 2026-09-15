import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auc } from '../src/ml/metrics.js';
import { capIndices } from '../src/ml/train.js';

test('AUC gives tied scores average ranks instead of depending on row order', () => {
  const labels = [0, 0, 1, 1];
  assert.equal(auc(labels, [0.5, 0.5, 0.5, 0.5]), 0.5);
  assert.equal(auc(labels.slice().reverse(), [0.5, 0.5, 0.5, 0.5]), 0.5);
});

test('AUC recognises perfect and reversed rankings', () => {
  const labels = [0, 1, 0, 1];
  assert.equal(auc(labels, [0.1, 0.9, 0.2, 0.8]), 1);
  assert.equal(auc(labels, [0.9, 0.1, 0.8, 0.2]), 0);
});

test('training-row caps sample the complete partition deterministically', () => {
  const indices = Array.from({ length: 101 }, (_, i) => i);
  const sampled = capIndices(indices, 5);
  assert.deepEqual(sampled, [0, 25, 50, 75, 100]);
  assert.deepEqual(capIndices(indices, 0), indices, 'zero means no cap');
  assert.deepEqual(capIndices(indices, 200), indices, 'a cap above the row count keeps every row');
});
