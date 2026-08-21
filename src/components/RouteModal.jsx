import React, { useEffect, useState } from 'react';
import {
  Send, AlertTriangle, Sparkles, HelpCircle, ShieldAlert, Copy,
  Link as LinkIcon,
} from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Batch routing review — dump anything, see where every piece is going, agree
 * once, done.
 *
 * The gate is per-batch rather than per-item. That is the whole point: nothing
 * writes until this screen is accepted (AGENTS.md #5 is intact), but agreeing
 * costs one click instead of one click per fragment.
 *
 * Two things the layout is doing on purpose:
 *   - Rows are ordered by blast radius, not by the order they were typed.
 *     A commitment or a knowledge row is read first, while attention is fresh,
 *     because those are the two that do real damage when wrong.
 *   - Anything low-confidence or rule/model-disagreeing is visually loud. A
 *     guess must never look as settled as a certainty.
 */

const DESTINATIONS = [
  ['task', 'Task'],
  ['commitment', 'Commitment'],
  ['project', 'Project'],
  ['dependency', 'Waiting on someone'],
  ['idea', 'Idea'],
  ['knowledge', 'Knowledge'],
  ['open_question', 'Open question'],
  ['decision', 'Decision'],
  ['health_signal', 'Health signal'],
  ['unclear', 'Leave in inbox'],
];

const LABEL = Object.fromEntries(DESTINATIONS);

/** Why a wrong route here costs more than a wrong route there. */
const RISK_NOTE = {
  commitment: 'Drives the ranker. A wrong one here outranks everything else.',
  knowledge: 'Feeds every future conversation as a fact about you.',
  decision: 'Recorded as settled, with reasoning.',
  project: 'Becomes a container other work hangs off.',
  health_signal: 'Feeds the burnout signal.',
};

export default function RouteModal({
  open, onClose, onFiled, initialText = '', source = 'text',
}) {
  const [text, setText] = useState(initialText);
  const [items, setItems] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fromChat = source === 'conversation';

  // The component stays mounted while closed, so `useState(initialText)` only
  // ever sees the value from first render — which is an empty dump box. Resync
  // on open, or whatever was typed on the dashboard silently fails to arrive.
  useEffect(() => {
    if (!open) return;
    setText(initialText); setItems(null); setMeta(null); setError(null);
    if (fromChat) load(() => api.route.fromConversation());
  }, [open, initialText, fromChat]);

  if (!open) return null;

  async function load(fn) {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      setItems(r.items.map((it, i) => ({ ...it, key: i, skip: false })));
      setMeta(r);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const propose = () => text.trim() && load(() => api.route.propose(text));

  async function commit() {
    setBusy(true); setError(null);
    try {
      const r = await api.route.commit(items);
      onFiled?.(r);
      reset();
      onClose?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function reset() { setText(''); setItems(null); setMeta(null); }

  const patch = (key, p) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const keeping = items ? items.filter((i) => !i.skip) : [];
  const risky = keeping.filter((i) => i.blast >= 3).length;
  const unsure = keeping.filter((i) => i.confidence === 'low').length;
  const updating = keeping.filter((i) => i.fields?.existing_id).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>{fromChat ? 'File what we agreed' : 'Sort a dump'}</h2>
            <div className="item-meta">
              {meta
                ? `${meta.fragments} item${meta.fragments === 1 ? '' : 's'} · ${meta.source || 'rules only'}${meta.model ? ' · ' + meta.model : ''}`
                : fromChat
                  ? 'Reading the conversation for anything that was actually settled.'
                  : 'Everything goes where it belongs. Nothing is written until you say so.'}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body">
          {fromChat && busy && !items && (
            <div className="empty">Reading the conversation…</div>
          )}

          {!items && !fromChat && (
            <>
              <textarea
                rows={9}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  'Everything on your mind. One thought per line, or just talk.\n\n' +
                  'Send the Q3 model to Sarah by Friday\n' +
                  'Idea: weekly digest of open questions\n' +
                  'I focus best before 11am\n' +
                  'Is the consulting work actually worth it?'
                }
              />
              {error && <Err msg={error} />}
            </>
          )}

          {meta?.degraded && (
            <div className="callout warn" style={{ marginBottom: 12 }}>
              <AlertTriangle size={15} />
              <div>
                <strong>No model answered.</strong> These were sorted by rules alone, so most
                will say <em>Leave in inbox</em>. Nothing is lost — set what you can and file
                the rest for later.
              </div>
            </div>
          )}

          {meta?.partial && (
            <div className="callout warn" style={{ marginBottom: 12 }}>
              <AlertTriangle size={15} />
              <div>
                <strong>Part of the answer came back unreadable.</strong> What is below is
                what survived; anything the router could not read fell back to rules and
                will mostly say <em>Leave in inbox</em>. Nothing you typed was dropped.
              </div>
            </div>
          )}

          {items && items.length === 0 && (
            <div className="empty">
              {fromChat
                ? 'Nothing was settled in this conversation yet — nothing to file. Keep talking, or say what you want recorded.'
                : 'Nothing to sort in that.'}
            </div>
          )}

          {items && items.length > 0 && (
            <ul className="item-list">
              {items.map((it) => (
                <Row key={it.key} it={it} ctx={meta?.context}
                  onChange={(p) => patch(it.key, p)} />
              ))}
            </ul>
          )}

          {items && error && <Err msg={error} />}
        </div>

        <div className="modal-footer">
          <div className="item-meta">
            {!items
              ? 'Nothing has been written yet.'
              : <>
                  {keeping.length} of {items.length} filing
                  {updating > 0 && <> · {updating} updating something that exists</>}
                  {risky > 0 && <> · <strong style={{ color: 'var(--warn)' }}>{risky} high-impact</strong></>}
                  {unsure > 0 && <> · {unsure} unsure</>}
                </>}
          </div>
          <div className="row-flex">
            {items
              ? <>
                  {!fromChat && <button className="ghost" onClick={reset}>Back</button>}
                  <button onClick={commit} disabled={busy || keeping.length === 0}>
                    {busy ? 'Filing…' : `File ${keeping.length}`}
                  </button>
                </>
              : !fromChat && (
                  <button onClick={propose} disabled={busy || !text.trim()}>
                    <Send size={13} />
                    {busy ? 'Sorting…' : 'Sort this'}
                  </button>
                )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ it, onChange, ctx }) {
  const risky = it.blast >= 3;
  const unsure = it.confidence === 'low';
  const changed = it.destination !== it.proposed;

  return (
    <li style={{
      gap: 12, alignItems: 'flex-start', opacity: it.skip ? 0.45 : 1,
      borderLeft: risky && !it.skip ? '3px solid var(--warn)' : '3px solid transparent',
      paddingLeft: 10,
    }}>
      <input
        type="checkbox"
        checked={!it.skip}
        onChange={(e) => onChange({ skip: !e.target.checked })}
        style={{ width: 18, height: 18, marginTop: 5, flexShrink: 0 }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>{it.text}</div>

        <div className="row-flex" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
          <select
            value={it.destination}
            onChange={(e) => onChange({ destination: e.target.value })}
            style={{ fontWeight: changed ? 600 : 400 }}
          >
            {DESTINATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          {unsure && (
            <span className="badge" title="The router was guessing">
              <HelpCircle size={9} /> unsure
            </span>
          )}
          {it.confidence === 'high' && !changed && (
            <span className="badge ok"><Sparkles size={9} /> confident</span>
          )}
          {changed && <span className="badge exploring">you changed this → learned</span>}
          {risky && !it.skip && (
            <span className="badge danger"><ShieldAlert size={9} /> high impact</span>
          )}
        </div>

        {it.why && <div className="item-meta" style={{ marginTop: 6 }}>{it.why}</div>}

        {it.disagreement && (
          <div className="item-meta" style={{ marginTop: 4, color: 'var(--warn)' }}>
            {it.disagreement} Worth a look.
          </div>
        )}

        {it.dateWarning && !it.skip && (
          <div className="item-meta" style={{ marginTop: 4, color: 'var(--danger)' }}>
            <AlertTriangle size={10} style={{ verticalAlign: -1, marginRight: 4 }} />
            {it.dateWarning}
          </div>
        )}

        {risky && !it.skip && RISK_NOTE[it.destination] && (
          <div className="item-meta" style={{ marginTop: 4, color: 'var(--warn)' }}>
            {RISK_NOTE[it.destination]}
          </div>
        )}

        {it.duplicate && !it.skip && (
          <Duplicate it={it} onChange={onChange} />
        )}

        {!it.skip && <Fields it={it} ctx={ctx} onChange={onChange} />}
      </div>
    </li>
  );
}

/**
 * The same promise, captured twice.
 *
 * Two rows for one obligation is not a cosmetic duplicate — Tier 0 reads both,
 * so delivering once clears half the pressure and the ranker keeps insisting on
 * work that is already done. Offered, never applied: a match found by word
 * overlap is a question, and only a link the router itself made comes
 * pre-selected.
 */
function Duplicate({ it, onChange }) {
  const f = it.fields || {};
  const chosen = f.existing_id === it.duplicate.id;
  const link = () => onChange({ fields: { ...f, existing_id: it.duplicate.id } });

  return (
    <div className="item-meta" style={{ marginTop: 4, color: 'var(--warn)' }}>
      <Copy size={10} style={{ verticalAlign: -1, marginRight: 4 }} />
      {chosen
        ? <>Updating “{it.duplicate.name}” rather than recording it a second time.</>
        : <>
            You already have “{it.duplicate.name}”.{' '}
            <button className="ghost" style={{ padding: '0 6px', fontSize: 12 }} onClick={link}>
              Update that one
            </button>{' '}
            instead of adding a second?
          </>}
    </div>
  );
}

/** Only the fields that matter for where this is actually going. */
function Fields({ it, onChange, ctx }) {
  const f = it.fields || {};
  const set = (k, v) => onChange({ fields: { ...f, [k]: v } });
  const d = it.destination;

  const projects = ctx?.projects || [];
  const commitments = ctx?.commitments || [];
  // What an existing record means depends on where this is going: for a
  // commitment or a project it is the thing to update; for everything else it
  // is the project to hang off.
  const updatable = d === 'commitment' ? commitments : d === 'project' ? projects : [];

  const show = {
    project: projects.length > 0 &&
      ['task', 'commitment', 'dependency', 'idea'].includes(d),
    updatable: updatable.length > 0,
    isNewProject: d === 'project' && !f.existing_id,
    who: d === 'commitment',
    owner: d === 'dependency',
    due: ['commitment', 'task', 'project', 'dependency'].includes(d),
    effort: ['commitment', 'task'].includes(d),
    category: d === 'knowledge',
  };
  if (!Object.values(show).some(Boolean)) return null;

  return (
    <div className="row-flex" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
      {show.isNewProject && (
        <span className="badge exploring" title="A new project. Anything sharing its group is filed against it.">
          <LinkIcon size={9} /> new project “{f.title || f.group || it.text}”
        </span>
      )}
      {show.updatable && (
        <Field label={d === 'project' ? 'record' : 'promise'}>
          <select
            value={f.existing_id || ''}
            onChange={(e) => set('existing_id', e.target.value || undefined)}
            style={{ maxWidth: 220, fontWeight: f.existing_id ? 600 : 400 }}
          >
            <option value="">file as new</option>
            {updatable.map((r) => (
              <option key={r.id} value={r.id}>update: {r.name}</option>
            ))}
          </select>
        </Field>
      )}
      {show.project && (
        <Field label="project">
          <select
            value={f.project_id || ''}
            onChange={(e) => set('project_id', e.target.value || undefined)}
            style={{ maxWidth: 200 }}
          >
            <option value="">
              {f.group ? `with “${f.group}” in this batch` : 'no project'}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
      )}
      {show.who && (
        <Field label="waiting on">
          <input type="text" value={f.waiting_party || ''} placeholder="who"
            onChange={(e) => set('waiting_party', e.target.value)} style={{ width: 120 }} />
        </Field>
      )}
      {show.owner && (
        <Field label="who owes it">
          <input type="text" value={f.owner || ''} placeholder="who"
            onChange={(e) => set('owner', e.target.value)} style={{ width: 120 }} />
        </Field>
      )}
      {show.due && (
        <Field label="due">
          <input type="text" value={f.due_date || ''} placeholder="YYYY-MM-DD"
            onChange={(e) => set('due_date', e.target.value)} style={{ width: 120 }} />
        </Field>
      )}
      {show.effort && (
        <Field label="work left">
          <input type="number" min={0} step={15}
            value={f.effort_remaining_minutes ?? ''} placeholder="min"
            onChange={(e) => set('effort_remaining_minutes', e.target.value === '' ? undefined : +e.target.value)}
            style={{ width: 90 }} />
        </Field>
      )}
      {show.category && (
        <Field label="about">
          <input type="text" value={f.category || ''} placeholder="energy, values…"
            onChange={(e) => set('category', e.target.value)} style={{ width: 140 }} />
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="row-flex" style={{ gap: 6 }}>
      <span className="item-meta">{label}</span>
      {children}
    </div>
  );
}

function Err({ msg }) {
  return (
    <div style={{ color: 'var(--danger)', fontSize: 13, padding: '10px 0' }}>
      <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{msg}
    </div>
  );
}
