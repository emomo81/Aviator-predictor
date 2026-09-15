/** Model evaluation helpers. Every metric here has a matching naive baseline. */

export function mean(a) {
  if (!a.length) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

export function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)));
  return s[idx];
}

export function mae(actual, predicted) {
  let s = 0;
  for (let i = 0; i < actual.length; i += 1) s += Math.abs(actual[i] - predicted[i]);
  return s / actual.length;
}

export function rmse(actual, predicted) {
  let s = 0;
  for (let i = 0; i < actual.length; i += 1) s += (actual[i] - predicted[i]) ** 2;
  return Math.sqrt(s / actual.length);
}

export function r2(actual, predicted) {
  const m = mean(actual);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < actual.length; i += 1) {
    ssRes += (actual[i] - predicted[i]) ** 2;
    ssTot += (actual[i] - m) ** 2;
  }
  if (ssTot === 0) return 0;
  return 1 - ssRes / ssTot;
}

export function logLoss(labels, probas, nClasses = 2) {
  const eps = 1e-15;
  let s = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const p = Math.min(1 - eps, Math.max(eps, probas[i][labels[i]]));
    s -= Math.log(p);
  }
  return s / labels.length;
}

export function brier(labels, probas) {
  let s = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const p = probas[i][1] ?? probas[i][0];
    s += (p - labels[i]) ** 2;
  }
  return s / labels.length;
}

export function auc(labels, scores) {
  const pairs = labels.map((l, i) => ({ l, s: scores[i] })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let positives = 0;

  // A forest emits many identical leaf probabilities. Assign every tied score its average
  // rank; using array order to break ties can make an uninformative classifier look skilled.
  for (let start = 0; start < pairs.length;) {
    let end = start + 1;
    while (end < pairs.length && pairs[end].s === pairs[start].s) end += 1;
    const averageRank = ((start + 1) + end) / 2;
    for (let i = start; i < end; i += 1) {
      if (pairs[i].l === 1) {
        positives += 1;
        rankSum += averageRank;
      }
    }
    start = end;
  }

  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** Reliability table: predicted probability bucket vs observed frequency. */
export function reliability(labels, probas, bins = 10) {
  const buckets = Array.from({ length: bins }, (_, i) => ({
    from: i / bins,
    to: (i + 1) / bins,
    count: 0,
    predicted: 0,
    observed: 0,
  }));
  for (let i = 0; i < labels.length; i += 1) {
    const p = Math.min(0.9999, Math.max(0, probas[i][1] ?? 0));
    const b = buckets[Math.floor(p * bins)];
    b.count += 1;
    b.predicted += p;
    b.observed += labels[i];
  }
  return buckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      range: `${(b.from * 100).toFixed(0)}-${(b.to * 100).toFixed(0)}%`,
      count: b.count,
      predicted: b.predicted / b.count,
      observed: b.observed / b.count,
    }));
}

/**
 * Skill vs the naive baseline. 0 means "no better than always guessing the base rate",
 * negative means "worse". For a genuinely random process this should sit at ~0.
 */
export function skillScore(modelMetric, baselineMetric) {
  if (!Number.isFinite(modelMetric) || !Number.isFinite(baselineMetric) || baselineMetric === 0) return 0;
  return 1 - modelMetric / baselineMetric;
}

export function trainTestSplit(n, testFraction, seed) {
  const idx = Array.from({ length: n }, (_, i) => i);
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const cut = Math.floor(n * (1 - testFraction));
  return { train: idx.slice(0, cut).sort((x, y) => x - y), test: idx.slice(cut).sort((x, y) => x - y) };
}
