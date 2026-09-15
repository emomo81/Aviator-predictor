/**
 * Dependency-free random forest.
 *
 * Design notes:
 *  - Split search walks a per-feature list of row indices that is kept *sorted* by that
 *    feature. A node only has to filter its parent's sorted list (O(n) per feature) instead
 *    of re-sorting at every node, which makes the whole fit O(p * n * depth) per tree rather
 *    than O(p * n log n * nodes). On a 3k x 32 dataset that is the difference between
 *    minutes and well under a second.
 *  - Cumulative sums along the sweep give the impurity of every candidate threshold in a
 *    single pass, so no candidate threshold needs to be re-scanned.
 *  - Out-of-bag rows give a held-out error estimate for free, and the OOB residual
 *    distribution is reused as a conformal-style prediction interval.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function giniOfCounts(counts, n) {
  if (n <= 0) return 0;
  let s = 0;
  for (const c of counts) s += (c / n) * (c / n);
  return 1 - s;
}

export class DecisionTree {
  constructor(options = {}) {
    this.task = options.task ?? 'regression';
    this.maxDepth = options.maxDepth ?? 10;
    this.minSamplesSplit = options.minSamplesSplit ?? 10;
    this.minSamplesLeaf = options.minSamplesLeaf ?? 5;
    this.maxFeatures = options.maxFeatures ?? null; // null => use every feature
    this.nClasses = options.nClasses ?? 2;
  }

  fit(X, y, rowIdx, random) {
    const nFeatures = X[0].length;
    this.nFeatures = nFeatures;
    this.random = random ?? mulberry32(1);
    this.importance = new Float64Array(nFeatures);
    this.impuritySum = 0;
    this.nRows = X.length;

    const sorted = [];
    for (let f = 0; f < nFeatures; f += 1) {
      const arr = rowIdx.slice();
      arr.sort((a, b) => X[a][f] - X[b][f]);
      sorted.push(arr);
    }

    this._marks = new Uint8Array(X.length);
    this.root = this._build(X, y, rowIdx.length, sorted, 0);
    this._marks = null;

    // Normalise importances to sum to 1 so they are comparable across runs.
    if (this.impuritySum > 0) {
      for (let f = 0; f < nFeatures; f += 1) this.importance[f] /= this.impuritySum;
    }
    return this;
  }

  _leaf(y, rows) {
    const n = rows.length;
    if (this.task === 'classification') {
      const counts = new Array(this.nClasses).fill(0);
      for (const r of rows) counts[y[r]] += 1;
      const proba = counts.map((c) => c / n);
      let argmax = 0;
      for (let k = 1; k < proba.length; k += 1) if (proba[k] > proba[argmax]) argmax = k;
      return { leaf: true, n, proba, value: argmax, gini: giniOfCounts(counts, n) };
    }
    let sum = 0;
    for (const r of rows) sum += y[r];
    return { leaf: true, n, value: sum / n, mean: sum / n };
  }

  _impurity(y, rows) {
    if (this.task === 'classification') {
      const counts = new Array(this.nClasses).fill(0);
      for (const r of rows) counts[y[r]] += 1;
      return giniOfCounts(counts, rows.length);
    }
    const n = rows.length;
    let sum = 0;
    let sumsq = 0;
    for (const r of rows) {
      sum += y[r];
      sumsq += y[r] * y[r];
    }
    return sumsq - (sum * sum) / n; // total SSE, not divided by n
  }

  /**
   * @param {Array<number[]>} X
   * @param {Array<number>} y
   * @param {number} n number of rows in this node
   * @param {Array<Array<number>>} sorted per-feature row indices sorted by feature value
   */
  _build(X, y, n, sorted, depth) {
    const rows0 = sorted[0];
    const parentImpurity = this._impurity(y, rows0);

    const stop =
      depth >= this.maxDepth ||
      n < this.minSamplesSplit ||
      parentImpurity <= 1e-12 ||
      (this.task === 'classification' && parentImpurity === 0);
    if (stop) return this._leaf(y, rows0);

    // Candidate feature subset (this is the "random" in random forest).
    let candidates;
    if (this.maxFeatures && this.maxFeatures < this.nFeatures) {
      const all = Array.from({ length: this.nFeatures }, (_, i) => i);
      for (let i = all.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      candidates = all.slice(0, this.maxFeatures);
    } else {
      candidates = Array.from({ length: this.nFeatures }, (_, i) => i);
    }

    let best = null;

    for (const f of candidates) {
      const order = sorted[f];
      if (this.task === 'classification') {
        const totalCounts = new Array(this.nClasses).fill(0);
        for (let i = 0; i < n; i += 1) totalCounts[y[order[i]]] += 1;
        const leftCounts = new Array(this.nClasses).fill(0);
        for (let i = 0; i < n - 1; i += 1) {
          leftCounts[y[order[i]]] += 1;
          const xHere = X[order[i]][f];
          const xNext = X[order[i + 1]][f];
          if (xHere === xNext) continue;
          const nL = i + 1;
          const nR = n - nL;
          if (nL < this.minSamplesLeaf || nR < this.minSamplesLeaf) continue;
          let cost = 0;
          for (let k = 0; k < this.nClasses; k += 1) {
            const pl = leftCounts[k] / nL;
            const pr = (totalCounts[k] - leftCounts[k]) / nR;
            cost += nL * pl * pl + nR * pr * pr;
          }
          // Maximising sum(n_k^2/n) is equivalent to minimising weighted Gini.
          if (!best || cost > best.score) {
            best = { f, i, score: cost, threshold: (xHere + xNext) / 2 };
          }
        }
      } else {
        let totalSum = 0;
        let totalSqsq = 0;
        for (let i = 0; i < n; i += 1) {
          const v = y[order[i]];
          totalSum += v;
          totalSqsq += v * v;
        }
        let sumL = 0;
        let sqL = 0;
        for (let i = 0; i < n - 1; i += 1) {
          const v = y[order[i]];
          sumL += v;
          sqL += v * v;
          const xHere = X[order[i]][f];
          const xNext = X[order[i + 1]][f];
          if (xHere === xNext) continue;
          const nL = i + 1;
          const nR = n - nL;
          if (nL < this.minSamplesLeaf || nR < this.minSamplesLeaf) continue;
          const sseL = sqL - (sumL * sumL) / nL;
          const sumR = totalSum - sumL;
          const sqR = totalSqsq - sqL;
          const sseR = sqR - (sumR * sumR) / nR;
          const reduction = parentImpurity - (sseL + sseR);
          if (!best || reduction > best.score) {
            best = { f, i, score: reduction, threshold: (xHere + xNext) / 2 };
          }
        }
      }
    }

    if (!best || best.score <= 1e-12) return this._leaf(y, rows0);

    // Split: partition every feature's sorted list using a membership stamp.
    const parentOrder = sorted[best.f];
    const marks = this._marks;
    const leftRows = parentOrder.slice(0, best.i + 1);
    for (const r of leftRows) marks[r] = 1;

    const childSorted = [];
    for (let f = 0; f < this.nFeatures; f += 1) {
      const src = sorted[f];
      const l = [];
      const r = [];
      for (let i = 0; i < src.length; i += 1) {
        if (marks[src[i]] === 1) l.push(src[i]);
        else r.push(src[i]);
      }
      childSorted.push([l, r]);
    }
    for (const r of leftRows) marks[r] = 0;

    this.importance[best.f] += best.score * (n / this.nRows);
    this.impuritySum += best.score * (n / this.nRows);

    const leftSorted = childSorted.map((p) => p[0]);
    const rightSorted = childSorted.map((p) => p[1]);

    return {
      leaf: false,
      feature: best.f,
      threshold: best.threshold,
      left: this._build(X, y, leftRows.length, leftSorted, depth + 1),
      right: this._build(X, y, n - leftRows.length, rightSorted, depth + 1),
    };
  }

  predictOne(x) {
    let node = this.root;
    while (node && !node.leaf) node = x[node.feature] <= node.threshold ? node.left : node.right;
    return node ? (this.task === 'classification' ? node.proba : node.value) : null;
  }

  toJSON() {
    return {
      task: this.task,
      nFeatures: this.nFeatures,
      nClasses: this.nClasses,
      importance: Array.from(this.importance ?? []),
      root: this.root,
    };
  }

  static fromJSON(json) {
    const tree = new DecisionTree({ task: json.task, nClasses: json.nClasses });
    tree.root = json.root;
    tree.nFeatures = json.nFeatures;
    tree.nClasses = json.nClasses ?? 2;
    tree.importance = json.importance ?? [];
    return tree;
  }
}

