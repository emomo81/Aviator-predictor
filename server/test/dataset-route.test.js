import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import routes from '../src/routes.js';

/** Mount the real router on an ephemeral port so the endpoint is tested end-to-end. */
function startApi() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', routes);
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const close = (server) => new Promise((resolve) => server.close(resolve));

test('GET /api/dataset serves the checked-in multipliers.csv by default', async (t) => {
  const { server, base } = await startApi();
  t.after(() => close(server));

  const res = await fetch(`${base}/api/dataset`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.file, 'multipliers.csv');
  assert.equal(data.multiplierKey, 'Multiplier');
  assert.equal(data.rounds, 732_367);
  assert.ok(data.stats.mean > 1, `mean should be > 1x, got ${data.stats.mean}`);
  assert.ok(data.stats.shareOver2 > 0.4 && data.stats.shareOver2 < 0.6);
  assert.ok(data.stats.shareOver10 > 0.05);
  assert.equal(data.sample.length, 5);
  assert.ok(data.firstRound && data.firstRound.multiplier >= 1);
  assert.ok(data.lastRound && data.lastRound.multiplier >= 1);
});

test('GET /api/dataset ?file= resolves repo-relative dataset files', async (t) => {
  const { server, base } = await startApi();
  t.after(() => close(server));

  const res = await fetch(`${base}/api/dataset?file=aviator_dataset_clean.csv`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.file, 'aviator_dataset_clean.csv');
  assert.ok(data.rounds > 600_000, `expected the full clean dataset, got ${data.rounds} rounds`);
});

test('GET /api/dataset rejects ?file= values that escape the repository root', async (t) => {
  const { server, base } = await startApi();
  t.after(() => close(server));

  const traversal = await fetch(`${base}/api/dataset?file=../../etc/passwd`);
  assert.equal(traversal.status, 400);
  assert.match((await traversal.json()).error, /inside the repository root/);

  const absolute = await fetch(`${base}/api/dataset?file=/etc/passwd`);
  assert.equal(absolute.status, 400);

  const missing = await fetch(`${base}/api/dataset?file=does-not-exist.csv`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).ok, false);
});
