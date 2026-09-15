import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatures, buildRows, FEATURE_NAMES, MIN_HISTORY } from '../src/ml/features.js';
import { parseCsv, normaliseDataset } from '../src/ml/csv.js';

const HISTORY = [1.2, 3.4, 1.05, 12.5, 1.8, 2.2, 1.1, 1.9, 4.5, 1.3, 2.7, 1.6, 8.1, 1.4];

test('feature vector is aligned with FEATURE_NAMES and finite', () => {
  const vector = buildFeatures(HISTORY);
  assert.equal(vector.length, FEATURE_NAMES.length);
  assert.ok(vector.every((v) => Number.isFinite(v)), 'all features must be finite numbers');
  assert.equal(new Set(FEATURE_NAMES).size, FEATURE_NAMES.length, 'feature names must be unique');
});

test('features are deterministic and history-order sensitive', () => {
  const a = buildFeatures(HISTORY);
  const b = buildFeatures(HISTORY);
  assert.deepEqual(a, b);

  const reversed = buildFeatures(HISTORY.slice().reverse());
  assert.notDeepEqual(a, reversed, 'reversing history must change lag features');

  const lagIndex = FEATURE_NAMES.indexOf('lag1');
  assert.ok(Math.abs(a[lagIndex] - Math.log10(HISTORY[HISTORY.length - 1])) < 1e-9, 'lag1 must be the newest round');
});

test('streak features count consecutive rounds from the newest backwards', () => {
  const vector = buildFeatures([5, 5, 1.2, 1.5, 1.9]);
  const below = vector[FEATURE_NAMES.indexOf('streakBelow2')];
  const above = vector[FEATURE_NAMES.indexOf('streakAbove2')];
  assert.equal(below, 3);
  assert.equal(above, 0);
});

test('time features stay zero without a timestamp and populate with one', () => {
  const without = buildFeatures(HISTORY);
  assert.equal(without[FEATURE_NAMES.indexOf('hourSin')], 0);
  assert.equal(without[FEATURE_NAMES.indexOf('hourCos')], 0);

  const withTime = buildFeatures(HISTORY, { timestamp: '2025-06-01T18:00:00.000Z' });
  // 18:00 UTC => angle 270deg, so sin = -1 and cos = 0.
  assert.ok(Math.abs(withTime[FEATURE_NAMES.indexOf('hourSin')] + 1) < 1e-9, 'hourSin should be -1 at 18:00 UTC');
  assert.ok(Math.abs(withTime[FEATURE_NAMES.indexOf('hourCos')]) < 1e-9, 'hourCos should be 0 at 18:00 UTC');
  assert.equal(withTime[FEATURE_NAMES.indexOf('dowNorm')], 0 / 6, 'Sunday normalises to 0');
});

test('buildRows emits one row per predictable round and never leaks the target', () => {
  const rows = HISTORY.map((m) => ({ multiplier: m }));
  const { X, yReg, targets } = buildRows(rows);
  assert.equal(X.length, rows.length - MIN_HISTORY);
  assert.equal(yReg.length, X.length);
  // The first target must be the round immediately after the first window, i.e. index MIN_HISTORY.
  assert.equal(targets[0], rows[MIN_HISTORY].multiplier);
  assert.ok(X.every((v) => v.length === FEATURE_NAMES.length));
});

test('csv reader auto-detects column names and drops unusable rows', () => {
  const csv = ['id,created_at,crash_point', '1,2025-01-01T00:00:00Z,1.50', '2,2025-01-01T00:00:30Z,0.40', '3,2025-01-01T00:01:00Z,7.25'].join('\n');
  const { rounds, meta } = normaliseDataset(csv);
  assert.equal(meta.multiplierKey, 'crash_point');
  assert.equal(meta.timeKey, 'created_at');
  assert.equal(rounds.length, 2, 'the 0.40x row is below the 1.00x floor and must be dropped');
  assert.equal(meta.skippedRows, 1);
  assert.deepEqual(rounds.map((r) => r.multiplier), [1.5, 7.25]);
});

test('csv reader sorts chronologically when every row has a timestamp', () => {
  const csv = ['multiplier,timestamp', '9.00,2025-01-01T00:03:00Z', '2.00,2025-01-01T00:01:00Z', '3.00,2025-01-01T00:02:00Z'].join('\n');
  const { rounds, meta } = normaliseDataset(csv);
  assert.equal(meta.sortedByTimestamp, true);
  assert.deepEqual(rounds.map((r) => r.multiplier), [2, 3, 9]);
});

test('csv reader fails loudly when no multiplier column exists', () => {
  assert.throws(() => normaliseDataset('a,b\n1,2\n'), /Could not find a multiplier column/);
});

test('csv parser handles quoted fields containing commas', () => {
  const { rows } = parseCsv('name,multiplier\n"round, one",1.50\n');
  assert.equal(rows[0].name, 'round, one');
  assert.equal(rows[0].multiplier, '1.50');
});