export class RandomForest {
  constructor(options = {}) {
    this.task = options.task ?? 'regression';
    this.nTrees = options.nTrees ?? 100;
    this.maxDepth = options.maxDepth ?? 10;
    this.minSamplesSplit = options.minSamplesSplit ?? 10;
    this.minSamplesLeaf = options.minSamplesLeaf ?? 5;
    this.maxFeatures = options.maxFeatures ?? null;
    this.seed = options.seed ?? 42;
    this.trees = [];
  }

  fit(X, y) {
    const n = X.length;
    const p = X[0].length;
    const random = mulberry32(this.seed);

    if (this.task === 'classification') {
      let max = 0;
      for (const v of y) if (v > max) max = v;
      this.nClasses = max + 1;
    } else {
      this.nClasses = 0;
    }
    this.maxFeaturesResolved = this.maxFeatures ?? Math.max(2, Math.round(Math.sqrt(p)));

    const oobSum = new Float64Array(n);
    const oobCount = new Int32Array(n);
    const oobProba = this.task === 'classification' ? Array.from({ length: n }, () => new Float64Array(this.nClasses)) : null;

    this.trees = [];
    const inBag = new Uint8Array(n);

    for (let t = 0; t < this.nTrees; t += 1) {
      inBag.fill(0);
      const rows = new Array(n);
      for (let i = 0; i < n; i += 1) {
        const j = Math.floor(random() * n);
        rows[i] = j;
        inBag[j] = 1;
      }

      const tree = new DecisionTree({
        task: this.task,
        maxDepth: this.maxDepth,
        minSamplesSplit: this.minSamplesSplit,
        minSamplesLeaf: this.minSamplesLeaf,
        maxFeatures: this.maxFeaturesResolved,
        nClasses: this.nClasses,
      }).fit(X, y, rows, random);

      this.trees.push(tree);

      for (let i = 0; i < n; i += 1) {
        if (inBag[i] === 1) continue;
        const pred = tree.predictOne(X[i]);
        if (this.task === 'classification') {
          for (let k = 0; k < this.nClasses; k += 1) oobProba[i][k] += pred[k];
        } else {
          oobSum[i] += pred;
        }
        oobCount[i] += 1;
      }
    }

    // Out-of-bag predictions, used for the report and for prediction intervals.
    this.oobResiduals = [];
    this.oobPredictions = new Array(n).fill(null);
    for (let i = 0; i < n; i += 1) {
      if (oobCount[i] === 0) continue;
      if (this.task === 'classification') {
        const total = oobProba[i].reduce((a, b) => a + b, 0) || 1;
        this.oobPredictions[i] = Array.from(oobProba[i], (v) => v / total);
      } else {
        const pred = oobSum[i] / oobCount[i];
        this.oobPredictions[i] = pred;
        this.oobResiduals.push(y[i] - pred);
      }
    }
    if (this.task !== 'classification') {
      this.oobResiduals.sort((a, b) => a - b);
    }

    this.featureImportance = new Array(p).fill(0);
    for (const tree of this.trees) {
      for (let f = 0; f < p; f += 1) this.featureImportance[f] += tree.importance[f] ?? 0;
    }
    for (let f = 0; f < p; f += 1) this.featureImportance[f] /= this.trees.length;

    return this;
  }

