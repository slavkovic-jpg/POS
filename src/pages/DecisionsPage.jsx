import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function DecisionsPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ decision: '', reasoning: '', expected_outcome: '', confidence: 0.6, followup_date: '' });

  async function refresh() { setItems(await api.decisions.list()); }
  useEffect(() => { refresh(); }, []);

  async function add() {
    if (!form.decision.trim()) return;
    await api.decisions.add(form);
    setForm({ decision: '', reasoning: '', expected_outcome: '', confidence: 0.6, followup_date: '' });
    refresh();
  }
  async function review(id) {
    const actual_outcome = prompt('Actual outcome?') || '';
    if (!actual_outcome) return;
    const lessons = prompt('Lessons learned?') || '';
    await api.decisions.review(id, { actual_outcome, lessons });
    refresh();
  }

  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <div className="page-header">
        <h1>Decision journal</h1>
        <p>Record decisions with reasoning and expected outcome. Review later; learn from prediction accuracy.</p>
      </div>

      <div className="panel">
        <h2>Log a decision</h2>
        <label>Decision</label>
        <input type="text" value={form.decision} onChange={upd('decision')} placeholder="Take the consulting engagement with X" />
        <label>Reasoning</label>
        <textarea value={form.reasoning} onChange={upd('reasoning')} />
        <label>Expected outcome</label>
        <textarea value={form.expected_outcome} onChange={upd('expected_outcome')} />
        <div className="row-flex" style={{ alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}>
            <label>Confidence (0–1)</label>
            <input type="number" min={0} max={1} step={0.05} value={form.confidence} onChange={(e) => setForm({ ...form, confidence: parseFloat(e.target.value) || 0 })} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Follow-up date</label>
            <input type="text" placeholder="YYYY-MM-DD" value={form.followup_date} onChange={upd('followup_date')} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button onClick={add}>Log decision</button></div>
        </div>
      </div>

      <div className="panel">
        <h2>Journal</h2>
        {items.length === 0 ? <div className="empty">No decisions logged yet.</div> : (
          <ul className="item-list">
            {items.map((d) => (
              <li key={d.id}>
                <div style={{ flex: 1 }}>
                  <div className="item-title">{d.decision}</div>
                  <div className="item-meta">
                    <span className="badge">conf {Math.round((d.confidence ?? 0) * 100)}%</span>
                    <span> · decided {d.decided_at?.slice(0, 10)}</span>
                    {d.followup_date && <span> · follow-up {d.followup_date}</span>}
                    {d.reviewed_at && <span className="badge resolved" style={{ marginLeft: 8 }}>reviewed</span>}
                  </div>
                  {d.reasoning && <div className="item-meta" style={{ marginTop: 6, color: 'var(--text-dim)' }}><em>Reasoning:</em> {d.reasoning}</div>}
                  {d.actual_outcome && <div className="item-meta" style={{ marginTop: 4 }}><em>Actual:</em> {d.actual_outcome}</div>}
                  {d.lessons && <div className="item-meta" style={{ marginTop: 4 }}><em>Lessons:</em> {d.lessons}</div>}
                </div>
                <div className="item-actions">
                  {!d.reviewed_at && <button className="ghost" onClick={() => review(d.id)}>Review</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
