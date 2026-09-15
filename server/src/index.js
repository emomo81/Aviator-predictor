import express from 'express';
import routes from './routes.js';
import { visionConfig } from './vision/gemini.js';
import { bootstrapModel } from './ml/modelStore.js';
import { DISCLAIMER } from './pipeline.js';

const app = express();

// Raw image bytes first, then JSON. Both paths are supported by the handlers.
app.use(express.raw({ type: ['image/*', 'application/octet-stream'], limit: '20mb' }));
app.use(express.json({ limit: '20mb' }));

app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/', (_req, res) => {
  res.type('json').send(JSON.stringify({
    service: 'aviator-predictor api',
    endpoints: ['GET /api/health', 'GET /api/model', 'GET /api/dataset', 'POST /api/analyze', 'POST /api/predict'],
    disclaimer: DISCLAIMER,
  }));
});

app.use('/api', routes);

app.use((error, _req, res, _next) => {
  const status = error.status ?? (/Gemini|gemini/.test(error.message) ? 502 : 400);
  res.status(status).json({ ok: false, error: error.message, status });
});

const host = process.env.API_HOST ?? '0.0.0.0';
// Render (and most PaaS) inject PORT; keep API_PORT for local/dev parity.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);

const vision = visionConfig();
let model;
try {
  model = await bootstrapModel();
} catch (error) {
  model = { loaded: false, source: 'error', reason: error.message };
}
console.log(`[api] vision: ${vision.mock ? `MOCK (${vision.apiKey ? 'VISION_MOCK=true' : 'no GEMINI_API_KEY'})` : `gemini ${vision.models.join(' -> ')}`}`);
console.log(`[api] model:  ${model.loaded ? `${model.dataset?.rounds ?? '?'} rounds via ${model.source}` : `not loaded (${model.source}): ${model.reason}`}`);

app.listen(port, host, () => {
  console.log(`[api] listening on http://${host}:${port}`);
});