  predictOne(x) {
    if (this.task === 'classification') {
      const acc = new Array(this.nClasses).fill(0);
      for (const tree of this.trees) {
        const proba = tree.predictOne(x);
        for (let k = 0; k < this.nClasses; k += 1) acc[k] += proba[k];
      }
      const total = acc.reduce((a, b) => a + b, 0) || 1;
      return acc.map((v) => v / total);
    }
    let sum = 0;
    for (const tree of this.trees) sum += tree.predictOne(x);
    return sum / this.trees.length;
  }

  /** Per-tree point predictions, used to show the spread of the ensemble. */
  predictEach(x) {
    return this.trees.map((tree) => {
      const pred = tree.predictOne(x);
      return this.task === 'classification' ? pred : pred;
    });
  }

  /**
   * Prediction interval from the empirical OOB residual distribution.
   * This is a split-free conformal-style interval: it reports the error the model
   * actually made on held-out rows instead of pretending the uncertainty is small.
   */
  interval(x, alpha = 0.2) {
    if (this.task === 'classification') return null;
    const point = this.predictOne(x);
    const res = this.oobResiduals ?? [];
    if (res.length < 20) return { point, low: point, high: point };
    const q = (p) => {
      const idx = Math.min(res.length - 1, Math.max(0, Math.floor(p * res.length)));
      return res[idx];
    };
    return { point, low: point + q(alpha / 2), high: point + q(1 - alpha / 2) };
  }

  toJSON() {
    return {
      task: this.task,
      nTrees: this.nTrees,
      nClasses: this.nClasses,
      maxFeaturesResolved: this.maxFeaturesResolved,
      featureImportance: this.featureImportance,
      oobResiduals: this.task === 'classification' ? [] : this.oobResiduals,
      trees: this.trees.map((t) => t.toJSON()),
    };
  }

  static fromJSON(json) {
    const forest = new RandomForest({ task: json.task, nTrees: json.nTrees });
    forest.nClasses = json.nClasses ?? 0;
    forest.featureImportance = json.featureImportance ?? [];
    forest.oobResiduals = json.oobResiduals ?? [];
    forest.trees = (json.trees ?? []).map((t) => DecisionTree.fromJSON(t));
    return forest;
  }
}
