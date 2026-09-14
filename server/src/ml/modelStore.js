/** Loads/saves the trained ensemble and exposes it to the request handlers. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { RandomForest } from './forest.js';
import { FEATURE_NAMES } from './features.js';

export const MODEL_PATH = process.env.MODEL_PATH
  ? path.resolve(process.env.MODEL_PATH)
  : path.resolve(import.meta.dirname, '../../data/model.json');

let cached = null;
let cachedMtime = 0;

export function emptyBundle(reason) {
  return { loaded: false, reason: reason ?? 'no model file', trainedAt: null, report: null };
}

export async function loadModel(force = false) {
  try {
    const stat = await readFile(MODEL_PATH, 'utf8');
    const bundle = JSON.parse(stat);
    const mtime = bundle.trainedAt ?? 0;
    if (!force && cached && cachedMtime === mtime) return cached;

    cached = {
      loaded: true,
      trainedAt: bundle.trainedAt,
      dataset: bundle.dataset ?? null,
      report: bundle.report ?? null,
      featureNames: bundle.featureNames ?? FEATURE_NAMES,
      config: bundle.config ?? {},
      regression: bundle.regression ? RandomForest.fromJSON(bundle.regression) : null,
      over2: bundle.over2 ? RandomForest.fromJSON(bundle.over2) : null,
      over10: bundle.over10 ? RandomForest.fromJSON(bundle.over10) : null,
      baseline: bundle.baseline ?? null,
    };
    cachedMtime = mtime;
    return cached;
  } catch (error) {
    cached = null;
    cachedMtime = 0;
    return emptyBundle(error.code === 'ENOENT' ? `no trained model at ${MODEL_PATH} - run \`npm run train\`` : error.message);
  }
}

export async function saveModel(bundle, outPath = MODEL_PATH) {
  const target = path.resolve(outPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(bundle));
  cached = null;
  cachedMtime = 0;
  return target;
}

/** Human-readable summary used by GET /api/model and the training report. */
export function describeModel(bundle) {
  if (!bundle?.loaded) return { loaded: false, reason: bundle?.reason };
  const topFeatures = (bundle.report?.regression?.topFeatures ?? [])
    .map((f) => `${f.name} (${(f.importance * 100).toFixed(1)}%)`)
    .join(', ');
  return {
    loaded: true,
    trainedAt: bundle.trainedAt,
    dataset: bundle.dataset,
    config: bundle.config,
    report: bundle.report,
    topFeatures,
    featureCount: bundle.featureNames.length,
  };
}
