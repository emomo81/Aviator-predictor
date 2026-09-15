'use client';

import { useEffect, useState } from 'react';

export default function ModelPage() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/model')
      .then((r) => r.json())
      .then(setModel)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!model) return <div className="card"><h2>Model report</h2><div className="sk sk-block" /></div>;

  if (!model.loaded) {
    return (
      <div className="card">
        <h2>Model not loaded</h2>
        <p className="muted">{model.reason}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>FlightCast model bundle</h2>
        <div className="row">
          <span className="pill ok">{model.dataset?.rounds?.toLocaleString()} rounds</span>
          <span className="pill mono">{model.trainedAt ? new Date(model.trainedAt).toLocaleString() : 'unknown'}</span>
          <span className="pill">{model.featureCount} features</span>
        </div>
        <p className="muted mono" style={{ fontSize: 12, marginTop: 12 }}>{model.topFeatures}</p>
      </div>

      <div className="card">
        <h2>Held-out evaluation (final 20% chronology, 50k sampled)</h2>
        <table>
          <thead>
            <tr><th>Head</th><th>Model</th><th>Baseline</th><th>Skill</th><th>Notes</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Regression log10</td>
              <td>MAE {model.report?.regression?.mae?.toFixed(4)}</td>
              <td className="muted">{model.report?.regression?.baselineMae?.toFixed(4)}</td>
              <td className="muted">{model.report?.regression?.skillVsBaseline?.toFixed(4)}</td>
              <td className="muted">{model.report?.regression?.arithmeticCorrectionFactor ? `corr ${model.report.regression.arithmeticCorrectionFactor.toFixed(3)}` : ''}</td>
            </tr>
            <tr>
              <td>≥2x classifier</td>
              <td>AUC {model.report?.over2?.auc?.toFixed(4)}</td>
              <td className="muted">0.5000</td>
              <td className="muted">{model.report?.over2?.skillVsBaseline?.toFixed(4)}</td>
              <td className="muted">log-loss {model.report?.over2?.logLoss?.toFixed(4)}</td>
            </tr>
            <tr>
              <td>≥10x classifier</td>
              <td>AUC {model.report?.over10?.auc?.toFixed(4)}</td>
              <td className="muted">0.5000</td>
              <td className="muted">{model.report?.over10?.skillVsBaseline?.toFixed(4)}</td>
              <td className="muted">log-loss {model.report?.over10?.logLoss?.toFixed(4)}</td>
            </tr>
            {model.report?.permutationCheck ? (
              <tr>
                <td>Shuffled-target check</td>
                <td>MAE {model.report.permutationCheck.mae?.toFixed(4)}</td>
                <td className="muted">—</td>
                <td className="muted">{model.report.permutationCheck.skillVsBaseline?.toFixed(4)}</td>
                <td className="muted">should be ~0</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Top features</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(model.report?.regression?.topFeatures ?? []).map((f) => (
            <div key={f.name}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="mono" style={{ fontSize: 12 }}>{f.name}</span>
                <span className="muted mono" style={{ fontSize: 11 }}>{(f.importance * 100).toFixed(1)}%</span>
              </div>
              <div className="bar"><i style={{ width: `${Math.min(100, f.importance * 100 * 4)}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Raw bundle JSON</h2>
        <pre className="json">{JSON.stringify(model, null, 2)}</pre>
      </div>
    </div>
  );
}
