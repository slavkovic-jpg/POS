import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const CATEGORIES = [
  'identity', 'values', 'strengths', 'weaknesses', 'motivations',
  'energy', 'habits', 'preferences', 'stress_triggers', 'decision_style',
];

export default function KnowledgePage() {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState('identity');
  const [content, setContent] = useState('');
  const [confidence, setConfidence] = useState(0.5);

  async function refresh() { setItems(await api.knowledge.list()); }
  useEffect(() => { refresh(); }, []);

  async function add() {
    if (!content.trim()) return;
    await api.knowledge.add({ category, content, confidence });
    setContent(''); setConfidence(0.5);
    refresh();
  }
  async function remove(id) { await api.knowledge.remove(id); refresh(); }

  const grouped = CATEGORIES.map((c) => ({ c, items: items.filter((i) => i.category === c) }));

  return (
    <div>
      <div className="page-header">
        <h1>Personal knowledge model</h1>
        <p>Evolving beliefs about you, each with a confidence score. Facts, hypotheses, and observations live side by side.</p>
      </div>

      <div className="panel">
        <h2>Add observation</h2>
        <div className="row-flex" style={{ alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}>
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 3 }}>
            <label>Content</label>
            <input type="text" value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. Energised by deep-focus 90-min blocks in the morning" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Confidence</label>
            <input type="number" min={0} max={1} step={0.1} value={confidence} onChange={(e) => setConfidence(parseFloat(e.target.value) || 0)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={add}>Add</button>
          </div>
        </div>
      </div>

      {grouped.map(({ c, items }) => (
        <div className="panel" key={c}>
          <h2>{c}</h2>
          {items.length === 0 ? <div className="empty">Nothing captured yet.</div> : (
            <ul className="item-list">
              {items.map((i) => (
                <li key={i.id}>
                  <div>
                    <div className="item-title">{i.content}</div>
                    <div className="item-meta">
                      <span className="badge">conf {Math.round(i.confidence * 100)}%</span>
                      <span> · source {i.source}</span>
                    </div>
                  </div>
                  <div className="item-actions">
                    <button className="ghost" onClick={() => remove(i.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
