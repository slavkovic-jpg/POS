import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import ConfidenceBar from '../components/ConfidenceBar.jsx';
import StageTracker from '../components/StageTracker.jsx';

export default function BriefingPage() {
  const [b, setB] = useState(null);
  const [plan, setPlan] = useState('');

  useEffect(() => {
    api.briefing.today().then((r) => { setB(r); setPlan(r.plan || ''); }).catch(console.error);
  }, []);

  if (!b) return <div className="empty">Loading briefing…</div>;

  async function toggleStage(name) {
    const stages = { [name]: !b.stages[name] };
    const r = await api.briefing.update({ stages });
    setB(r);
  }

  async function savePlan() {
    const r = await api.briefing.update({ plan });
    setB(r);
  }

  async function accept() {
    const r = await api.briefing.update({ stages: { plan_accepted: true }, plan });
    setB(r);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Morning briefing — {b.date}</h1>
        <p>Dialogue, not a task list. Complete stages together, then accept the plan.</p>
      </div>

      <div className="panel">
        <ConfidenceBar value={b.confidence} label="Plan readiness" />
        <h3>Stages</h3>
        <StageTracker stages={b.stages} stageNames={b.stage_names} onToggle={toggleStage} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Open questions</h2>
          {b.open_questions.length === 0 && <div className="empty">No open strategic questions.</div>}
          <ul className="item-list">
            {b.open_questions.map((q) => (
              <li key={q.id}>
                <div>
                  <div className="item-title">{q.question}</div>
                  <div className="item-meta">
                    <span className={`badge ${q.status}`}>{q.status}</span>
                    {q.review_date && <span> · review {q.review_date}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2>Active tasks</h2>
          {b.active_tasks.length === 0 && <div className="empty">No active tasks.</div>}
          <ul className="item-list">
            {b.active_tasks.map((t) => (
              <li key={t.id}>
                <div>
                  <div className="item-title">{t.title}</div>
                  <div className="item-meta">
                    {t.domain_key && <span className="badge">{t.domain_key}</span>}
                    {t.strategic_importance && <span> · importance {t.strategic_importance}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel">
        <h2>Today's plan</h2>
        <textarea
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          placeholder="Draft the day here — priorities, protected time, guardrails."
          rows={8}
        />
        <div className="row-flex" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={savePlan}>Save draft</button>
          <button onClick={accept} disabled={!plan.trim()}>Accept plan</button>
          {b.accepted_at && <span style={{ color: 'var(--success)' }}>Accepted at {new Date(b.accepted_at).toLocaleTimeString()}</span>}
        </div>
      </div>
    </div>
  );
}
