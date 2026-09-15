'use client';

import { useRef, useState } from 'react';

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

export default function UploadPanel({ busy, onSubmit, onSample, sampleSeed, vision }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState(null);

  async function handleFile(file) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That is not an image file.');
      return;
    }
    const dataUrl = await toDataUrl(file);
    setPreview({ src: dataUrl, name: file.name });
    onSubmit({ image: dataUrl });
  }

  function handleManual(event) {
    event.preventDefault();
    setError(null);
    const values = manual
      .split(/[\s,;]+/)
      .map((v) => Number.parseFloat(v.replace('x', '')))
      .filter((v) => Number.isFinite(v) && v >= 1);
    if (values.length < 12) {
      setError(
        `Need at least 12 rounds, found ${values.length}. Paste the history strip most-recent-first, e.g. "2.14, 1.07, 5.63, 1.29, ...".`
      );
      return;
    }
    setPreview(null);
    onSubmit({ history: values, historyOrder: 'most_recent_first' });
  }

  return (
    <div className="card">
      <h2>
        <span className="live" /> Flight input
      </h2>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        {preview ? <img src={preview.src} alt={preview.name} /> : null}
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
          {preview ? preview.name : 'Drop screenshot here or click to browse'}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6, fontFamily: 'var(--mono)' }}>
          Full history strip must be visible — 12+ rounds
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => inputRef.current?.click()} disabled={busy}>
          Choose image
        </button>
        <button className="ghost" onClick={() => onSample(sampleSeed)} disabled={busy}>
          Use generated sample
        </button>
      </div>

      <div style={{ margin: '14px 0 10px' }} className="row">
        <span className="pill sky">{vision ? `vision ${vision}` : 'vision checking'}</span>
        <span className="pill">12–40 rounds used</span>
      </div>

      <form onSubmit={handleManual} style={{ marginTop: 16 }}>
        <label htmlFor="manual">Or paste multipliers directly (most recent first)</label>
        <textarea
          id="manual"
          rows={3}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="2.14, 1.07, 5.63, 1.29, 1.88, 12.40, 1.02, 3.11, 1.55, 1.19, 7.02, 1.44, 2.30"
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> Running...
              </>
            ) : (
              'Run FlightCast analysis'
            )}
          </button>
        </div>
      </form>

      {error ? <div className="error" style={{ marginTop: 14 }}>{error}</div> : null}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
          How it works
        </h3>
        <ol style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--muted)', margin: 0 }}>
          <li>Screenshot → Gemini with JSON schema → structured round history.</li>
          <li>History → 31-value vector: lags, rolling moments, streaks, rates, time-of-day.</li>
          <li>Random forest: next multiplier in log space + P(≥2x) and P(≥10x).</li>
          <li>Every head scored vs naive base-rate so you see skill ≈ 0 on RNG.</li>
        </ol>
      </div>
    </div>
  );
}
