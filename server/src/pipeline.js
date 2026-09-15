/**
 * The prediction pipeline: history (from a screenshot or a payload) -> features -> ensemble.
 *
 * Kept free of HTTP concerns so it can be unit tested directly.
 */
import { loadModel } from './ml/modelStore.js';
import { buildFeatures, FEATURE_NAMES, clampLog, HISTORY_LEN, MIN_HISTORY } from './ml/features.js';
import { mean, quantile } from './ml/metrics.js';

const CASH_OUT_TARGETS = [1.5, 2, 3, 5, 10, 20];
const SAMPLES = 4000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Accept most-recent-first (the UI strip / Gemini output) and return chronological order. */
export function toChronological(history, order = 'most_recent_first') {
  const values = (Array.isArray(history) ? history : [])
    .map((item) => (typeof item === 'number' ? item : Number(item?.multiplier)))
    .filter((v) => Number.isFinite(v) && v >= 1);
  return order === 'oldest_first' ? values : values.slice().reverse();
}

/**
 * @param {number[]} chronological oldest -> newest
 * @returns {Promise<object>}
 */
export async function predictFromHistory(chronological, options = {}) {
  const bundle = await loadModel();
  if (!bundle.loaded) {
    return { ok: false, error: bundle.reason, hint: 'Train the model first: npm run generate:dataset && npm run train' };
  }

  const observed = chronological.length;
  if (observed < MIN_HISTORY) {
    return {
      ok: false,
      error: `Need at least ${MIN_HISTORY} past rounds to build a feature vector, got ${observed}.`,
      hint: 'Upload a screenshot showing the full history strip, or pass more rounds in `history`.',
    };
  }

  const windowed = chronological.slice(-HISTORY_LEN);
  const features = buildFeatures(windowed, { timestamp: options.timestamp ?? Date.now() });

  const regression = bundle.regression;
  if (!regression) return { ok: false, error: 'Trained model has no regression head.' };

  const logPrediction = regression.predictOne(features);
  const geometricMean = 10 ** logPrediction;
  const correction = bundle.report?.regression?.arithmeticCorrectionFactor ?? 1;
  const arithmeticMean = geometricMean * correction;

  const raw = regression.interval(features, 0.2);
  const interval = {
    confidence: 0.8,
    lowMultiplier: Number((10 ** raw.low).toFixed(2)),
    highMultiplier: Number((10 ** raw.high).toFixed(2)),
    note: 'Derived from out-of-bag residuals. For a heavy-tailed target the upper bound is wide on purpose.',
  };

  const perTree = regression.predictEach(features).map((v) => 10 ** v).sort((a, b) => a - b);

  // Predictive distribution: point prediction + empirical OOB residual draws.
  const residuals = regression.oobResiduals?.length >= 20 ? regression.oobResiduals : [0];
  const seed = features.reduce((acc, v, i) => (acc + Math.round(v * 1000) * (i + 7)) >>> 0, 1);
  const random = mulberry32(seed);
  const draws = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    const r = residuals[Math.floor(random() * residuals.length)];
    draws[i] = 10 ** (logPrediction + r);
  }

  const baseline = bundle.baseline ?? {};
  const scenarios = CASH_OUT_TARGETS.map((target) => {
    const hits = draws.filter((d) => d >= target).length;
    const probability = hits / draws.length;
    const baseRate = target >= 10 ? baseline.rateOver10 : target >= 2 ? baseline.rateOver2 : null;
    return {
      cashOutAt: target,
      probabilityOfReaching: Number(probability.toFixed(4)),
      baselineProbability: baseRate == null ? null : Number(baseRate.toFixed(4)),
      expectedReturnPerUnitStaked: Number((target * probability - 1).toFixed(4)),
    };
  });

  const heads = {};
  for (const [name, threshold] of [['over2', 2], ['over10', 10]]) {
    const forest = bundle[name];
    const report = bundle.report?.[name];
    if (!forest || !report || report.skipped) {
      heads[name] = { threshold, skipped: true };
      continue;
    }
    const proba = forest.predictOne(features);
    heads[name] = {
      threshold,
      probability: Number((proba[1] ?? 0).toFixed(4)),
      baselineProbability: Number((report.baseRate ?? 0).toFixed(4)),
      lift: Number(((proba[1] ?? 0) - (report.baseRate ?? 0)).toFixed(4)),
      heldOutAuc: Number((report.auc ?? 0).toFixed(4)),
      topFeatures: (report.topFeatures ?? []).slice(0, 5),
    };
  }

  const skill = Math.max(
    bundle.report?.regression?.skillVsBaseline ?? 0,
    bundle.report?.over2?.skillVsBaseline ?? 0,
    bundle.report?.over10?.skillVsBaseline ?? 0,
  );

  return {
    ok: true,
    input: {
      roundsObserved: observed,
      roundsUsed: windowed.length,
      lastRoundsMostRecentFirst: windowed.slice().reverse().slice(0, 10),
      currentMultiplier: options.currentMultiplier ?? null,
    },
    prediction: {
      geometricMeanMultiplier: Number(geometricMean.toFixed(3)),
      arithmeticMeanMultiplier: Number(arithmeticMean.toFixed(3)),
      medianMultiplier: Number(quantile(draws, 0.5).toFixed(3)),
      p90Multiplier: Number(quantile(draws, 0.9).toFixed(3)),
      interval,
      ensembleSpread: {
        min: Number(perTree[0].toFixed(3)),
        p25: Number(perTree[Math.floor(perTree.length * 0.25)].toFixed(3)),
        p75: Number(perTree[Math.floor(perTree.length * 0.75)].toFixed(3)),
        max: Number(perTree[perTree.length - 1].toFixed(3)),
      },
    },
    cashOutScenarios: scenarios,
    classifierHeads: heads,
    model: {
      trainedAt: bundle.trainedAt,
      dataset: bundle.dataset,
      heldOutSkillVsBaseline: Number(skill.toFixed(4)),
      topFeatures: (bundle.report?.regression?.topFeatures ?? []).slice(0, 8),
      featureCount: FEATURE_NAMES.length,
    },
    featureVector: Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, Number(features[i].toFixed(6))])),
    verdict: buildVerdict(skill, scenarios, observed),
    disclaimer: DISCLAIMER,
  };
}

export const DISCLAIMER =
  'Crash-style rounds are produced by a provably-fair random number generator: each round is '
  + 'independent of the ones before it, so no model can predict the next multiplier. These numbers '
  + 'are a description of the history you supplied, not a forecast. Do not stake money on them.';

function buildVerdict(skill, scenarios, observed) {
  const bestEv = Math.max(...scenarios.map((s) => s.expectedReturnPerUnitStaked));
  const parts = [];
  if (skill < 0.02) {
    parts.push(
      `Held-out skill vs the base rate is ${skill.toFixed(3)} - the model found no exploitable signal in the training data.`,
    );
  } else {
    parts.push(`Held-out skill vs the base rate is ${skill.toFixed(3)}. Check for leakage before trusting it.`);
  }
  parts.push(
    bestEv < 0
      ? `Best expected return across cash-out targets is ${bestEv.toFixed(3)} per unit staked - negative at every target, which is the house edge showing up exactly as it should.`
      : `Best expected return is ${bestEv.toFixed(3)} per unit staked, which is almost certainly noise.`,
  );
  parts.push(`Based on ${observed} observed rounds.`);
  return parts.join(' ');
}

export { clampLog };
