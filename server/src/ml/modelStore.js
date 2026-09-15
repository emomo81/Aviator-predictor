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
let memoryBundle = null; // set by bootstrapModel when the model comes from a URL / Supabase / boot-train

export function emptyBundle(reason) {
  return { loaded: false, reason: reason ?? 'no model file', trainedAt: null, report: null };
}

export function setMemoryBundle(bundle) {
  memoryBundle = bundle;
  cached = null;
  cachedMtime = 0;
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
    if (memoryBundle) return memoryBundle;
    return emptyBundle(error.code === 'ENOENT' ? `no trained model at ${MODEL_PATH} - run \`npm run train\`` : error.message);
  }
}

function revive(bundle) {
  return {
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
}

/**
 * Make the API self-sufficient on an ephemeral host (Render). Called once at startup. Order:
 *   1. local model.json already present -> nothing to do
 *   2. MODEL_URL -> download model.json and hold it in memory
 *   3. SUPABASE_URL + SUPABASE_KEY -> read model.json from the "models" storage bucket
 *   4. the repo's multipliers.csv -> train in memory at boot
 * Each source is optional; without any of them the API still runs and reports "no model".
 */
export async function bootstrapModel() {
  const onDisk = await loadModel();
  if (onDisk.loaded) return { source: 'file', ...describeModel(onDisk) };

  if (process.env.MODEL_URL) {
    const res = await fetch(process.env.MODEL_URL);
    if (!res.ok) throw new Error(`MODEL_URL returned ${res.status}`);
    const bundle = await res.json();
    setMemoryBundle(revive(bundle));
    return { source: 'MODEL_URL', ...describeModel(memoryBundle) };
  }

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${process.env.SUPABASE_MODEL_BUCKET ?? 'models'}/${process.env.SUPABASE_MODEL_PATH ?? 'model.json'}`;
    const res = await fetch(url, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase storage returned ${res.status} for ${url}`);
    const bundle = await res.json();
    setMemoryBundle(revive(bundle));
    return { source: 'supabase', ...describeModel(memoryBundle) };
  }

  // Same default dataset the trainer uses (see DEFAULT_DATASET_PATH in train.js): the raw
  // chronological multipliers.csv at the repo root.
  const datasetPath = process.env.DATASET_PATH
    ? path.resolve(process.env.DATASET_PATH)
    : path.resolve(import.meta.dirname, '../../..', 'multipliers.csv');
  try {
    await readFile(datasetPath, 'utf8');
  } catch {
    return { source: 'none', loaded: false, reason: 'no model.json, MODEL_URL, SUPABASE_* or multipliers.csv available at boot' };
  }
  const { train } = await import('./train.js');
  const { bundle } = await train({ data: datasetPath, trees: 40, depth: 8 });
  setMemoryBundle(revive(bundle));
  return { source: 'boot-train', ...describeModel(memoryBundle) };
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
