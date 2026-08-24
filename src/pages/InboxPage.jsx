import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox as InboxIcon, Check, Trash2, AlertTriangle, Mic, Globe, Archive,
  ListTodo, Lightbulb, Handshake, FolderKanban, Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Callout, SectionHead } from '../components/ui.jsx';
import SectionTabs from '../components/SectionTabs.jsx';

/**
 * Triage. Everything captured lands here first and stays raw until you decide
 * what it is — which is the point: capture must never require a decision, or
 * you will not capture.
 *
 * Promotion keeps the original row and marks it, rather than deleting it. The
 * words you actually said outlive whatever they were turned into.
 */

const SOURCE_ICON = { voice: Mic, web: Globe, email: Globe, import: Archive, manual: Globe };

const TARGETS = [
  { key: 'task', label: 'Task', icon: ListTodo, hint: 'Something to do' },
  { key: 'ideas', label: 'Idea', icon: Lightbulb, hint: 'Worth keeping, not yet actionable' },
  { key: 'commitments', label: 'Commitment', icon: Handshake, hint: 'You promised someone' },
  { key: 'projects', label: 'Project', icon: FolderKanban, hint: 'A body of work' },
  { key: 'dependencies', label: 'Waiting on', icon: Users, hint: 'Someone else holds it' },
];

export default function InboxPage() {
  const [rows, setRows] = useState([]);
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  async function refresh() { setRows(await api.entities.list('inbox')); }
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function capture() {
    if (!text.trim()) return;
    try {
      await api.entities.create('inbox', { raw_content: text.trim(), source: 'web' });
      setText(''); setToast('Captured.'); refresh();
    } catch (err) { setError(err.message); }
  }

  const visible = rows.filter((r) => showDone || r.processing_status !== 'done');
  const pending = rows.filter((r) => r.processing_status !== 'done').length;

  return (
    <div>
      <div className="page-header">
        <h1><InboxIcon size={22} style={{ color: 'var(--accent)' }} />Inbox</h1>
        <p>
          Where everything lands before it is anything. Capture should never require a decision —
          decide here instead, whenever you have the attention for it.
        </p>
      </div>

      {error && <Callout tone="danger" icon={AlertTriangle} title="Problem">{error}</Callout>}

      <SectionTabs sections={[
        { id: 'capture', label: 'Capture', icon: InboxIcon },
        { id: 'triage', label: 'To triage', icon: InboxIcon,
          badge: pending > 0 ? { count: pending, tone: 'warn' } : null },
      ]} />

      <div id="capture" className="panel">
        <SectionHead icon={InboxIcon} title="Capture" />
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) capture(); }}
          placeholder="Whatever just crossed your mind. Ctrl+Enter to save." />
        <div className="row-flex" style={{ marginTop: 10, justifyContent: 'space-between' }}>
          <span className="item-meta">
            Voice captures will arrive here automatically once the Google Tasks channel is wired.
          </span>
          <button onClick={capture} disabled={!text.trim()}>Capture</button>
        </div>
      </div>

      <div id="triage" className="panel">
        <SectionHead icon={InboxIcon} title={`To triage (${pending})`}
          action={<button className={'pill' + (showDone ? ' active' : '')}
            onClick={() => setShowDone((v) => !v)}>Show processed</button>} />

        {visible.length === 0 ? (
          <div className="empty">
            Empty. Anything you say to <Link to="/copilot">Copilot</Link> can be captured there too.
          </div>
        ) : visible.map((r) => (
          <InboxRow key={r.id} r={r} onChanged={refresh} onToast={setToast} onError={setError} />
        ))}
      </div>

      {toast && <div className="toast"><Check size={14} style={{ color: 'var(--success)' }} />{toast}</div>}
    </div>
  );
}

function InboxRow({ r, onChanged, onToast, onError }) {
  const [note, setNote] = useState(r.context_note || '');
  const [busy, setBusy] = useState(false);
  const Icon = SOURCE_ICON[r.source] || Globe;
  const done = r.processing_status === 'done';

  async function promote(target) {
    setBusy(true);
    try {
      await api.inbox.promote(r.id, target);
      onToast(`Promoted to ${target === 'task' ? 'task' : target.replace(/s$/, '')}.`);
      onChanged();
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  async function saveNote() {
    if (note === (r.context_note || '')) return;
    try { await api.entities.update('inbox', r.id, { context_note: note }); onToast('Note saved.'); }
    catch (err) { onError(err.message); }
  }

  async function park() {
    try { await api.entities.update('inbox', r.id, { processing_status: 'parked' }); onToast('Parked.'); onChanged(); }
    catch (err) { onError(err.message); }
  }

  async function remove() {
    try { await api.entities.remove('inbox', r.id); onToast('Deleted.'); onChanged(); }
    catch (err) { onError(err.message); }
  }

  return (
    <div className="task-card" style={{ opacity: done ? 0.5 : 1 }}>
      <div className="row-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{r.raw_content}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <span className="badge"><Icon size={10} />{r.source}</span>
            <span className="badge">{r.created_at?.slice(0, 16).replace('T', ' ')}</span>
            {done && <span className="badge resolved">→ {r.promoted_to_type}</span>}
            {r.processing_status === 'parked' && <span className="badge awaiting">parked</span>}
          </div>
        </div>
        {!done && (
          <button className="ghost sm danger-text" onClick={remove}><Trash2 size={12} /></button>
        )}
      </div>

      {!done && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
            placeholder="Add context — the original words above are never edited" />

          <div className="row-flex" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
            {TARGETS.map((t) => (
              <button key={t.key} className="ghost sm" disabled={busy}
                onClick={() => promote(t.key)} title={t.hint}>
                <t.icon size={12} />{t.label}
              </button>
            ))}
            <button className="ghost sm" onClick={park}>Park</button>
          </div>
        </div>
      )}
    </div>
  );
}
