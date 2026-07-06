import React from 'react';

export default function ConfidenceBar({ value, label = 'Confidence' }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div className="confidence-bar" title={`${label}: ${pct}%`}>
      <span style={{ color: 'var(--text-dim)', minWidth: 100 }}>{label}</span>
      <div className="confidence-bar-track">
        <div className="confidence-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span style={{ minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}
