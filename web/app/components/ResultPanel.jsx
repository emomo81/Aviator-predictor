'use client';

import HistoryChart from './HistoryChart.jsx';
import { Stat } from './StatCard.jsx';

function bucket(m) {
  if (m >= 10) return 'b3';
  if (m >= 2) return 'b2';
  return 'b1';
}

export default function ResultPanel({ result }) {
  if (!result) {
    return (
      <div className="card">
        <h2>
          <span className="live" style={{ background: 'var(--muted)' }} /> Flight output
        </h2>
        <p className="muted">
          Upload a screenshot or paste a history strip. Vision extracts rounds, the forest turns
          them into distribution stats, cash-out scenarios, and classifier heads. All numbers are
          shown against the base rate so you can see when skill is zero.
        </p>
        <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Awaiting input
          </div>
          <div className="sk sk-line" style={{ width: '40%' }} />
          <div className="sk sk-block" />
        </div>
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="card">
        <h2>Flight output — error</h2>
        <div className="error">
          {result.error}
          {result.hint ? <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{result.hint}</div> : null}
        </div>
        {result.roundsAvailable != null ? (
          <div className="muted mono" style={{ marginTop: 10, fontSize: 11 }}>
            Rounds available: {result.roundsAvailable}
          </div>
        ) : null}
      </div>
    );
  }

  const { prediction, cashOutScenarios, classifierHeads, input, vision, model, verdict, featureVector } = result;
  const p = prediction;

  return (
    <>
      {vision ? (
        <div className="card">
          <h2>
            <span className="live" /> Vision extraction
          </h2>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="pill sky">{vision.meta.provider}</span>
            <span className="pill">{vision.meta.model}</span>
            <span className={`pill ${vision.extraction.confidence > 0.7 ? 'ok' : 'warn'}`}>
              confidence {(vision.extraction.confidence * 100).toFixed(0)}%
            </span>
            <span className="pill">{vision.extraction.imageQuality}</span>
            {vision.extraction.currentMultiplier ? (
              <span className="pill warn">live {vision.extraction.currentMultiplier.toFixed(2)}x</span>
            ) : null}
            {vision.extraction.clock ? (
              <span className="pill mono">{new Date(vision.extraction.clock).toLocaleTimeString()}</span>
            ) : null}
          </div>
          <HistoryChart values={vision.extraction.rounds?.map((r) => r.multiplier) ?? input.lastRoundsMostRecentFirst?.slice().reverse() ?? []} />
          <div className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
            {vision.extraction.rounds?.length ?? input.roundsObserved} rounds extracted •{' '}
            {vision.meta.latencyMs ? `${vision.meta.latencyMs}ms` : 'offline'} • source: {result.source}
          </div>
        </div>
      ) : null}

      <div className="kpi-row">
        <div className="kpi">
          <div className="label">Geometric mean</div>
          <div className="value">{p.geometricMeanMultiplier.toFixed(2)}x</div>
          <div className="delta">Arithmetic {p.arithmeticMeanMultiplier.toFixed(2)}x</div>
        </div>
        <div className="kpi">
          <div className="label">Median / P90</div>
          <div className="value">{p.medianMultiplier.toFixed(2)}x</div>
          <div className="delta">P90 {p.p90Multiplier.toFixed(2)}x • spread {p.ensembleSpread.min.toFixed(1)}–{p.ensembleSpread.max.toFixed(1)}</div>
        </div>
        <div className="kpi">
          <div className="label">80% interval</div>
          <div className="value" style={{ fontSize: 16 }}>
            {p.interval.lowMultiplier.toFixed(2)}–{p.interval.highMultiplier.toFixed(2)}x
          </div>
          <div className="delta">OOB residuals • heavy tail on purpose</div>
        </div>
        <div className="kpi">
          <div className="label">Model skill vs base</div>
          <div className="value" style={{ color: Math.abs(model.heldOutSkillVsBaseline) < 0.02 ? 'var(--muted)' : 'var(--amber)' }}>
            {model.heldOutSkillVsBaseline.toFixed(4)}
          </div>
          <div className="delta">{model.featureCount} features • {model.dataset?.rounds ?? '?'} rounds trained</div>
        </div>
      </div>

      <div className="card">
        <h2>Last rounds (most recent first)</h2>
        <div className="chips">
          {input.lastRoundsMostRecentFirst.map((v, i) => (
            <span key={`${v}-${i}`} className={`chip ${bucket(v)}`}>
              {v.toFixed(2)}x
            </span>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <HistoryChart values={input.lastRoundsMostRecentFirst.slice().reverse()} maxHeight={64} />
        </div>
      </div>

      <div className="card">
        <h2>Ensemble spread</h2>
        <div className="stats">
          <Stat k="Min tree" v={`${p.ensembleSpread.min.toFixed(2)}x`} s="most pessimistic" />
          <Stat k="P25" v={`${p.ensembleSpread.p25.toFixed(2)}x`} />
          <Stat k="P75" v={`${p.ensembleSpread.p75.toFixed(2)}x`} />
          <Stat k="Max tree" v={`${p.ensembleSpread.max.toFixed(2)}x`} s="most optimistic" />
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10, fontFamily: 'var(--mono)' }}>
          Each tree sees a bootstrap of history. Wide spread = high uncertainty, which is expected on RNG.
        </p>
      </div>

      <div className="card">
        <h2>Cash-out scenarios</h2>
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Model P(reach)</th>
              <th>Base rate</th>
              <th>EV / unit</th>
            </tr>
          </thead>
          <tbody>
            {cashOutScenarios.map((s) => (
              <tr key={s.cashOutAt}>
                <td>{s.cashOutAt.toFixed(1)}x</td>
                <td>{(s.probabilityOfReaching * 100).toFixed(1)}%</td>
                <td className="muted">{s.baselineProbability != null ? `${(s.baselineProbability * 100).toFixed(1)}%` : '—'}</td>
                <td className={s.expectedReturnPerUnitStaked >= 0 ? 'pos' : 'neg'}>
                  {s.expectedReturnPerUnitStaked >= 0 ? '+' : ''}
                  {s.expectedReturnPerUnitStaked.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10, fontFamily: 'var(--mono)' }}>
          EV = target × P(reach) − 1. Negative everywhere is the house edge, not a bug.
        </p>
      </div>

      <div className="card">
        <h2>Classifier heads</h2>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Model P</th>
              <th>Base rate</th>
              <th>Lift</th>
              <th>Held-out AUC</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(classifierHeads).map(([name, head]) => (
              head.skipped ? (
                <tr key={name}>
                  <td>{name === 'over2' ? 'Next ≥ 2.00x' : 'Next ≥ 10.00x'}</td>
                  <td colSpan={4} className="muted">not trained (target constant)</td>
                </tr>
              ) : (
                <tr key={name}>
                  <td>{name === 'over2' ? 'Next ≥ 2.00x' : 'Next ≥ 10.00x'}</td>
                  <td>{(head.probability * 100).toFixed(1)}%</td>
                  <td className="muted">{(head.baselineProbability * 100).toFixed(1)}%</td>
                  <td className={head.lift >= 0 ? 'pos' : 'neg'}>
                    {head.lift >= 0 ? '+' : ''}{(head.lift * 100).toFixed(1)} pts
                  </td>
                  <td className={Math.abs(head.heldOutAuc - 0.5) < 0.02 ? 'muted' : ''}>{head.heldOutAuc.toFixed(3)}</td>
                </tr>
              )
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10, fontFamily: 'var(--mono)' }}>
          AUC ≈ 0.500 = ranks no better than coin flip on held-out data. That is expected for independent rounds.
        </p>
      </div>

      <div className="card">
        <h2>Verdict</h2>
        <p style={{ marginTop: 0, color: 'var(--ink)', fontSize: 13.5, lineHeight: 1.6 }}>{verdict}</p>
        <div className="row" style={{ marginTop: 12 }}>
          <span className={`pill ${model.heldOutSkillVsBaseline >= 0.005 ? 'warn' : 'ok'}`}>
            skill {model.heldOutSkillVsBaseline.toFixed(4)}
          </span>
          <span className="pill mono">{model.trainedAt ? new Date(model.trainedAt).toLocaleString() : 'untrained'}</span>
          <span className="pill mono">{model.dataset?.rounds ?? '?'} rounds</span>
        </div>

        <details style={{ marginTop: 16 }}>
          <summary>Top features by impurity importance</summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {model.topFeatures.map((f) => (
              <div key={f.name}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{f.name}</span>
                  <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                    {(f.importance * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.min(100, f.importance * 100 * 4)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </details>

        <details style={{ marginTop: 12 }}>
          <summary>Feature vector (31 values)</summary>
          <pre className="json">{JSON.stringify(featureVector, null, 2)}</pre>
        </details>

        <details style={{ marginTop: 12 }}>
          <summary>Full response JSON</summary>
          <pre className="json">{JSON.stringify(result, null, 2)}</pre>
        </details>
      </div>
    </>
  );
}
