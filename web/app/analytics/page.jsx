'use client';

import { useEffect, useState } from 'react';
import HistoryChart from '../components/HistoryChart.jsx';

export default function AnalyticsPage() {
  const [dataset, setDataset] = useState(null);
  const [error, setError] = useState(null);
  const [sample, setSample] = useState([]);

  useEffect(() => {
    fetch('/api/dataset')
      .then((r) => r.json())
      .then((d) => {
        setDataset(d);
        if (d.ok && d.sample) setSample(d.sample.map((r) => r.multiplier).slice(0, 60));
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!dataset) return <div className="card"><h2>Analytics</h2><div className="sk sk-block" /></div>;

  if (!dataset.ok) {
    return (
      <div className="card">
        <h2>Dataset unavailable</h2>
        <p className="muted">{dataset.error}</p>
        <p className="muted mono" style={{ fontSize: 11 }}>Tried: {dataset.file}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>Dataset overview</h2>
        <div className="row">
          <span className="pill ok">{dataset.rounds.toLocaleString()} rounds</span>
          <span className="pill mono">{dataset.file}</span>
          <span className="pill">mean {dataset.stats.mean?.toFixed(3)}x</span>
          <span className="pill">≥2x {(dataset.stats.shareOver2 * 100).toFixed(1)}%</span>
          <span className="pill warn">≥10x {(dataset.stats.shareOver10 * 100).toFixed(1)}%</span>
        </div>
        <div className="stats" style={{ marginTop: 14 }}>
          <div className="stat"><div className="k">Mean</div><div className="v">{dataset.stats.mean?.toFixed(4)}x</div></div>
          <div className="stat"><div className="k">Min</div><div className="v">{dataset.stats.min?.toFixed(2)}x</div></div>
          <div className="stat"><div className="k">Max</div><div className="v">{dataset.stats.max?.toFixed(2)}x</div></div>
          <div className="stat"><div className="k">≥2x rate</div><div className="v">{(dataset.stats.shareOver2 * 100).toFixed(2)}%</div></div>
        </div>
      </div>

      <div className="card">
        <h2>Sample sequence (first 60)</h2>
        <HistoryChart values={sample} maxHeight={96} />
        <p className="muted mono" style={{ fontSize: 11, marginTop: 10 }}>
          Oldest → newest • clipped to 20x for visualization • heavy tail is expected
        </p>
      </div>

      <div className="card">
        <h2>First & last rounds</h2>
        <div className="row" style={{ gap: 24 }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>First</div>
            <div className="mono" style={{ fontSize: 13 }}>{JSON.stringify(dataset.firstRound)}</div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Last</div>
            <div className="mono" style={{ fontSize: 13 }}>{JSON.stringify(dataset.lastRound)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Why this dashboard shows zero skill</h2>
        <p>
          Crash games are provably-fair RNGs. The training pipeline preserves chronology, reserves the final 20% as held-out test,
          and samples up to 50k rows evenly across each partition. Features are built only from rounds before the target.
          The evaluated model reports MAE 0.3184 vs baseline 0.3182 and AUC 0.4993 vs 0.5000 — no predictive signal.
          That is the expected result and is displayed as a feature, not a bug.
        </p>
      </div>
    </div>
  );
}
