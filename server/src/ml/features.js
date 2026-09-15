/**
 * Feature engineering.
 *
 * One code path is shared by training and inference: training slices the CSV history into
 * windows, inference uses the history Gemini read off a screenshot. Both go through
 * buildFeatures(), so the vectors are guaranteed to line up.
 */

export const HISTORY_LEN = 40;
export const MIN_HISTORY = 12;

export const FEATURE_NAMES = [
  'lag1', 'lag2', 'lag3', 'lag4', 'lag5',
  'mean5', 'std5', 'max5', 'min5',
  'mean10', 'std10', 'max10', 'min10',
  'mean30', 'std30', 'max30', 'min30',
  'rate2_10', 'rate2_30', 'rate10_30',
  'streakBelow2', 'streakAbove2', 'roundsSince10x',
  'devFromMean10', 'diffVol10', 'drift10', 'logRange10',
  'nObserved',
  'hourSin', 'hourCos', 'dowNorm',
];

export function clampLog(multiplier) {
  return Math.log10(Math.min(1000, Math.max(1, Number(multiplier) || 1)));
}

function mean(a) {
  if (!a.length) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / (a.length - 1));
}

function streakFromEnd(values, predicate) {
  let count = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (!predicate(values[i])) break;
    count += 1;
  }
  return count;
}

/**
 * @param {number[]} history chronological multipliers, oldest first
 * @param {{timestamp?: string|number|Date, observedCount?: number}} meta
 * @returns {number[]} vector aligned with FEATURE_NAMES
 */
export function buildFeatures(history, meta = {}) {
  const raw = (history ?? []).map((m) => Math.max(1, Number(m) || 1));
  // Keep feature and target transforms on the same robust scale. A handful of extreme
  // multipliers (the repository data reaches 658,072x) must not dominate rolling statistics.
  const l = raw.map(clampLog);
  const n = l.length;
  const last = n ? l[n - 1] : 0;

  const win = (k) => l.slice(Math.max(0, n - k));
  const w5 = win(5);
  const w10 = win(10);
  const w30 = win(30);

  const rateOver = (windowValues, threshold) =>
    windowValues.length ? windowValues.filter((v) => v >= threshold).length / windowValues.length : 0;

  let roundsSince10x = w30.length;
  for (let i = raw.length - 1, back = 0; i >= 0; i -= 1, back += 1) {
    if (raw[i] >= 10) {
      roundsSince10x = back;
      break;
    }
  }

  const diffs = [];
  for (let i = 1; i < w10.length; i += 1) diffs.push(w10[i] - w10[i - 1]);

  let hourSin = 0;
  let hourCos = 0;
  let dowNorm = 0;
  if (meta.timestamp) {
    const d = new Date(meta.timestamp);
    if (!Number.isNaN(d.getTime())) {
      const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
      hourSin = Math.sin((2 * Math.PI * hours) / 24);
      hourCos = Math.cos((2 * Math.PI * hours) / 24);
      dowNorm = d.getUTCDay() / 6;
    }
  }

  const values = {
    lag1: n > 0 ? l[n - 1] : 0,
    lag2: n > 1 ? l[n - 2] : 0,
    lag3: n > 2 ? l[n - 3] : 0,
    lag4: n > 3 ? l[n - 4] : 0,
    lag5: n > 4 ? l[n - 5] : 0,
    mean5: mean(w5), std5: std(w5), max5: w5.length ? Math.max(...w5) : 0, min5: w5.length ? Math.min(...w5) : 0,
    mean10: mean(w10), std10: std(w10), max10: w10.length ? Math.max(...w10) : 0, min10: w10.length ? Math.min(...w10) : 0,
    mean30: mean(w30), std30: std(w30), max30: w30.length ? Math.max(...w30) : 0, min30: w30.length ? Math.min(...w30) : 0,
    rate2_10: rateOver(w10, Math.log10(2)),
    rate2_30: rateOver(w30, Math.log10(2)),
    rate10_30: rateOver(w30, Math.log10(10)),
    streakBelow2: streakFromEnd(raw, (v) => v < 2),
    streakAbove2: streakFromEnd(raw, (v) => v >= 2),
    roundsSince10x,
    devFromMean10: last - mean(w10),
    diffVol10: std(diffs),
    drift10: w10.length > 1 ? w10[w10.length - 1] - w10[0] : 0,
    logRange10: w10.length ? Math.max(...w10) - Math.min(...w10) : 0,
    nObserved: Math.min(n, HISTORY_LEN),
    hourSin,
    hourCos,
    dowNorm,
  };

  return FEATURE_NAMES.map((name) => {
    const v = values[name];
    return Number.isFinite(v) ? v : 0;
  });
}

/**
 * Slide a window over a chronological round list and emit (features, targets) rows.
 * @param {{multiplier:number, timestamp?:string}[]} rows oldest first
 */
export function buildRows(rows, options = {}) {
  const minHistory = options.minHistory ?? MIN_HISTORY;
  const X = [];
  const yReg = [];
  const yOver2 = [];
  const yOver10 = [];
  const targets = [];

  for (let i = minHistory - 1; i < rows.length - 1; i += 1) {
    const windowStart = Math.max(0, i - HISTORY_LEN + 1);
    const history = rows.slice(windowStart, i + 1).map((r) => r.multiplier);
    const next = rows[i + 1];
    X.push(buildFeatures(history, { timestamp: rows[i].timestamp }));
    yReg.push(clampLog(next.multiplier));
    yOver2.push(next.multiplier >= 2 ? 1 : 0);
    yOver10.push(next.multiplier >= 10 ? 1 : 0);
    targets.push(next.multiplier);
  }

  return { X, yReg, yOver2, yOver10, targets };
}
