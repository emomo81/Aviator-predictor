import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

test('checked-in model was built from the checked-in raw multiplier dataset', async () => {
  const [dataset, modelText] = await Promise.all([
    readFile(path.join(repoRoot, 'multipliers.csv')),
    readFile(path.join(repoRoot, 'server/data/model.json'), 'utf8'),
  ]);
  const model = JSON.parse(modelText);
  const sha256 = createHash('sha256').update(dataset).digest('hex');

  assert.equal(model.dataset.path, 'multipliers.csv');
  assert.equal(model.dataset.sha256, sha256);
  assert.equal(model.dataset.rounds, 732_367);
  assert.equal(model.dataset.multiplierColumn, 'Multiplier');
  assert.equal(model.regression.trees.length, 60);
  assert.equal(model.over2.trees.length, 60);
  assert.equal(model.over10.trees.length, 60);
  assert.ok(Number.isFinite(model.report.regression.skillVsBaseline));
  assert.ok(Number.isFinite(model.report.over2.auc));
  assert.ok(Number.isFinite(model.report.over10.auc));
});
