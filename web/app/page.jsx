'use client';

import { useCallback, useEffect, useState } from 'react';
import UploadPanel from './components/UploadPanel.jsx';
import ResultPanel from './components/ResultPanel.jsx';
import Disclaimer from './components/Disclaimer.jsx';
import { KPI } from './components/StatCard.jsx';

function Skeleton() {
  return (
    <div className="card" aria-busy="true" aria-label="Loading">
      <h2>FlightCast working</h2>
      <div className="sk sk-line" style={{ width: '55%' }} />
      <div className="sk sk-block" />
      <div className="sk sk-block" />
      <div className="sk sk-line" style={{ width: '80%' }} />
    </div>
  );
}

export default function Home() {
  const [health, setHealth] = useState(null);
  const [model, setModel] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sampleSeed, setSampleSeed] = useState(7);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));
    fetch('/api/model')
      .then((r) => r.json())
      .then(setModel)
      .catch(() => setModel({ loaded: false }));
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

  const useSample = useCallback(
    async (seed) => {
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
    },
    [run]
  );

  const visionLabel = !health
    ? null
    : health.status === 'unreachable'
      ? 'API unreachable'
      : health.vision.mock
        ? `mock (${health.vision.reason})`
        : `gemini ${health.vision.models[0]}`;

  return (
    <>
      <Disclaimer />

      {error ? <div className="error" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="kpi-row">
        <KPI
          label="API status"
          value={health?.status === 'ok' ? 'Online' : health?.status === 'unreachable' ? 'Offline' : 'Checking'}
          delta={visionLabel ?? 'vision checking'}
          tone={health?.status === 'ok' ? 'green' : 'neg'}
        />
        <KPI
          label="Model"
          value={health?.model?.loaded ? `${health.model.datasetRounds.toLocaleString()} rounds` : 'Not loaded'}
          delta={model?.trainedAt ? `trained ${new Date(model.trainedAt).toLocaleDateString()}` : model?.reason ?? 'no model.json'}
          tone={health?.model?.loaded ? 'sky' : 'neg'}
        />
        <KPI
          label="Held-out skill"
          value={model?.report ? `${(Math.max(model.report.regression?.skillVsBaseline ?? 0, model.report.over2?.skillVsBaseline ?? 0, model.report.over10?.skillVsBaseline ?? 0)).toFixed(4)}` : '—'}
          delta="vs base-rate • 0 = no signal"
          tone="muted"
        />
        <KPI
          label="Vision provider"
          value={health?.vision?.provider === 'mock' ? 'Offline mock' : health?.vision?.provider === 'gemini' ? 'Gemini' : '—'}
          delta={health?.vision?.models?.[0] ?? 'checking'}
          tone={health?.vision?.provider === 'gemini' ? 'sky' : 'amber'}
        />
      </div>

      <div className="grid">
        <div className="stack">
          <UploadPanel busy={busy} onSubmit={run} onSample={useSample} sampleSeed={sampleSeed} vision={visionLabel} />

          <div className="card">
            <h2>FlightCast model report</h2>
            {model?.loaded ? (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="pill ok">MAE {model.report?.regression?.mae?.toFixed(4) ?? '—'}</span>
                  <span className="pill">baseline {model.report?.regression?.baselineMae?.toFixed(4) ?? '—'}</span>
                  <span className="pill warn">skill {model.report?.regression?.skillVsBaseline?.toFixed(4) ?? '—'}</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Head</th>
                      <th>Metric</th>
                      <th>Baseline</th>
                      <th>Skill</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>log10 regression</td>
                      <td>{model.report?.regression?.mae?.toFixed(4)}</td>
                      <td className="muted">{model.report?.regression?.baselineMae?.toFixed(4)}</td>
                      <td className={model.report?.regression?.skillVsBaseline > 0.01 ? 'pos' : 'muted'}>{model.report?.regression?.skillVsBaseline?.toFixed(4)}</td>
                    </tr>
                    <tr>
                      <td>≥2x classifier</td>
                      <td>{model.report?.over2?.auc?.toFixed(4)}</td>
                      <td className="muted">0.5000</td>
                      <td className="muted">{model.report?.over2?.skillVsBaseline?.toFixed(4)}</td>
                    </tr>
                    <tr>
                      <td>≥10x classifier</td>
                      <td>{model.report?.over10?.auc?.toFixed(4)}</td>
                      <td className="muted">0.5000</td>
                      <td className="muted">{model.report?.over10?.skillVsBaseline?.toFixed(4)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="muted mono" style={{ fontSize: 11, marginTop: 10 }}>
                  {model.topFeatures}
                </p>
              </>
            ) : (
              <p className="muted">Model not loaded. Train with <code>npm --prefix server run train</code> or set MODEL_URL.</p>
            )}
          </div>
        </div>

        <div className="stack">{busy ? <Skeleton /> : <ResultPanel result={result} />}</div>
      </div>
    </>
  );
}
