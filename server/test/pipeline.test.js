import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Point the model store at a scratch model that this suite trains itself, so the tests do not
// depend on server/data/model.json existing in the working tree.
const dir = await mkdtemp(path.join(tmpdir(), 'aviator-test-'));
const datasetPath = path.join(dir, 'rounds.csv');
process.env.MODEL_PATH = path.join(dir, 'model.json');

const { train } = await import('../src/ml/train.js');
const { saveModel } = await import('../src/ml/modelStore.js');
const { predictFromHistory, toChronological, DISCLAIMER } = await import('../src/pipeline.js');
const { FEATURE_NAMES } = await import('../src/ml/features.js');
const { render } = await import('../scripts/make-sample-screenshot.js');
const { mockExtract } = await import('../src/vision/mock.js');
const { historyToChronological } = await import('../src/vision/schema.js');

let report;

before(async () => {
  // Deterministic crash-shaped history, written in the CSV schema the trainer expects.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const lines = ['round_id,timestamp,multiplier'];
  let cursor = Date.parse('2025-03-01T00:00:00.000Z');
  for (let i = 0; i < 600; i += 1) {
    const multiplier = Math.max(1, Math.min(500, 0.99 / (1 - Math.min(0.999999, rand())))).toFixed(2);
    lines.push(`${1000 + i},${new Date(cursor).toISOString()},${multiplier}`);
    cursor += 18000;
  }
  await writeFile(datasetPath, `${lines.join('\n')}\n`);
  // train() only builds the bundle; persisting is the caller's job (the CLI does the same).
  const { bundle, report: trainedReport } = await train({ data: datasetPath, out: process.env.MODEL_PATH, trees: 25, depth: 8 });
  await saveModel(bundle, process.env.MODEL_PATH);
  report = trainedReport;
});

test('training produced a report with baselines and skill scores', () => {
  assert.ok(report.regression, 'regression report missing');
  assert.ok(Number.isFinite(report.regression.skillVsBaseline));
  assert.ok(report.over2 && Number.isFinite(report.over2.auc), 'over2 head should be trained on this data');
  assert.ok(report.regression.topFeatures.length > 0);
});

test('predictFromHistory returns a full, finite prediction', async () => {
  const history = [1.2, 1.05, 3.4, 1.8, 12.5, 1.1, 2.2, 1.6, 1.9, 4.5, 1.3, 2.7, 1.4, 8.1, 1.7];
  const result = await predictFromHistory(history);

  assert.equal(result.ok, true, result.error);
  assert.equal(result.input.roundsUsed, history.length);
  assert.equal(result.input.lastRoundsMostRecentFirst[0], 1.7, 'newest round comes first in the echo');

  const p = result.prediction;
  for (const key of ['geometricMeanMultiplier', 'arithmeticMeanMultiplier', 'medianMultiplier', 'p90Multiplier']) {
    assert.ok(Number.isFinite(p[key]) && p[key] >= 1, `${key} must be a finite multiplier >= 1, got ${p[key]}`);
  }
  assert.ok(p.arithmeticMeanMultiplier >= p.geometricMeanMultiplier * 0.99,
    'arithmetic mean of a heavy-tailed target should sit at or above the geometric mean');
  assert.ok(p.interval.lowMultiplier <= p.interval.highMultiplier);
  assert.ok(p.p90Multiplier >= p.medianMultiplier);

  assert.equal(result.cashOutScenarios.length, 6);
  for (const s of result.cashOutScenarios) {
    assert.ok(s.probabilityOfReaching >= 0 && s.probabilityOfReaching <= 1);
    assert.ok(Number.isFinite(s.expectedReturnPerUnitStaked));
  }
  // Probability of reaching a higher target must never exceed a lower one.
  const probs = result.cashOutScenarios.map((s) => s.probabilityOfReaching);
  for (let i = 1; i < probs.length; i += 1) {
    assert.ok(probs[i] <= probs[i - 1] + 1e-9, 'survival function must be monotone decreasing');
  }

  assert.equal(Object.keys(result.featureVector).length, FEATURE_NAMES.length);
  assert.equal(result.disclaimer, DISCLAIMER);
});

test('the prediction is deterministic for the same history', async () => {
  const history = [2.1, 1.3, 1.05, 5.6, 1.9, 1.2, 3.3, 1.7, 1.4, 2.8, 1.1, 6.2, 1.5, 1.8];
  const a = await predictFromHistory(history);
  const b = await predictFromHistory(history);
  assert.equal(a.ok, true, a.error);
  assert.equal(b.ok, true, b.error);
  assert.deepEqual(a.prediction, b.prediction);
  assert.deepEqual(a.cashOutScenarios, b.cashOutScenarios);
});

test('a short history is rejected with an actionable message instead of a bad prediction', async () => {
  const result = await predictFromHistory([1.5, 2.0, 1.2]);
  assert.equal(result.ok, false);
  assert.match(result.error, /at least 12 past rounds/);
  assert.ok(result.hint.length > 0);
});

test('toChronological honours the declared order and drops unusable values', () => {
  assert.deepEqual(toChronological([5, 3, 1.2], 'most_recent_first'), [1.2, 3, 5]);
  assert.deepEqual(toChronological([1.2, 3, 5], 'oldest_first'), [1.2, 3, 5]);
  assert.deepEqual(toChronological([5, 0.4, 'x', 1.2], 'most_recent_first'), [1.2, 5]);
  assert.deepEqual(toChronological([{ multiplier: 2 }, { multiplier: 9 }], 'most_recent_first'), [9, 2]);
});

test('the image path produces the same prediction as the equivalent history payload', async () => {
  const { png, multipliers } = render({ rounds: 20, seed: 31 });
  const extraction = mockExtract(png.toString('base64'));
  const fromImage = await predictFromHistory(historyToChronological(extraction));
  const fromHistory = await predictFromHistory(multipliers);

  assert.equal(fromImage.ok, true, fromImage.error);
  assert.equal(fromImage.input.roundsObserved, 20);
  assert.deepEqual(fromImage.prediction, fromHistory.prediction,
    'vision output and the same history as JSON must agree exactly');
});

test('the verdict states plainly that a base-rate-matching model found no signal', async () => {
  const history = [1.2, 3.4, 1.05, 12.5, 1.8, 2.2, 1.1, 1.9, 4.5, 1.3, 2.7, 1.6, 8.1, 1.4, 2.0];
  const result = await predictFromHistory(history);
  assert.match(result.verdict, /skill|signal/i);
  assert.match(result.verdict, /expected return/i);
});
