import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderKanban, Plus, Check, Trash2, AlertTriangle, Handshake, ListTodo, Clock,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { DomainBadge, HueScope, Callout, SectionHead } from '../components/ui.jsx';
import SectionTabs from '../components/SectionTabs.jsx';
import { useHashFlash } from '../lib/useHashFlash.js';

/**
 * Projects group work and give commitments something to hang off. A task with
 * a project inherits that project's commitments in the scorer, which is how a
 * promise made once ends up raising the priority of every task under it.
 */

const STATUS_TONE = {
  active: 'exploring', waiting: 'awaiting', blocked: 'awaiting',
  paused: '', archived: '', completed: 'resolved',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [domains, setDomains] = useState([]);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const [p, c, t, s] = await Promise.all([
      api.entities.list('projects'),
      api.entities.list('commitments'),
      api.tasks.list(),
      api.strategy.get(),
    ]);
    setProjects(p); setCommitments(c); setTasks(t); setDomains(s.domains);
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

  const visible = projects.filter((p) =>
    showClosed || !['archived', 'completed'].includes(p.status));
  const activeCount = projects.filter((p) => p.status === 'active').length;
  const stalledCount = projects.filter((p) => ['waiting', 'blocked'].includes(p.status)).length;

  return (
    <div>
      <div className="page-header">
        <h1><FolderKanban size={22} style={{ color: 'var(--accent)' }} />Projects</h1>
        <p>
          Somewhere for work to belong. A task attached to a project inherits that project's
          commitments when it is scored — so a promise recorded once lifts everything underneath it.
        </p>
      </div>

      {error && <Callout tone="danger" icon={AlertTriangle} title="Problem">{error}</Callout>}

      <SectionTabs sections={[
        { id: 'add', label: 'Add a project', icon: Plus },
        { id: 'list', label: 'Projects', icon: FolderKanban,
          badge: { count: activeCount, tone: stalledCount > 0 ? 'warn' : 'neutral' } },
      ]} />

      <div id="add" className="panel">
        <SectionHead icon={Plus} title="Add a project"
          action={<button className="ghost" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'New'}
          </button>} />
        {adding && (
          <ProjectForm domains={domains}
            onCancel={() => setAdding(false)}
            onSaved={() => { setAdding(false); setToast('Project added.'); refresh(); }}
            onError={setError} />
        )}
      </div>

      <div id="list" className="panel">
        <SectionHead icon={FolderKanban} title={`Projects (${visible.length})`}
          action={<button className={'pill' + (showClosed ? ' active' : '')}
            onClick={() => setShowClosed((v) => !v)}>Show closed</button>} />

        {visible.length === 0 ? (
          <div className="empty">
            None yet. Projects are optional — a task works fine without one — but they are how a
            commitment reaches the work underneath it.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {visible.map((p) => (
              <ProjectCard key={p.id} p={p}
                commitments={commitments.filter((c) => c.project_id === p.id)}
                tasks={tasks.filter((t) => t.project_id === p.id)}
                domains={domains}
                onChanged={refresh} onToast={setToast} onError={setError} />
            ))}
          </div>
        )}
      </div>

      {toast && <div className="toast"><Check size={14} style={{ color: 'var(--success)' }} />{toast}</div>}
    </div>
  );
}

function ProjectForm({ domains, initial, onCancel, onSaved, onError }) {
  const [f, setF] = useState({
    name: '', purpose: '', desired_outcome: '', next_outcome: '',
    status: 'active', importance: 'medium', urgency: 'medium',
    domain_key: '', income_impact: 0, deadline: '', ...(initial || {}),
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setSaving(true);
    try {
      const body = { ...f, income_impact: Number(f.income_impact) };
      if (!body.domain_key) delete body.domain_key;
      if (initial?.id) await api.entities.update('projects', initial.id, body);
      else await api.entities.create('projects', body);
      onSaved();
    } catch (err) { onError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <label>Name</label>
      <input type="text" value={f.name} onChange={set('name')} placeholder="Domovik" />
      <label>Purpose</label>
      <input type="text" value={f.purpose} onChange={set('purpose')} placeholder="Why this exists at all" />
      <label>The next outcome</label>
      <input type="text" value={f.next_outcome} onChange={set('next_outcome')}
        placeholder="What finishing the next chunk looks like" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div>
          <label>Life domain</label>
          <select value={f.domain_key} onChange={set('domain_key')}>
            <option value="">(none)</option>
            {domains.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select value={f.status} onChange={set('status')}>
            {['active', 'paused', 'waiting', 'blocked', 'archived', 'completed']
              .map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label>Importance</label>
          <select value={f.importance} onChange={set('importance')}>
            {['low', 'medium', 'high'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label>Income impact (0–5)</label>
          <input type="number" min={0} max={5} value={f.income_impact} onChange={set('income_impact')} />
        </div>
        <div>
          <label>Deadline</label>
          <input type="text" value={f.deadline} onChange={set('deadline')} placeholder="2026-12-01" />
        </div>
      </div>

      <div className="row-flex" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button onClick={save} disabled={saving || !f.name.trim()}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Add project'}
        </button>
      </div>
    </div>
  );
}

function ProjectCard({ p, commitments, tasks, domains, onChanged, onToast, onError }) {
  const [editing, setEditing] = useState(false);
  const openTasks = tasks.filter((t) => !['done', 'dropped'].includes(t.status));

  async function remove() {
    try { await api.entities.remove('projects', p.id); onToast('Project removed.'); onChanged(); }
    catch (err) { onError(err.message); }
  }

  if (editing) {
    return (
      <HueScope domainKey={p.domain_key} className="task-card">
        <ProjectForm domains={domains} initial={p}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); onToast('Updated.'); onChanged(); }}
          onError={onError} />
      </HueScope>
    );
  }

  return (
    <HueScope id={`project-${p.id}`} domainKey={p.domain_key} className="task-card">
      <div className="row-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 560, fontSize: 15 }}>{p.name}</div>
          {p.purpose && <div className="item-meta" style={{ marginTop: 2 }}>{p.purpose}</div>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <span className={`badge ${STATUS_TONE[p.status] || ''}`}>{p.status}</span>
            {p.domain_key && <DomainBadge domainKey={p.domain_key} size="sm" />}
            {p.importance === 'high' && <span className="badge awaiting">high importance</span>}
            {p.income_impact > 0 && <span className="badge ok">income {p.income_impact}</span>}
            {p.deadline && <span className="badge"><Clock size={10} />{p.deadline}</span>}
            <Link to="/commitments" className="badge">
              <Handshake size={10} />{commitments.length} commitment{commitments.length === 1 ? '' : 's'}
            </Link>
            <Link to="/tasks" className="badge">
              <ListTodo size={10} />{openTasks.length} open task{openTasks.length === 1 ? '' : 's'}
            </Link>
          </div>

          {p.next_outcome && (
            <div className="task-rationale" style={{ marginTop: 8 }}>
              Next outcome: {p.next_outcome}
            </div>
          )}
          {p.status === 'active' && openTasks.length === 0 && (
            <div className="item-meta" style={{ marginTop: 8, color: 'var(--warn)' }}>
              Active with nothing planned toward it.
            </div>
          )}
        </div>

        <div className="row-flex" style={{ gap: 5, flexShrink: 0 }}>
          <button className="ghost sm" onClick={() => setEditing(true)}>Edit</button>
          <button className="ghost sm danger-text" onClick={remove}><Trash2 size={12} /></button>
        </div>
      </div>
    </HueScope>
  );
}
