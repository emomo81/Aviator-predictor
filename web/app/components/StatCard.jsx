'use client';

export function Stat({ k, v, s }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

export function KPI({ label, value, delta, tone }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ color: tone === 'sky' ? 'var(--sky)' : tone === 'amber' ? 'var(--amber)' : tone === 'green' ? 'var(--green)' : 'var(--ink)' }}>
        {value}
      </div>
      {delta ? <div className="delta" style={{ color: tone === 'neg' ? 'var(--red)' : 'var(--muted)' }}>{delta}</div> : null}
    </div>
  );
}
