#!/usr/bin/env node
/**
 * Train the ensemble and write data/model.json.
 *
 *   npm --prefix server run train
 *   node server/src/ml/train.js --data multipliers.csv --trees 80
 *
 * Every metric is reported next to a naive baseline, plus a "skill" number that is 0 when
 * the model is no better than always guessing the base rate. That number is the honest
 * answer to "did the model find anything".
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { RandomForest } from './forest.js';
import { buildRows, FEATURE_NAMES } from './features.js';
import { normaliseDataset } from './csv.js';
import { saveModel, MODEL_PATH } from './modelStore.js';
import {
  mean, mae, rmse, r2, logLoss, auc, brier, reliability, skillScore, trainTestSplit, quantile,
} from './metrics.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
export const DEFAULT_DATASET_PATH = path.join(REPO_ROOT, 'multipliers.csv');

function parseLimit(value, flag) {
  if (String(value).toLowerCase() === 'all') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer or "all", got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    // The repository's raw chronological sequence is the safe source for inference-time
    // features. aviator_dataset_clean.csv contains same-round derived columns (including a
    // target-derived colour), so training directly on those columns would leak the answer.
    data: process.env.DATASET_PATH ?? DEFAULT_DATASET_PATH,
    out: MODEL_PATH,
    trees: 60,
    depth: 9,
    minLeaf: 64,
    testFraction: 0.2,
    seed: 42,
    split: 'chronological',
    // A forest does not need all 585k overlapping windows to estimate this distribution.
    // Sample evenly across each chronological partition so the complete time span contributes
    // while keeping `npm run train` practical on a laptop. Pass "all" to disable either cap.
    maxTrainRows: 50_000,
    maxTestRows: 50_000,
    permutationCheck: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    switch (key) {
      case '--data': args.data = next; i += 1; break;
      case '--out': args.out = next; i += 1; break;
      case '--trees': args.nTrees = Number(next); args.trees = Number(next); i += 1; break;
      case '--depth': args.depth = Number(next); i += 1; break;
      case '--min-leaf': args.minLeaf = Number(next); i += 1; break;
      case '--test-fraction': args.testFraction = Number(next); i += 1; break;
      case '--seed': args.seed = Number(next); i += 1; break;
      case '--split': args.split = next; i += 1; break;
      case '--max-train-rows': args.maxTrainRows = parseLimit(next, key); i += 1; break;
      case '--max-test-rows': args.maxTestRows = parseLimit(next, key); i += 1; break;
      case '--permutation-check': args.permutationCheck = true; break;
      case '--help': case '-h': args.help = true; break;
      default: break;
    }
  }
  return args;
}

const pick = (X, idx) => idx.map((i) => X[i]);
const pickY = (y, idx) => idx.map((i) => y[i]);

/** Keep a deterministic, evenly spaced sample without changing chronological order. */
export function capIndices(indices, limit) {
  if (!limit || indices.length <= limit) return indices.slice();
  if (limit === 1) return [indices[indices.length - 1]];
  const sampled = new Array(limit);
  for (let i = 0; i < limit; i += 1) {
    sampled[i] = indices[Math.floor((i * (indices.length - 1)) / (limit - 1))];
  }
  return sampled;
}

function regressionReport(trainY, testY, predicted, baselineValue) {
  const baselinePred = new Array(testY.length).fill(baselineValue);
  const modelMae = mae(testY, predicted);
  const baseMae = mae(testY, baselinePred);
  return {
    n: testY.length,
    maeLog: modelMae,
    rmseLog: rmse(testY, predicted),
    r2: r2(testY, predicted),
    baselineMaeLog: baseMae,
    skillVsBaseline: skillScore(modelMae, baseMae),
    // expressed in multiplier space so it is readable
    maeMultiplier: mae(testY.map((v) => 10 ** v), predicted.map((v) => 10 ** v)),
    baselineMaeMultiplier: mae(testY.map((v) => 10 ** v), baselinePred.map((v) => 10 ** v)),
    // The head predicts the mean of log10(X), which is a *geometric* mean. For a heavy-tailed
    // target the arithmetic mean sits well above it, so measure the gap on held-out rows and
    // ship the correction factor instead of silently under-reporting the expected value.
    arithmeticCorrectionFactor: (() => {
      const actualMean = mean(testY.map((v) => 10 ** v));
      const predictedMean = mean(predicted.map((v) => 10 ** v));
      return predictedMean > 0 ? Number((actualMean / predictedMean).toFixed(4)) : 1;
    })(),
  };
}

