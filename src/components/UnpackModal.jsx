import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Review gate for the brain dump. The model proposes scored tasks; nothing is
 * written until you approve. Same contract as CaptureModal — the LLM never
 * writes to the database on its own.
 */
export default function UnpackModal({ open, text, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  const [rows, setRows] = useState([]);
  const [domains, setDomains] = useState([]);
  const [saving, setSaving] = useState(false);
  const [degraded, setDegraded] = useState(null);

  useEffect(() => {
    if (!open) return;
    api.strategy.get().then((s) => setDomains(s.domains)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || !text?.trim()) return;
    let cancelled = false;
    setLoading(true); setError(null); setRows([]); setDegraded(null);
    api.tasks.unpack(text)
      .then((r) => {
        if (cancelled) return;
        setSource(r.source ? `${r.source}${r.model ? ' · ' + r.model : ''}` : null);
        if (r.degraded) setDegraded(r.degraded_reason || 'the model could not parse this');
        setRows(r.candidates.map((c, i) => ({ ...c, _id: i, accepted: true })));
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, text]);

  if (!open) return null;

  const accepted = rows.filter((r) => r.accepted);

  function patch(id, changes) {
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...changes } : r)));
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const payload = accepted.map(({ _id, accepted, ...rest }) => rest);
      await api.tasks.accept(payload);
      onSaved?.(payload.length);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>Unpacked tasks</h2>
            {source && <div className="item-meta">{source}</div>}
          </div>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body">
          {loading && <div className="empty">Unpacking… (may take 1–3 min on Ollama)</div>}
          {error && <div style={{ color: 'var(--danger)', fontSize: 13, padding: 12 }}>{error}</div>}

          {degraded && (
            <div className="callout warn">
              <AlertTriangle size={16} />
              <div>
                <strong style={{ display: 'block', marginBottom: 2 }}>Saved your text, but couldn't score it</strong>
                <span style={{ color: 'var(--text-dim)' }}>
                  {degraded}. Your words are kept as one task rather than lost — edit it below, or
                  fix the backend on <Link to="/settings">Settings</Link> and unpack again.
                </span>
              </div>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="empty">Nothing actionable found in that. Try adding more detail.</div>
          )}

          {rows.map((r) => (
            <div key={r._id} className="panel" style={{ marginBottom: 10, opacity: r.accepted ? 1 : 0.5 }}>
              <div className="row-flex" style={{ alignItems: 'flex-start', gap: 10 }}>
                <input type="checkbox" checked={r.accepted}
                  onChange={(e) => patch(r._id, { accepted: e.target.checked })}
                  style={{ width: 18, height: 18, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <textarea rows={2} value={r.title}
                    onChange={(e) => patch(r._id, { title: e.target.value })} />

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
                    <div>
                      <label>Domain</label>
                      <select value={r.domain_key || ''}
                        onChange={(e) => patch(r._id, { domain_key: e.target.value || null })}>
                        <option value="">(none)</option>
                        {domains.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>Minutes</label>
                      <input type="number" min={5} max={480} step={5} value={r.time_minutes}
                        onChange={(e) => patch(r._id, { time_minutes: +e.target.value })} />
                    </div>
                    <div>
                      <label>Importance</label>
                      <select value={r.strategic_importance}
                        onChange={(e) => patch(r._id, { strategic_importance: +e.target.value })}>
                        {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}{n === 1 ? ' (highest)' : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>Energy needed</label>
                      <select value={r.energy_required}
                        onChange={(e) => patch(r._id, { energy_required: +e.target.value })}>
                        {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}{n === 5 ? ' (peak)' : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>Dread</label>
                      <select value={r.anxiety_level}
                        onChange={(e) => patch(r._id, { anxiety_level: +e.target.value })}>
                        {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Only present on the raw fallback, where the title is a
                      truncation and this holds everything you actually wrote. */}
                  {r.notes && (
                    <>
                      <label style={{ marginTop: 8 }}>Your full text (kept as notes)</label>
                      <textarea rows={3} value={r.notes}
                        onChange={(e) => patch(r._id, { notes: e.target.value })} />
                    </>
                  )}

                  <label style={{ marginTop: 8 }}>Why it matters</label>
                  <input type="text" value={r.rationale || ''}
                    onChange={(e) => patch(r._id, { rationale: e.target.value })} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <div className="item-meta">{accepted.length} of {rows.length} selected</div>
          <div className="row-flex">
            <button className="ghost" onClick={onClose}>Cancel</button>
            <button onClick={save} disabled={saving || accepted.length === 0}>
              {saving ? 'Saving…' : `Add ${accepted.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
