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
      setError(`Need at least 12 rounds, found ${values.length}. Paste the history strip most-recent-first, e.g. "2.14, 1.07, 5.63, 1.29, ...".`);
      return;
    }
    setPreview(null);
    onSubmit({ history: values, historyOrder: 'most_recent_first' });
  }

  return (
    <div className="card">
      <h2>1. Input</h2>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        {preview ? <img src={preview.src} alt={preview.name} /> : null}
        <div>{preview ? preview.name : 'Drop a screenshot here, or click to browse'}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          The full history strip needs to be visible
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
        <button onClick={() => inputRef.current?.click()} disabled={busy}>Choose image</button>
        <button className="ghost" onClick={() => onSample(sampleSeed)} disabled={busy}>
          Use a generated sample
        </button>
      </div>

      <div style={{ margin: '18px 0 10px' }} className="muted">
        <span className="pill">{vision ? `vision: ${vision}` : 'vision: checking...'}</span>
      </div>

      <form onSubmit={handleManual} style={{ marginTop: 16 }}>
        <label htmlFor="manual">or paste multipliers directly (most recent first)</label>
        <textarea
          id="manual"
          rows={3}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="2.14, 1.07, 5.63, 1.29, 1.88, 12.40, 1.02, 3.11, 1.55, 1.19, 7.02, 1.44, 2.30"
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? <><span className="spinner" /> Working...</> : 'Run prediction'}
          </button>
        </div>
      </form>

      {error ? <div className="error" style={{ marginTop: 14 }}>{error}</div> : null}
    </div>
  );
}