function classificationReport(trainY, testY, probas) {
  const baseRate = mean(trainY);
  const labels = testY;
  const scores = probas.map((p) => p[1] ?? 0);
  const modelLogLoss = logLoss(labels, probas);
  const baselineLogLoss = logLoss(labels, labels.map(() => [1 - baseRate, baseRate]));
  return {
    n: testY.length,
    baseRate,
    accuracy: labels.filter((l, i) => (scores[i] >= 0.5 ? 1 : 0) === l).length / labels.length,
    logLoss: modelLogLoss,
    baselineLogLoss,
    skillVsBaseline: skillScore(modelLogLoss, baselineLogLoss),
    auc: auc(labels, scores),
    brier: brier(labels, probas),
    reliability: reliability(labels, probas),
  };
}

function topFeatures(importance, names, k = 10) {
  return importance
    .map((value, i) => ({ name: names[i], importance: value }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, k);
}

export async function train(options = {}) {
  const args = { ...parseArgs([]), ...options };
  const started = Date.now();
  const dataPath = path.resolve(args.data);
  const text = await readFile(dataPath, 'utf8');
  const datasetSha256 = createHash('sha256').update(text).digest('hex');
  const { rounds, meta } = normaliseDataset(text);

  if (!['chronological', 'random'].includes(args.split)) {
    throw new Error(`--split must be chronological or random, got "${args.split}"`);
  }
  if (!(args.testFraction > 0 && args.testFraction < 1)) {
    throw new Error(`--test-fraction must be between 0 and 1, got "${args.testFraction}"`);
  }
  if (rounds.length < 50) {
    throw new Error(`Dataset only has ${rounds.length} usable rounds. Need at least 50 (more is better).`);
  }

  const { X, yReg, yOver2, yOver10, targets } = buildRows(rounds);
  if (X.length < 50) {
    throw new Error(`Only ${X.length} training rows after windowing. Need at least 50.`);
  }

  const availableSplit = args.split === 'random'
    ? trainTestSplit(X.length, args.testFraction, args.seed)
    : (() => {
        const cut = Math.floor(X.length * (1 - args.testFraction));
        const all = Array.from({ length: X.length }, (_, i) => i);
        return { train: all.slice(0, cut), test: all.slice(cut) };
      })();
  const split = {
    train: capIndices(availableSplit.train, Number(args.maxTrainRows)),
    test: capIndices(availableSplit.test, Number(args.maxTestRows)),
  };
  if (split.train.length < 50 || split.test.length < 10) {
    throw new Error(`Sampling left ${split.train.length} train and ${split.test.length} test rows; need at least 50 and 10.`);
  }

  // Materialise each sampled partition once and reuse it for all three model heads.
  const trainX = pick(X, split.train);
  const testX = pick(X, split.test);
  const trainReg = pickY(yReg, split.train);
  const testReg = pickY(yReg, split.test);
  const trainOver2 = pickY(yOver2, split.train);
  const testOver2 = pickY(yOver2, split.test);
  const trainOver10 = pickY(yOver10, split.train);
  const testOver10 = pickY(yOver10, split.test);

  const config = {
    nTrees: args.trees,
    maxDepth: args.depth,
    minSamplesLeaf: args.minLeaf,
    minSamplesSplit: Math.max(4, args.minLeaf * 2),
    seed: args.seed,
  };

  const datasetStats = {
    rounds: rounds.length,
    rows: X.length,
    trainRowsAvailable: availableSplit.train.length,
    testRowsAvailable: availableSplit.test.length,
    trainRows: split.train.length,
    testRows: split.test.length,
    sampled: split.train.length < availableSplit.train.length || split.test.length < availableSplit.test.length,
    splitStrategy: args.split,
    bytes: Buffer.byteLength(text),
    sha256: datasetSha256,
    meanMultiplier: Number(mean(targets).toFixed(4)),
    medianMultiplier: Number(targets.slice().sort((a, b) => a - b)[Math.floor(targets.length / 2)].toFixed(4)),
    maxMultiplier: targets.reduce((max, value) => (value > max ? value : max), -Infinity),
    shareOver2: Number(mean(yOver2).toFixed(4)),
    shareOver10: Number(mean(yOver10).toFixed(4)),
    columns: meta.columns,
    multiplierColumn: meta.multiplierKey,
    timeColumn: meta.timeKey,
  };

  // --- regression head: log10(next multiplier) ---
  const regression = new RandomForest({ ...config, task: 'regression' });
  regression.fit(trainX, trainReg);
  const regPred = testX.map((row) => regression.predictOne(row));
  const reportRegression = regressionReport(trainReg, testReg, regPred, mean(trainReg));
  reportRegression.topFeatures = topFeatures(regression.featureImportance, FEATURE_NAMES);

  // --- classifier heads: P(next >= 2x), P(next >= 10x) ---
  const heads = {};
  const reports = {};
  for (const [name, trainY, testY] of [
    ['over2', trainOver2, testOver2],
    ['over10', trainOver10, testOver10],
  ]) {
    const positives = trainY.reduce((a, b) => a + b, 0);
    if (positives === 0 || positives === trainY.length) {
      reports[name] = { skipped: `target is constant (positive rate ${positives}/${trainY.length})` };
      heads[name] = null;
      continue;
    }
    const forest = new RandomForest({ ...config, task: 'classification' });
    forest.fit(trainX, trainY);
    const probas = testX.map((row) => forest.predictOne(row));
    reports[name] = classificationReport(trainY, testY, probas);
    reports[name].topFeatures = topFeatures(forest.featureImportance, FEATURE_NAMES);
    heads[name] = forest;
  }

  // --- optional permutation sanity check ---
  let permutation = null;
  if (args.permutationCheck) {
    const shuffled = trainReg.slice();
    let a = args.seed >>> 0;
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const small = new RandomForest({ ...config, nTrees: Math.min(30, config.nTrees), task: 'regression' });
    small.fit(trainX, shuffled);
    const pred = testX.map((row) => small.predictOne(row));
    const rep = regressionReport(shuffled, testReg, pred, mean(shuffled));
    permutation = {
      note: 'Targets shuffled, so there is provably no signal. A correctly wired evaluator reports skill ~0 here.',
      skillVsBaseline: Number(rep.skillVsBaseline.toFixed(4)),
      maeLog: Number(rep.maeLog.toFixed(4)),
    };
  }

  const bundle = {
    schemaVersion: 1,
    trainedAt: new Date().toISOString(),
    dataset: { path: path.relative(REPO_ROOT, dataPath) || path.basename(dataPath), ...datasetStats },
    config: {
      ...config,
      testFraction: args.testFraction,
      split: args.split,
      maxTrainRows: args.maxTrainRows,
      maxTestRows: args.maxTestRows,
    },
    featureNames: FEATURE_NAMES,
    baseline: {
      meanLog: mean(trainReg),
      rateOver2: mean(trainOver2),
      rateOver10: mean(trainOver10),
    },
    report: {
      regression: reportRegression,
      over2: reports.over2,
      over10: reports.over10,
      permutation,
      durationMs: Date.now() - started,
    },
    regression: regression.toJSON(),
    over2: heads.over2 ? heads.over2.toJSON() : null,
    over10: heads.over10 ? heads.over10.toJSON() : null,
  };

  return { bundle, report: bundle.report, dataset: bundle.dataset };
}

function printReport({ report, dataset }) {
  const line = '-'.repeat(74);
  console.log(line);
  console.log(`Dataset      ${dataset.path}`);
  console.log(`             ${dataset.rounds} rounds -> ${dataset.rows} windowed rows `
    + `(${dataset.trainRows} train / ${dataset.testRows} test, ${dataset.splitStrategy})`);
  if (dataset.sampled) {
    console.log(`             sampled from ${dataset.trainRowsAvailable} train / ${dataset.testRowsAvailable} test candidates`);
  }
  console.log(`             sha256 ${dataset.sha256}`);
  console.log(`             mean ${dataset.meanMultiplier}x  median ${dataset.medianMultiplier}x  `
    + `max ${dataset.maxMultiplier}x  P(>=2x)=${dataset.shareOver2}  P(>=10x)=${dataset.shareOver10}`);
  console.log(line);
  const r = report.regression;
  console.log('Regression head  target = log10(next multiplier)');
  console.log(`  test MAE      ${r.maeLog.toFixed(4)} log10   (${r.maeMultiplier.toFixed(3)}x in multiplier space)`);
  console.log(`  baseline MAE  ${r.baselineMaeLog.toFixed(4)} log10   (${r.baselineMaeMultiplier.toFixed(3)}x)`);
  console.log(`  R^2           ${r.r2.toFixed(4)}`);
  console.log(`  skill vs base ${r.skillVsBaseline.toFixed(4)}   <- 0 means no better than the base rate`);
  for (const name of ['over2', 'over10']) {
    const c = report[name];
    if (!c || c.skipped) {
      console.log(`\nClassifier ${name}: skipped (${c?.skipped ?? 'no target'})`);
      continue;
    }
    console.log(`\nClassifier ${name}   target = next multiplier >= ${name === 'over2' ? '2.00' : '10.00'}x`);
    console.log(`  base rate     ${c.baseRate.toFixed(4)}`);
    console.log(`  log-loss      ${c.logLoss.toFixed(4)}   (baseline ${c.baselineLogLoss.toFixed(4)})`);
    console.log(`  skill vs base ${c.skillVsBaseline.toFixed(4)}`);
    console.log(`  AUC           ${c.auc.toFixed(4)}   (0.5 = coin flip)`);
  }
  if (report.permutation) {
    console.log(`\nPermutation check (shuffled targets): skill ${report.permutation.skillVsBaseline.toFixed(4)} - expected ~0`);
  }
  console.log(line);
  const top = report.regression.topFeatures.slice(0, 6).map((f) => `${f.name} ${(f.importance * 100).toFixed(1)}%`);
  console.log(`Top features   ${top.join('  ')}`);
  const bestSkill = Math.max(
    r.skillVsBaseline,
    report.over2?.skillVsBaseline ?? -Infinity,
    report.over10?.skillVsBaseline ?? -Infinity,
  );
  const bestAucEdge = Math.max(
    Math.abs((report.over2?.auc ?? 0.5) - 0.5),
    Math.abs((report.over10?.auc ?? 0.5) - 0.5),
  );
  const signalFound = bestSkill >= 0.005 || bestAucEdge >= 0.03;
  console.log(
    signalFound
      ? `\nVERDICT: the model beats the base rate (skill ${bestSkill.toFixed(3)}, AUC edge ${bestAucEdge.toFixed(3)}).\n`
        + '         There is structure in this dataset. Check for leakage before believing it.'
      : '\nVERDICT: no exploitable signal. The model only matches the base rate (AUC ~0.50).\n'
        + '         For a provably-fair RNG game that is the expected and correct result.',
  );
  console.log(line);
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node server/src/ml/train.js [--data path] [--trees n] [--depth n] [--split chronological|random] [--max-train-rows n|all] [--max-test-rows n|all] [--permutation-check]');
    process.exit(0);
  }
  const started = Date.now();
  train(args)
    .then(async ({ bundle, report, dataset }) => {
      const written = await saveModel(bundle, args.out);
      printReport({ report, dataset });
      console.log(`Wrote ${path.relative(process.cwd(), written)} in ${Date.now() - started} ms`);
    })
    .catch((error) => {
      console.error(`Training failed: ${error.message}`);
      process.exit(1);
    });
}
