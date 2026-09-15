#!/usr/bin/env node
/**
 * Train the ensemble and write data/model.json.
 *
 *   node server/src/ml/train.js --data server/data/dataset.csv --trees 80
 *
 * Every metric is reported next to a naive baseline, plus a "skill" number that is 0 when
 * the model is no better than always guessing the base rate. That number is the honest
 * answer to "did the model find anything".
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RandomForest } from './forest.js';
import { buildRows, FEATURE_NAMES } from './features.js';
import { normaliseDataset } from './csv.js';
import { saveModel, MODEL_PATH } from './modelStore.js';
import {
  mean, mae, rmse, r2, logLoss, auc, brier, reliability, skillScore, trainTestSplit, quantile,
} from './metrics.js';

function parseArgs(argv) {
  const args = {
    data: 'server/data/dataset.csv',
    out: MODEL_PATH,
    trees: 80,
    depth: 10,
    minLeaf: 8,
    testFraction: 0.2,
    seed: 42,
    split: 'chronological',
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
      case '--permutation-check': args.permutationCheck = true; break;
      case '--help': case '-h': args.help = true; break;
      default: break;
    }
  }
  return args;
}

const pick = (X, idx) => idx.map((i) => X[i]);
const pickY = (y, idx) => idx.map((i) => y[i]);

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
  const { rounds, meta } = normaliseDataset(text);

  if (rounds.length < 50) {
    throw new Error(`Dataset only has ${rounds.length} usable rounds. Need at least 50 (more is better).`);
  }

  const { X, yReg, yOver2, yOver10, targets } = buildRows(rounds);
  if (X.length < 50) {
    throw new Error(`Only ${X.length} training rows after windowing. Need at least 50.`);
  }

  const split = args.split === 'random'
    ? trainTestSplit(X.length, args.testFraction, args.seed)
    : (() => {
        const cut = Math.floor(X.length * (1 - args.testFraction));
        const all = Array.from({ length: X.length }, (_, i) => i);
        return { train: all.slice(0, cut), test: all.slice(cut) };
      })();

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
    trainRows: split.train.length,
    testRows: split.test.length,
    splitStrategy: args.split,
    meanMultiplier: Number(mean(targets).toFixed(4)),
    medianMultiplier: Number(targets.slice().sort((a, b) => a - b)[Math.floor(targets.length / 2)].toFixed(4)),
    maxMultiplier: Math.max(...targets),
    shareOver2: Number(mean(yOver2).toFixed(4)),
    shareOver10: Number(mean(yOver10).toFixed(4)),
    columns: meta.columns,
    multiplierColumn: meta.multiplierKey,
    timeColumn: meta.timeKey,
  };

  // --- regression head: log10(next multiplier) ---
  const regression = new RandomForest({ ...config, task: 'regression' });
  regression.fit(pick(X, split.train), pickY(yReg, split.train));
  const regPred = split.test.map((i) => regression.predictOne(X[i]));
  const reportRegression = regressionReport(pickY(yReg, split.train), pickY(yReg, split.test), regPred, mean(pickY(yReg, split.train)));
  reportRegression.topFeatures = topFeatures(regression.featureImportance, FEATURE_NAMES);

  // --- classifier heads: P(next >= 2x), P(next >= 10x) ---
  const heads = {};
  const reports = {};
  for (const [name, y] of [['over2', yOver2], ['over10', yOver10]]) {
    const trainY = pickY(y, split.train);
    const positives = trainY.reduce((a, b) => a + b, 0);
    if (positives === 0 || positives === trainY.length) {
      reports[name] = { skipped: `target is constant (positive rate ${positives}/${trainY.length})` };
      heads[name] = null;
      continue;
    }
    const forest = new RandomForest({ ...config, task: 'classification' });
    forest.fit(pick(X, split.train), trainY);
    const probas = split.test.map((i) => forest.predictOne(X[i]));
    reports[name] = classificationReport(trainY, pickY(y, split.test), probas);
    reports[name].topFeatures = topFeatures(forest.featureImportance, FEATURE_NAMES);
    heads[name] = forest;
  }

  // --- optional permutation sanity check ---
  let permutation = null;
  if (args.permutationCheck) {
    const shuffled = pickY(yReg, split.train).slice();
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
    small.fit(pick(X, split.train), shuffled);
    const pred = split.test.map((i) => small.predictOne(X[i]));
    const rep = regressionReport(shuffled, pickY(yReg, split.test), pred, mean(shuffled));
    permutation = {
      note: 'Targets shuffled, so there is provably no signal. A correctly wired evaluator reports skill ~0 here.',
      skillVsBaseline: Number(rep.skillVsBaseline.toFixed(4)),
      maeLog: Number(rep.maeLog.toFixed(4)),
    };
  }

  const bundle = {
    schemaVersion: 1,
    trainedAt: new Date().toISOString(),
    dataset: { path: dataPath, ...datasetStats },
    config,
    featureNames: FEATURE_NAMES,
    baseline: {
      meanLog: mean(pickY(yReg, split.train)),
      rateOver2: mean(pickY(yOver2, split.train)),
      rateOver10: mean(pickY(yOver10, split.train)),
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
  console.log(`Dataset      ${path.relative(process.cwd(), dataset.path) || dataset.path}`);
  console.log(`             ${dataset.rounds} rounds -> ${dataset.rows} windowed rows `
    + `(${dataset.trainRows} train / ${dataset.testRows} test, ${dataset.splitStrategy})`);
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
    console.log('Usage: node server/src/ml/train.js [--data path] [--trees n] [--depth n] [--split chronological|random] [--permutation-check]');
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
