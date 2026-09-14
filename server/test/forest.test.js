import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RandomForest, mulberry32 } from '../src/ml/forest.js';

test('random forest learns a non-linear classification boundary', () => {
  const rand = mulberry32(7);
  const X = [];
  const y = [];
  for (let i = 0; i < 1200; i += 1) {
    const a = rand();
    const b = rand();
    X.push([a, b, rand() * 10 - 5]); // third feature is pure noise
    y.push(a * a + b > 1 ? 1 : 0);
  }
  const forest = new RandomForest({ task: 'classification', nTrees: 40, maxDepth: 8, minSamplesLeaf: 5, seed: 3 });
  forest.fit(X, y);

  const correct = X.filter((_, i) => {
    const p = forest.predictOne(X[i]);
    return (p[1] >= 0.5 ? 1 : 0) === y[i];
  }).length;
  const accuracy = correct / X.length;
  assert.ok(accuracy > 0.9, `expected in-sample accuracy > 0.9, got ${accuracy}`);

  // The noise feature must not dominate importance.
  assert.ok(forest.featureImportance[2] < 0.34, `noise feature importance too high: ${forest.featureImportance[2]}`);
  assert.ok(forest.oobPredictions.filter(Boolean).length > 1000, 'expected OOB coverage on most rows');
});

test('random forest fits a smooth regression target', () => {
  const rand = mulberry32(11);
  const X = [];
  const y = [];
  for (let i = 0; i < 1000; i += 1) {
    const a = rand() * 4 - 2;
    const b = rand() * 4 - 2;
    X.push([a, b]);
    y.push(3 * a - 2 * b + (rand() - 0.5) * 0.1);
  }
  const forest = new RandomForest({ task: 'regression', nTrees: 50, maxDepth: 12, minSamplesLeaf: 2, seed: 5 });
  forest.fit(X, y);

  const probe = [0.5, -0.5];
  const expected = 3 * probe[0] - 2 * probe[1];
  const got = forest.predictOne(probe);
  assert.ok(Math.abs(got - expected) < 0.35, `expected ~${expected}, got ${got}`);

  const interval = forest.interval(probe, 0.2);
  assert.ok(interval.low <= interval.point && interval.point <= interval.high, 'interval must bracket the point');
  assert.ok(forest.oobResiduals.length > 500, 'expected OOB residuals');
});

test('forest survives JSON round-trip with identical predictions', () => {
  const rand = mulberry32(21);
  const X = Array.from({ length: 300 }, () => [rand(), rand() * 5]);
  const y = X.map(([a, b]) => (a > 0.5 && b > 2.5 ? 1 : 0));
  const forest = new RandomForest({ task: 'classification', nTrees: 12, maxDepth: 6, minSamplesLeaf: 4, seed: 9 }).fit(X, y);

  const revived = RandomForest.fromJSON(JSON.parse(JSON.stringify(forest.toJSON())));
  for (const row of X.slice(0, 40)) {
    assert.deepEqual(forest.predictOne(row), revived.predictOne(row));
  }
});
