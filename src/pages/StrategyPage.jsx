import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import ConfidenceBar from '../components/ConfidenceBar.jsx';

export default function StrategyPage() {
  const [s, setS] = useState(null);

  useEffect(() => { api.strategy.get().then(setS).catch(console.error); }, []);
  if (!s) return <div className="empty">Loading strategy…</div>;

  async function save(patch) { setS(await api.strategy.update(patch)); }
  async function saveDomain(key, patch) {
    const updated = await api.strategy.updateDomain(key, patch);
    setS((prev) => ({ ...prev, domains: prev.domains.map((d) => d.key === key ? updated : d) }));
  }

  return (
    <div>
      <div className="page-header">
        <h1>Strategy scaffold</h1>
        <p>A living framework. The system recommends; you decide. Strategic changes require your explicit approval.</p>
      </div>

      <div className="panel">
        <h2>Mission, identity, vision</h2>
        <label>Mission</label>
        <textarea defaultValue={s.mission} onBlur={(e) => save({ mission: e.target.value })} />
        <label>Identity</label>
        <textarea defaultValue={s.identity} onBlur={(e) => save({ identity: e.target.value })} />
        <label>Long-term vision</label>
        <textarea defaultValue={s.long_term_vision} onBlur={(e) => save({ long_term_vision: e.target.value })} />
        <label>Values (comma-separated)</label>
        <input type="text" defaultValue={s.values.join(', ')}
          onBlur={(e) => save({ values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} />
      </div>

      <div className="panel">
        <h2>Life domains</h2>
        <div className="domain-grid">
          {s.domains.map((d) => (
            <div key={d.key} className="domain-card">
              <h3>{d.name}</h3>
              <label>Current state</label>
              <textarea defaultValue={d.current_state || ''} onBlur={(e) => saveDomain(d.key, { current_state: e.target.value })} />
              <label>Desired state</label>
              <textarea defaultValue={d.desired_state || ''} onBlur={(e) => saveDomain(d.key, { desired_state: e.target.value })} />
              <div className="row-flex" style={{ marginTop: 10 }}>
                <label style={{ margin: 0, minWidth: 60 }}>Priority</label>
                <select defaultValue={d.priority} onChange={(e) => saveDomain(d.key, { priority: +e.target.value })}>
                  {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <ConfidenceBar value={d.confidence} label="Confidence" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
