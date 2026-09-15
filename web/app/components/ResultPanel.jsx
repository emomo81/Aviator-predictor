'use client';

function bucket(m) {
  if (m >= 10) return 'b3';
  if (m >= 2) return 'b2';
  return 'b1';
}

function Chips({ values }) {
  return (
    <div className="chips">
      {values.map((v, i) => (
        <span key={`${v}-${i}`} className={`chip ${bucket(v)}`}>{v.toFixed(2)}x</span>
      ))}
    </div>
  );
}

export default function ResultPanel({ result }) {
  if (!result) {
    return (
      <div className="card">
        <h2>2. Output</h2>
        <p className="muted">
          Upload a screenshot or paste a history strip. The image goes to Gemini for structured
          extraction, the extracted rounds become a feature vector, and the random forest turns
          that into the numbers below.
        </p>
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="card">
        <h2>2. Output</h2>
        <div className="error">
          {result.error}
          {result.hint ? <div className="muted" style={{ marginTop: 8 }}>{result.hint}</div> : null}
        </div>
      </div>
    );
  }

  const { prediction, cashOutScenarios, classifierHeads, input, vision, model, verdict } = result;
  const p = prediction;

  return (
    <>
      {vision ? (
        <div className="card">
          <h2>Vision extraction</h2>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="pill">{vision.meta.provider}</span>
            <span className="pill">{vision.meta.model}</span>
            <span className={`pill ${vision.extraction.confidence > 0.7 ? 'ok' : 'warn'}`}>
              confidence {(vision.extraction.confidence * 100).toFixed(0)}%
            </span>
            <span className="pill">{vision.extraction.imageQuality}</span>
            {vision.extraction.currentMultiplier ? (
              <span className="pill">live: {vision.extraction.currentMultiplier.toFixed(2)}x</span>
            ) : null}
          </div>
          {vision.extraction.history.length ? (
            <Chips values={vision.extraction.history.map((h) => h.multiplier)} />
          ) : (
            <p className="muted">No rounds were read from this image.</p>
          )}
          {vision.extraction.notes ? (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{vision.extraction.notes}</p>
          ) : null}
          {vision.extraction.visibleText?.length ? (
            <details style={{ marginTop: 10 }}>
              <summary>Verbatim text read from the image ({vision.extraction.visibleText.length})</summary>
              <pre className="json">{vision.extraction.visibleText.join('\n')}</pre>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h2>Prediction for the next round</h2>
        <div className="stats">
          <div className="stat">
            <div className="k">Median estimate</div>
            <div className="v">{p.medianMultiplier.toFixed(2)}x</div>
            <div className="s">50th percentile of the predictive distribution</div>
          </div>
          <div className="stat">
            <div className="k">Mean estimate</div>
            <div className="v">{p.arithmeticMeanMultiplier.toFixed(2)}x</div>
            <div className="s">geometric {p.geometricMeanMultiplier.toFixed(2)}x, corrected for the tail</div>
          </div>
          <div className="stat">
            <div className="k">80% interval</div>
            <div className="v">{p.interval.lowMultiplier.toFixed(2)}–{p.interval.highMultiplier.toFixed(2)}x</div>
            <div className="s">from out-of-bag residuals</div>
          </div>
          <div className="stat">
            <div className="k">Rounds used</div>
            <div className="v">{input.roundsUsed}</div>
            <div className="s">{input.roundsObserved} observed</div>
          </div>
        </div>

        <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
          Recent rounds: <Chips values={input.lastRoundsMostRecentFirst} />
        </p>
      </div>

      <div className="card">
        <h2>Cash-out scenarios</h2>
        <table>
          <thead>
            <tr>
              <th>Cash out at</th>
              <th>P(reached)</th>
              <th>Base rate</th>
              <th>Expected return / unit</th>
            </tr>
          </thead>
          <tbody>
            {cashOutScenarios.map((s) => (
              <tr key={s.cashOutAt}>
                <td>{s.cashOutAt.toFixed(2)}x</td>
                <td>{(s.probabilityOfReaching * 100).toFixed(1)}%</td>
                <td className="muted">
                  {s.baselineProbability == null ? 'n/a' : `${(s.baselineProbability * 100).toFixed(1)}%`}
                </td>
                <td className={s.expectedReturnPerUnitStaked < 0 ? 'neg' : 'pos'}>
                  {s.expectedReturnPerUnitStaked >= 0 ? '+' : ''}
                  {s.expectedReturnPerUnitStaked.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          Expected return is what one staked unit is worth after cashing out at that target. Negative
          at every target is the house edge, not a modelling failure.
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
                  <td>{name === 'over2' ? 'Next >= 2.00x' : 'Next >= 10.00x'}</td>
                  <td colSpan={4} className="muted">not trained (target constant)</td>
                </tr>
              ) : (
                <tr key={name}>
                  <td>{name === 'over2' ? 'Next >= 2.00x' : 'Next >= 10.00x'}</td>
                  <td>{(head.probability * 100).toFixed(1)}%</td>
                  <td className="muted">{(head.baselineProbability * 100).toFixed(1)}%</td>
                  <td className={head.lift >= 0 ? 'pos' : 'neg'}>
                    {head.lift >= 0 ? '+' : ''}{(head.lift * 100).toFixed(1)} pts
                  </td>
                  <td className={Math.abs(head.heldOutAuc - 0.5) < 0.02 ? 'muted' : ''}>
                    {head.heldOutAuc.toFixed(3)}
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          AUC near 0.500 means the head ranks no better than a coin flip on data it never saw.
        </p>
      </div>

      <div className="card">
        <h2>Verdict</h2>
        <p style={{ marginTop: 0 }}>{verdict}</p>
        <div className="row">
          <span className={`pill ${model.heldOutSkillVsBaseline >= 0.005 ? 'warn' : 'ok'}`}>
            held-out skill vs base rate: {model.heldOutSkillVsBaseline.toFixed(4)}
          </span>
          <span className="pill">trained {new Date(model.trainedAt).toLocaleString()}</span>
          <span className="pill">{model.dataset?.rounds ?? '?'} rounds in training set</span>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary>Top features by impurity importance</summary>
          {model.topFeatures.map((f) => (
            <div key={f.name} style={{ marginTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>{f.name}</span>
                <span className="muted" style={{ fontSize: 12.5 }}>{(f.importance * 100).toFixed(1)}%</span>
              </div>
              <div className="bar"><i style={{ width: `${Math.min(100, f.importance * 100 * 4)}%` }} /></div>
            </div>
          ))}
        </details>
        <details style={{ marginTop: 12 }}>
          <summary>Full response JSON</summary>
          <pre className="json">{JSON.stringify(result, null, 2)}</pre>
        </details>
      </div>
    </>
  );
}
