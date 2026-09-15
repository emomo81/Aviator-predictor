'use client';

export default function Disclaimer() {
  return (
    <div className="disclaimer">
      <div className="dot" />
      <div>
        <strong>Flight advisory</strong> Crash-style rounds are produced by a provably-fair random
        number generator. Each round is independent, so no model can predict the next multiplier.
        FlightCast shows you what the history looks like and how a model behaves against a naive
        baseline — it does not tell you where to stake.
      </div>
    </div>
  );
}
