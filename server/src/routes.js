import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractFromImage, visionConfig } from './vision/gemini.js';
import { historyToChronological } from './vision/schema.js';
import { predictFromHistory, toChronological } from './pipeline.js';
import { loadModel, describeModel } from './ml/modelStore.js';
import { normaliseDataset } from './ml/csv.js';

const router = Router();

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
// The checked-in raw chronological dataset - the same file the model trains from
// (see DEFAULT_DATASET_PATH in ml/train.js). server/data/dataset.csv does not exist.
const DEFAULT_DATASET_FILE = path.join(REPO_ROOT, 'multipliers.csv');

/** Accepts { image: "data:...;base64,..." } | { image: "<base64>" } | raw image bytes. */
function readImage(req) {
  if (Buffer.isBuffer(req.body) && req.body.length) return { image: req.body, mimeType: req.get('content-type') };
  if (req.body && typeof req.body === 'object' && req.body.image) {
    return { image: req.body.image, mimeType: req.body.mimeType };
  }
  const error = new Error('Provide an image as a JSON { image: "<data URL or base64>" } body, or POST raw image bytes.');
  error.status = 400;
  throw error;
}

router.get('/health', async (_req, res) => {
  const vision = visionConfig();
  const model = await loadModel();
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    vision: {
      provider: vision.mock ? 'mock' : 'gemini',
      models: vision.models,
      mock: vision.mock,
      reason: vision.mock ? (vision.apiKey ? 'VISION_MOCK=true' : 'GEMINI_API_KEY not set') : null,
    },
    model: {
      loaded: model.loaded,
      trainedAt: model.trainedAt ?? null,
      reason: model.reason ?? null,
      datasetRounds: model.dataset?.rounds ?? null,
    },
  });
});

router.get('/model', async (_req, res) => {
  const model = await loadModel();
  res.json(describeModel(model));
});

router.post('/model/reload', async (_req, res) => {
  const model = await loadModel(true);
  res.json(describeModel(model));
});

/** Screenshot -> structured round history (Gemini, or the offline mock). */
router.post('/analyze', async (req, res) => {
  const { image, mimeType } = readImage(req);
  const { extraction, meta } = await extractFromImage(image, { mimeType, currentMultiplier: req.body?.currentMultiplier });
  res.json({ ok: true, extraction, meta });
});

/**
 * The full path. Give it an image and it runs vision first, or give it history directly.
 * POST /api/predict  { image }
 * POST /api/predict  { history: [2.1, 1.3, ...], historyOrder: "most_recent_first" }
 */
router.post('/predict', async (req, res) => {
  const body = req.body && !Buffer.isBuffer(req.body) ? req.body : {};
  let extraction = null;
  let meta = null;
  let chronological;

  if (body.image || (Buffer.isBuffer(req.body) && req.body.length)) {
    const { image, mimeType } = readImage(req);
    const result = await extractFromImage(image, { mimeType, currentMultiplier: body.currentMultiplier });
    extraction = result.extraction;
    meta = result.meta;
    const fromVision = historyToChronological(extraction);
    const extra = toChronological(body.history, body.historyOrder ?? 'most_recent_first');
    // Vision output is authoritative; anything supplied alongside it extends the window.
    chronological = [...extra, ...fromVision];
  } else {
    chronological = toChronological(body.history, body.historyOrder ?? 'most_recent_first');
  }

  const prediction = await predictFromHistory(chronological, {
    currentMultiplier: extraction?.currentMultiplier ?? body.currentMultiplier ?? null,
    timestamp: extraction?.clock ? Date.now() : body.timestamp ?? Date.now(),
  });

  res.json({
    ok: prediction.ok,
    ...(prediction.ok ? {} : { error: prediction.error, hint: prediction.hint }),
    source: extraction ? 'image' : 'history',
    vision: extraction ? { extraction, meta } : null,
    roundsAvailable: chronological.length,
    ...(prediction.ok ? prediction : {}),
  });
});

/** Resolve a ?file= query to a path inside the repo root (traversal-safe), else the default dataset. */
function resolveDatasetFile(raw) {
  if (!raw) return DEFAULT_DATASET_FILE;
  const candidate = path.resolve(REPO_ROOT, String(raw));
  const rel = path.relative(REPO_ROOT, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const error = new Error(`?file= must stay inside the repository root (${REPO_ROOT}).`);
    error.status = 400;
    throw error;
  }
  return candidate;
}

/** What the trainer would see, for debugging a new dataset. */
router.get('/dataset', async (req, res) => {
  let file;
  try {
    file = resolveDatasetFile(req.query.file);
  } catch (error) {
    res.status(error.status ?? 400).json({ ok: false, error: error.message });
    return;
  }
  try {
    const text = await readFile(file, 'utf8');
    const { rounds, meta } = normaliseDataset(text);
    const values = rounds.map((r) => r.multiplier);
    res.json({
      ok: true,
      file: path.relative(REPO_ROOT, file) || path.basename(file),
      ...meta,
      rounds: rounds.length,
      firstRound: rounds[0] ?? null,
      lastRound: rounds[rounds.length - 1] ?? null,
      stats: {
        mean: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)) : null,
        max: values.length ? values.reduce((best, value) => (value > best ? value : best), -Infinity) : null,
        min: values.length ? values.reduce((best, value) => (value < best ? value : best), Infinity) : null,
        shareOver2: values.length ? Number((values.filter((v) => v >= 2).length / values.length).toFixed(4)) : null,
        shareOver10: values.length ? Number((values.filter((v) => v >= 10).length / values.length).toFixed(4)) : null,
      },
      sample: rounds.slice(0, 5),
    });
  } catch (error) {
    res.status(404).json({ ok: false, error: error.message, file: path.relative(REPO_ROOT, file) || path.basename(file) });
  }
});

/** Renders a sample crash-game screenshot on the fly (dependency-free PNG encoder). */
router.get('/sample-image', async (req, res) => {
  const { render } = await import('../scripts/make-sample-screenshot.js');
  const rounds = Math.min(40, Math.max(4, Number(req.query.rounds ?? 18)));
  const seed = Number(req.query.seed ?? 7);
  const current = req.query.current ? Number(req.query.current) : null;
  const { png, multipliers } = render({ rounds, seed, current });
  res.set('Content-Type', 'image/png');
  res.set('X-Ground-Truth-Oldest-First', multipliers.join(','));
  res.send(png);
});

export default router;
