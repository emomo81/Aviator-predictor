'use client';

import { useCallback, useEffect, useState } from 'react';
import UploadPanel from './components/UploadPanel.jsx';
import ResultPanel from './components/ResultPanel.jsx';

const NOTICE = 'Crash-style rounds come from a provably-fair random number generator, so every round is independent of the ones before it and nothing here can predict the next multiplier. The numbers below describe the history you supply. Please do not stake money on them.';

function Skeleton() {
  return (
    <div className="card" aria-busy="true" aria-label="Loading prediction">
      <h2>Working</h2>
      <div className="sk sk-line" style={{ width: '55%' }} />
      <div className="sk sk-block" />
      <div className="sk sk-block" />
      <div className="sk sk-line" style={{ width: '80%' }} />
    </div>
  );
}

export default function Home() {
  const [health, setHealth] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sampleSeed, setSampleSeed] = useState(7);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));
  }, []);

  const run = useCallback(async (payload) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      setResult(data);
      if (!response.ok && !data.error) setError(`Request failed with status ${response.status}`);
    } catch (e) {
      setError(`Could not reach the API: ${e.message}`);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const useSample = useCallback(async (seed) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/sample-image?seed=${seed}&rounds=20`);
      if (!response.ok) throw new Error(`sample image failed (${response.status})`);
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('could not encode sample image'));
        reader.readAsDataURL(blob);
      });
      setSampleSeed(seed + 1);
      await run({ image: dataUrl });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [run]);

  const visionLabel = !health
    ? null
    : health.status === 'unreachable'
      ? 'API unreachable'
      : health.vision.mock
        ? `mock (${health.vision.reason})`
        : `gemini ${health.vision.models[0]}`;

  return (
    <main>
      <header className="top">
        <h1>
          Aviator Predictor
          <span className="sub">Gemini vision, then a random forest, then honest numbers</span>
        </h1>
        <div className="row">
          <span className={`pill ${health?.status === 'ok' ? 'ok' : 'bad'}`}>
            api {health?.status === 'ok' ? 'up' : health?.status === 'unreachable' ? 'down' : 'checking'}
          </span>
          <span className={`pill ${health?.model?.loaded ? 'ok' : 'warn'}`}>
            model {health?.model?.loaded ? `${health.model.datasetRounds} rounds` : 'not trained'}
          </span>
          <span className="pill">{visionLabel ?? 'vision checking'}</span>
        </div>
      </header>

      <div className="notice"><strong>Read this first.</strong> {NOTICE}</div>

      {error ? <div className="error" style={{ marginBottom: 20 }}>{error}</div> : null}

      <div className="grid">
        <div>
          <UploadPanel busy={busy} onSubmit={run} onSample={useSample} sampleSeed={sampleSeed} vision={visionLabel} />
          <div className="card">
            <h2>How it works</h2>
            <ol style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: 'var(--muted)', margin: 0 }}>
              <li>The screenshot goes to Gemini with a JSON schema, so it returns structured round history rather than prose.</li>
              <li>Those rounds become a 31-value feature vector: lags, rolling moments, streaks, rates, time of day.</li>
              <li>A random forest predicts the next multiplier in log space, and two classifier heads estimate the chance of reaching 2x and 10x.</li>
              <li>Everything is scored against a naive base-rate baseline, so you can see whether the model found anything at all.</li>
            </ol>
          </div>
        </div>
        <div>
          {busy ? <Skeleton /> : <ResultPanel result={result} />}
        </div>
      </div>

      <footer className="site">
        <div>
          A computer-vision and modelling exercise on your own data. See the{' '}
          <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.
        </div>
        <nav>
          <a href="/terms">Terms of service</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
    </main>
  );
}
