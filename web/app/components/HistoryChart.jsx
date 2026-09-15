'use client';

function bucket(m) {
  if (m >= 10) return 'b3';
  if (m >= 2) return 'b2';
  return 'b1';
}

export default function HistoryChart({ values, maxHeight = 72 }) {
  if (!values?.length) return <div className="muted mono" style={{ fontSize: 12 }}>No history yet</div>;
  const max = Math.max(...values.map((v) => Math.min(v, 20)), 1);
  return (
    <div>
      <div className="chart" style={{ height: maxHeight }}>
        {values.map((v, i) => {
          const h = Math.max(4, Math.min(100, (Math.min(v, 20) / max) * 100));
          return <div key={i} className={`chart-bar ${bucket(v)}`} style={{ height: `${h}%` }} title={`${v.toFixed(2)}x`} />;
        })}
      </div>
      <div className="chips" style={{ marginTop: 10 }}>
        {values.slice(-18).map((v, i) => (
          <span key={`${v}-${i}`} className={`chip ${bucket(v)}`}>
            {v.toFixed(2)}x
          </span>
        ))}
      </div>
    </div>
  );
}
