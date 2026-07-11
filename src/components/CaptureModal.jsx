import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Capture modal — extracts structured records (open questions, decisions,
 * knowledge) from recent conversation. User reviews each proposed row,
 * edits or unchecks, then Save writes to the respective tables.
 */
export default function CaptureModal({ open, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError(null); setRows([]);
    api.chat.capture()
      .then((result) => {
        if (cancelled) return;
        setSource(`${result.source || '—'}${result.model ? ' · ' + result.model : ''}`);
        setRows(flatten(result));
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const acceptedCount = rows.filter((r) => r.accepted).length;

  async function save() {
    setSaving(true); setError(null);
    try {
      for (const r of rows) {
        if (!r.accepted) continue;
        if (r.kind === 'question') {
          await api.questions.add({
            question: r.data.question,
            context: r.data.context,
            strategic_importance: r.data.strategic_importance,
          });
        } else if (r.kind === 'decision') {
          await api.decisions.add({
            decision: r.data.decision,
            reasoning: r.data.reasoning,
            confidence: r.data.confidence,
          });
        } else if (r.kind === 'knowledge') {
          await api.knowledge.add({
            category: r.data.category,
            content: r.data.content,
            confidence: r.data.confidence,
            source: 'chat',
          });
        }
      }
      onSaved?.(acceptedCount);
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
            <h2 style={{ margin: 0 }}>Capture from conversation</h2>
            {source && <div className="item-meta">{source}</div>}
          </div>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body">
          {loading && <div className="empty">Scanning the conversation… (may take 1–3 min on Ollama)</div>}
          {error && <div style={{ color: 'var(--danger)', fontSize: 13, padding: 12 }}>{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="empty">
              Nothing worth capturing yet. Have a bit more conversation and try again.
            </div>
          )}

          {rows.length > 0 && groupByKind(rows).map(([kind, items]) => (
            <div className="panel" key={kind} style={{ marginBottom: 12 }}>
              <h2 style={{ marginTop: 0 }}>{kindLabel(kind)} ({items.length})</h2>
              <ul className="item-list">
                {items.map((r) => (
                  <CaptureRow key={r.id} row={r} onChange={(patch) => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, ...patch } : x))} />
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <div className="item-meta">{acceptedCount} of {rows.length} selected</div>
          <div className="row-flex">
            <button className="ghost" onClick={onClose}>Cancel</button>
            <button onClick={save} disabled={saving || acceptedCount === 0}>
              {saving ? 'Saving…' : `Save ${acceptedCount}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CaptureRow({ row, onChange }) {
  const d = row.data;
  return (
    <li style={{ gap: 12, alignItems: 'flex-start' }}>
      <input type="checkbox" checked={row.accepted} onChange={(e) => onChange({ accepted: e.target.checked })}
        style={{ width: 18, height: 18, marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, opacity: row.accepted ? 1 : 0.5 }}>
        {row.kind === 'question' && (
          <>
            <textarea rows={2} value={d.question}
              onChange={(e) => onChange({ data: { ...d, question: e.target.value } })} />
            <input type="text" placeholder="context (optional)" value={d.context || ''}
              onChange={(e) => onChange({ data: { ...d, context: e.target.value } })}
              style={{ marginTop: 6 }} />
            <div className="row-flex" style={{ marginTop: 6 }}>
              <span className="item-meta">importance</span>
              <select value={d.strategic_importance}
                onChange={(e) => onChange({ data: { ...d, strategic_importance: +e.target.value } })}>
                {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </>
        )}
        {row.kind === 'decision' && (
          <>
            <textarea rows={2} value={d.decision}
              onChange={(e) => onChange({ data: { ...d, decision: e.target.value } })} />
            <textarea rows={2} placeholder="reasoning" value={d.reasoning || ''}
              onChange={(e) => onChange({ data: { ...d, reasoning: e.target.value } })}
              style={{ marginTop: 6 }} />
            <ConfidenceControl value={d.confidence} onChange={(v) => onChange({ data: { ...d, confidence: v } })} />
          </>
        )}
        {row.kind === 'knowledge' && (
          <>
            <textarea rows={2} value={d.content}
              onChange={(e) => onChange({ data: { ...d, content: e.target.value } })} />
            <div className="row-flex" style={{ marginTop: 6 }}>
              <span className="item-meta" style={{ minWidth: 80 }}>category</span>
              <input type="text" value={d.category}
                onChange={(e) => onChange({ data: { ...d, category: e.target.value } })} />
            </div>
            <ConfidenceControl value={d.confidence} onChange={(v) => onChange({ data: { ...d, confidence: v } })} />
          </>
        )}
      </div>
    </li>
  );
}

function ConfidenceControl({ value, onChange }) {
  return (
    <div className="row-flex" style={{ marginTop: 6, gap: 12 }}>
      <span className="item-meta">confidence</span>
      <input type="range" min={0.1} max={1} step={0.05} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
      <span className="item-meta" style={{ minWidth: 40 }}>{Math.round((value ?? 0) * 100)}%</span>
    </div>
  );
}

function flatten(result) {
  const out = [];
  let id = 0;
  (result.open_questions || []).forEach((data) => out.push({ id: id++, kind: 'question', data, accepted: true }));
  (result.decisions || []).forEach((data) => out.push({ id: id++, kind: 'decision', data, accepted: true }));
  (result.knowledge || []).forEach((data) => out.push({ id: id++, kind: 'knowledge', data, accepted: true }));
  return out;
}

function groupByKind(rows) {
  const order = ['question', 'decision', 'knowledge'];
  const g = { question: [], decision: [], knowledge: [] };
  for (const r of rows) g[r.kind]?.push(r);
  return order.map((k) => [k, g[k]]).filter(([, items]) => items.length > 0);
}

function kindLabel(kind) {
  return { question: 'Open questions', decision: 'Decisions', knowledge: 'Knowledge' }[kind];
}
