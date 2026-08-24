import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Handshake, AlertTriangle, Plus, Check, Trash2, Clock, Users, Banknote,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Callout, SectionHead } from '../components/ui.jsx';
import SectionTabs from '../components/SectionTabs.jsx';
import { useHashFlash } from '../lib/useHashFlash.js';
import Timeline from '../components/Timeline.jsx';

/**
 * Promises to other people — the layer the whole weighting engine hangs off.
 *
 * Without a way to enter one of these, tier 0 could never fire from real use:
 * the scorer could rank commitments, but nothing could create them.
 */

const TYPE_HINT = {
  contracted: 'Someone is owed this. Can trigger the top-priority override.',
  speculative: 'Might turn into income. Not promised to anyone yet.',
  personal: 'A promise to yourself. Real, but never outranks a contract.',
  restorative: 'Rest or recovery you have committed to protecting.',
};

const STATUS_TONE = {
  open: '', in_progress: 'exploring', at_risk: 'awaiting',
  delivered: 'resolved', renegotiated: 'exploring', dropped: '',
};

export default function CommitmentsPage() {
  const [rows, setRows] = useState([]);
  const [projects, setProjects] = useState([]);
  const [ranking, setRanking] = useState(null);
  const [showDelivered, setShowDelivered] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const [c, p, r] = await Promise.all([
      api.entities.list('commitments'),
      api.entities.list('projects'),
      api.ranking().catch(() => null),
    ]);
    setRows(c); setProjects(p); setRanking(r);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message)).finally(() => setLoaded(true));
  }, []);
  useHashFlash(loaded);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Which of these the scorer currently considers at risk, so the page agrees
  // with the dashboard rather than computing its own opinion.
  const riskById = useMemo(() => {
    const m = {};
    for (const r of ranking?.risks || []) if (r.type === 'commitment') m[r.id] = r;
    return m;
  }, [ranking]);

  const visible = rows.filter((r) =>
    showDelivered || !['delivered', 'dropped'].includes(r.status));
  const openCount = rows.filter((r) => !['delivered', 'dropped'].includes(r.status)).length;
  const atRiskCount = rows.filter((r) => r.status === 'at_risk').length;

  return (
    <div>
      <div className="page-header">
        <h1><Handshake size={22} style={{ color: 'var(--accent)' }} />Commitments</h1>
        <p>
          What you have promised other people, and by when. A contracted commitment that cannot be
          finished in the time left overrides everything else in the app — including rest — until
          it is delivered or the date is renegotiated.
        </p>
      </div>

      {error && <Callout tone="danger" icon={AlertTriangle} title="Problem">{error}</Callout>}

      {ranking?.tier === 'commitment_at_risk' && (
        <Callout tone="danger" icon={AlertTriangle} title="Something here cannot be delivered">
          {ranking.tierReason} <Link to="/dashboard">Open the dashboard →</Link>
        </Callout>
      )}

      <Timeline scope="commitments" />

      <SectionTabs sections={[
        { id: 'add', label: 'Add a commitment', icon: Plus },
        { id: 'open', label: 'Open', icon: Handshake,
          badge: openCount > 0 ? { count: openCount, tone: atRiskCount > 0 ? 'danger' : 'neutral' } : null },
      ]} />

      <div id="add" className="panel">
        <SectionHead icon={Plus} title="Add a commitment"
          action={<button className="ghost" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'New'}
          </button>} />
        {adding
          ? <CommitmentForm projects={projects}
              onCancel={() => setAdding(false)}
              onSaved={() => { setAdding(false); setToast('Commitment added.'); refresh(); }}
              onError={setError} />
          : <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>
              Record the promise, who is waiting, and how much work is genuinely left. That last
              number is what lets the app tell a three-day job due tomorrow from a twenty-minute
              errand due tomorrow.
            </p>}
      </div>

      <div id="open" className="panel">
        <SectionHead icon={Handshake} title={`Open (${visible.length})`}
          action={<button className={'pill' + (showDelivered ? ' active' : '')}
            onClick={() => setShowDelivered((v) => !v)}>Show delivered</button>} />

        {visible.length === 0 ? (
          <div className="empty">
            Nothing recorded. Until something is here, the app has no idea what you owe anyone —
            and the income-priority rules have nothing to act on.
          </div>
        ) : visible.map((c) => (
          <CommitmentRow key={c.id} c={c} risk={riskById[c.id]}
            project={projects.find((p) => p.id === c.project_id)}
            onChanged={refresh} onToast={setToast} onError={setError} />
        ))}
      </div>

      {toast && <div className="toast"><Check size={14} style={{ color: 'var(--success)' }} />{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CommitmentForm({ projects, onCancel, onSaved, onError, initial }) {
  const [f, setF] = useState({
    description: '', project_id: '', waiting_party: '', promised_result: '',
    external_deadline: '', internal_target: '', commitment_type: 'contracted',
    income_impact: 4, effort_remaining_minutes: '', consequence: '',
    ...(initial || {}),
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setSaving(true);
    try {
      const body = { ...f };
      if (!body.project_id) delete body.project_id;
      body.income_impact = Number(body.income_impact);
      body.effort_remaining_minutes = body.effort_remaining_minutes
        ? Number(body.effort_remaining_minutes) : null;
      if (initial?.id) await api.entities.update('commitments', initial.id, body);
      else await api.entities.create('commitments', body);
      onSaved();
    } catch (err) { onError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <label>What did you promise?</label>
      <input type="text" value={f.description} onChange={set('description')}
        placeholder="Deliver the Domovik handover documentation" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div>
          <label>Who is waiting</label>
          <input type="text" value={f.waiting_party} onChange={set('waiting_party')} placeholder="the client" />
        </div>
        <div>
          <label>Project</label>
          <select value={f.project_id} onChange={set('project_id')}>
            <option value="">(none)</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label>Their deadline</label>
          <input type="text" value={f.external_deadline} onChange={set('external_deadline')} placeholder="2026-09-01" />
        </div>
        <div>
          <label>Your own target</label>
          <input type="text" value={f.internal_target} onChange={set('internal_target')} placeholder="earlier, so prep starts in time" />
        </div>
        <div>
          <label>Work left (minutes)</label>
          <input type="number" min={0} step={30} value={f.effort_remaining_minutes}
            onChange={set('effort_remaining_minutes')} placeholder="1080 = 3 working days" />
        </div>
        <div>
          <label>Kind</label>
          <select value={f.commitment_type} onChange={set('commitment_type')}>
            {Object.keys(TYPE_HINT).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label>Income impact (0–5)</label>
          <input type="number" min={0} max={5} value={f.income_impact} onChange={set('income_impact')} />
        </div>
      </div>

      <div className="item-meta" style={{ marginTop: 8 }}>{TYPE_HINT[f.commitment_type]}</div>

      <label style={{ marginTop: 10 }}>What happens if it slips</label>
      <input type="text" value={f.consequence} onChange={set('consequence')}
        placeholder="Optional, but it is what makes the tradeoff real later" />

      <div className="row-flex" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button onClick={save} disabled={saving || !f.description.trim()}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Add commitment'}
        </button>
      </div>
    </div>
  );
}

function CommitmentRow({ c, risk, project, onChanged, onToast, onError }) {
  const [editing, setEditing] = useState(false);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (editing) api.entities.list('projects').then(setProjects).catch(() => {});
  }, [editing]);

  async function patch(body, msg) {
    try { await api.entities.update('commitments', c.id, body); onToast(msg); onChanged(); }
    catch (err) { onError(err.message); }
  }
  async function remove() {
    try { await api.entities.remove('commitments', c.id); onToast('Removed.'); onChanged(); }
    catch (err) { onError(err.message); }
  }

  const done = ['delivered', 'dropped'].includes(c.status);
  const hours = c.effort_remaining_minutes ? Math.round(c.effort_remaining_minutes / 60) : null;

  if (editing) {
    return (
      <div className="task-card">
        <CommitmentForm projects={projects} initial={c}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); onToast('Updated.'); onChanged(); }}
          onError={onError} />
      </div>
    );
  }

  return (
    <div id={`commitment-${c.id}`} className="task-card" style={{
      opacity: done ? 0.5 : 1,
      borderLeftColor: risk?.level === 'red' ? 'var(--danger)'
        : risk ? 'var(--warn)' : 'var(--border)',
    }}>
      <div className="row-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 520, textDecoration: done ? 'line-through' : 'none' }}>
            {c.description}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <span className={`badge ${STATUS_TONE[c.status] || ''}`}>{c.status}</span>
            <span className="badge">{c.commitment_type}</span>
            {c.waiting_party && <span className="badge"><Users size={10} />{c.waiting_party}</span>}
            {c.external_deadline && <span className="badge"><Clock size={10} />due {c.external_deadline}</span>}
            {c.internal_target && <span className="badge">target {c.internal_target}</span>}
            {hours !== null && <span className="badge">{hours}h left</span>}
            {c.income_impact > 0 && <span className="badge ok"><Banknote size={10} />income {c.income_impact}</span>}
            {project && <Link to="/projects" className="badge">{project.name}</Link>}
          </div>
          {risk && (
            <div className="item-meta" style={{
              marginTop: 8, color: risk.level === 'red' ? 'var(--danger)' : 'var(--warn)',
            }}>{risk.message}</div>
          )}
        </div>

        <div className="row-flex" style={{ gap: 5, flexShrink: 0 }}>
          {!done && (
            <>
              <button className="ghost sm" onClick={() => patch({ status: 'delivered' }, 'Delivered.')}>
                <Check size={12} />Delivered
              </button>
              <button className="ghost sm" onClick={() => patch(
                { status: 'renegotiated', postpone_count: (c.postpone_count || 0) + 1 },
                'Marked renegotiated.')}>Renegotiate</button>
            </>
          )}
          <button className="ghost sm" onClick={() => setEditing(true)}>Edit</button>
          <button className="ghost sm danger-text" onClick={remove}><Trash2 size={12} /></button>
        </div>
      </div>
    </div>
  );
}
