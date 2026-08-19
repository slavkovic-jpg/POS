import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import FocusTimer from '../components/FocusTimer.jsx';
import UnpackModal from '../components/UnpackModal.jsx';

const TIME_BLOCKS = [15, 30, 60, 120];

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [domains, setDomains] = useState([]);
  const [ctx, setCtx] = useState(null);
  const [filter, setFilter] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [stats, setStats] = useState(null);

  const [dump, setDump] = useState('');
  const [unpackOpen, setUnpackOpen] = useState(false);

  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState(null);

  const [timerTask, setTimerTask] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function refresh() {
    const [t, c, s] = await Promise.all([
      api.tasks.list(showDone ? { all: 'true' } : {}),
      api.context.get(),
      api.tasks.stats(),
    ]);
    setTasks(t);
    setCtx(c);
    setStats(s);
  }

  useEffect(() => {
    api.strategy.get().then((s) => setDomains(s.domains)).catch(console.error);
  }, []);
  useEffect(() => { refresh().catch(console.error); }, [showDone]);

  async function patchContext(patch) {
    setCtx(await api.context.set(patch));
    setRec(null); // conditions changed — the old recommendation is stale
  }

  async function recommend() {
    setRecLoading(true); setRecError(null);
    try {
      setRec(await api.tasks.recommend());
    } catch (err) {
      setRecError(err.message);
    } finally { setRecLoading(false); }
  }

  const visible = useMemo(
    () => tasks.filter((t) => !filter || t.domain_key === filter),
    [tasks, filter]
  );

  if (!ctx) return <div className="empty">Loading…</div>;

  const energyStates = Object.entries(ctx.energy_states || {});

  return (
    <div>
      <div className="page-header">
        <h1>Tasks</h1>
        <p>
          Scored, not just listed. What surfaces depends on the energy you actually have and the
          time you actually have — not on what would be ideal.
        </p>
      </div>

      {/* Brain dump */}
      <div className="panel">
        <h2>Brain dump</h2>
        <p style={{ color: 'var(--text-dim)', margin: '0 0 10px' }}>
          Write it messy. One dump can contain several tasks — they get pulled apart, scored, and
          shown to you for approval before anything is saved.
        </p>
        <textarea
          rows={3}
          value={dump}
          onChange={(e) => setDump(e.target.value)}
          placeholder="Stressed about the Q3 deck, back is tight again, need to reply to the London email, should really book the dentist…"
        />
        <div className="row-flex" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => setUnpackOpen(true)} disabled={!dump.trim()}>Unpack</button>
        </div>
      </div>

      {/* Current conditions */}
      <div className="panel">
        <h2>Current conditions</h2>
        <label>Energy right now</label>
        <div className="segmented">
          {energyStates.map(([key, val]) => (
            <button
              key={key}
              className={'seg' + (ctx.energy_state === key ? ' active' : '')}
              onClick={() => patchContext({ energy_state: key })}
              title={val.description}
            >
              {val.label}
            </button>
          ))}
        </div>

        <label style={{ marginTop: 14 }}>Time available</label>
        <div className="segmented">
          {TIME_BLOCKS.map((m) => (
            <button
              key={m}
              className={'seg' + (ctx.available_minutes === m ? ' active' : '')}
              onClick={() => patchContext({ available_minutes: m })}
            >
              {m < 60 ? `${m}m` : `${m / 60}h`}
            </button>
          ))}
        </div>

        <div className="item-meta" style={{ marginTop: 12 }}>
          {ctx.energy_states?.[ctx.energy_state]?.description}
        </div>
      </div>

      {/* Decision engine */}
      <div className="panel" style={{ borderColor: rec ? 'var(--accent)' : 'var(--border)' }}>
        <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>What should I do now?</h2>
          <button onClick={recommend} disabled={recLoading}>
            {recLoading ? 'Deciding… (1–3 min on Ollama)' : rec ? 'Re-evaluate' : 'Decide'}
          </button>
        </div>

        {recError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{recError}</div>}

        {!rec && !recError && (
          <p style={{ color: 'var(--text-dim)', margin: 0 }}>
            One task, chosen for the energy and window above — with the reasoning, so you can
            disagree with it.
          </p>
        )}

        {rec?.empty && <div className="empty">{rec.reason}</div>}

        {rec?.task && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
            <div className="row-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{rec.task.title}</div>
                <div className="item-meta">
                  {rec.task.domain_key && <span className="badge">{rec.task.domain_key}</span>}
                  {rec.task.time_minutes != null && <span> · {rec.task.time_minutes}m</span>}
                  {rec.task.strategic_importance != null && <span> · importance {rec.task.strategic_importance}</span>}
                </div>
              </div>
              <div className="row-flex">
                <button className="ghost" onClick={() => setTimerTask(rec.task)}>Start focus block</button>
                <button onClick={async () => {
                  await api.tasks.update(rec.task.id, { status: 'done' });
                  setRec(null); setToast('Task completed.'); refresh();
                }}>Done</button>
              </div>
            </div>

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: 'var(--accent)' }}>Why this: </strong>
                <span style={{ color: 'var(--text-dim)' }}>{rec.reasoning}</span>
              </div>
              {rec.mindset_primer && (
                <div style={{ fontSize: 13 }}>
                  <strong style={{ color: 'var(--success)' }}>Before you start: </strong>
                  <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{rec.mindset_primer}</span>
                </div>
              )}
              {rec.deferred_note && (
                <div style={{ fontSize: 13 }}>
                  <strong style={{ color: 'var(--warn)' }}>Consciously set aside: </strong>
                  <span style={{ color: 'var(--text-dim)' }}>{rec.deferred_note}</span>
                </div>
              )}
              {rec.runner_up && (
                <div className="item-meta">Runner-up: {rec.runner_up.title}</div>
              )}
              {rec.fallback_used && (
                <div className="item-meta" style={{ color: 'var(--warn)' }}>
                  Local scoring used — {rec.fallback_reason}.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Task list */}
      <div className="panel">
        <div className="row-flex" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>
            {showDone ? 'All tasks' : 'Open tasks'} ({visible.length})
          </h2>
          <div className="row-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button className={'pill' + (filter === '' ? ' active' : '')} onClick={() => setFilter('')}>All</button>
            {domains.map((d) => (
              <button key={d.key} className={'pill' + (filter === d.key ? ' active' : '')}
                onClick={() => setFilter(d.key)}>{d.name}</button>
            ))}
            <button className={'pill' + (showDone ? ' active' : '')} onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hiding none' : 'Show done'}
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="empty">Nothing here. Dump a thought above to populate this.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {visible.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                onChanged={refresh}
                onTimer={() => setTimerTask(t)}
                onToast={setToast}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cognitive load */}
      {stats && <CognitiveLoad stats={stats} />}

      <UnpackModal
        open={unpackOpen}
        text={dump}
        onClose={() => setUnpackOpen(false)}
        onSaved={(n) => { setDump(''); setToast(`Added ${n} task${n === 1 ? '' : 's'}.`); refresh(); }}
      />
      {timerTask && (
        <FocusTimer
          task={timerTask}
          onClose={() => setTimerTask(null)}
          onComplete={async () => {
            await api.tasks.update(timerTask.id, { status: 'done' });
            setTimerTask(null); setRec(null); setToast('Focus block complete.'); refresh();
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ---- Task card -----------------------------------------------------------
function TaskCard({ task, onChanged, onTimer, onToast }) {
  const [expanded, setExpanded] = useState(false);
  const [subtasks, setSubtasks] = useState(null);
  const [breaking, setBreaking] = useState(false);
  const done = task.status === 'done';

  async function loadSubtasks() {
    const full = await api.tasks.get(task.id);
    setSubtasks(full.subtasks || []);
  }

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && subtasks === null) await loadSubtasks();
  }

  async function breakdown() {
    setBreaking(true);
    try {
      const r = await api.tasks.breakdown(task.id);
      setSubtasks(r.subtasks);
      setExpanded(true);
      onToast?.(`Broke into ${r.subtasks.length} steps.`);
      onChanged();
    } catch (err) {
      onToast?.(`Breakdown failed: ${err.message}`);
    } finally { setBreaking(false); }
  }

  async function toggleStatus() {
    await api.tasks.update(task.id, { status: done ? 'open' : 'done' });
    onChanged();
  }

  async function defer() {
    await api.tasks.update(task.id, { status: 'deferred' });
    onToast?.('Deferred — the count is tracked.');
    onChanged();
  }

  async function remove() {
    await api.tasks.remove(task.id);
    onToast?.('Task deleted.');
    onChanged();
  }

  return (
    <div className={'task-card' + (done ? ' done' : '')}>
      <div className="row-flex" style={{ alignItems: 'flex-start', gap: 12 }}>
        <input type="checkbox" checked={done} onChange={toggleStatus}
          style={{ width: 18, height: 18, marginTop: 3, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, textDecoration: done ? 'line-through' : 'none' }}>
            {task.title}
          </div>
          <div className="item-meta" style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {task.domain_key && <span className="badge">{task.domain_key}</span>}
            {task.time_minutes != null && <span>{task.time_minutes}m</span>}
            {task.strategic_importance != null && <span>· importance {task.strategic_importance}</span>}
            {task.energy_required != null && <span>· energy {task.energy_required}/5</span>}
            {task.anxiety_level >= 4 && <span className="badge awaiting">high dread</span>}
            {task.deferred_count >= 2 && <span className="badge awaiting">deferred {task.deferred_count}×</span>}
            {task.subtask_total > 0 && <span>· {task.subtask_done}/{task.subtask_total} steps</span>}
          </div>
          {task.rationale && (
            <div className="task-rationale">{task.rationale}</div>
          )}
        </div>

        <div className="row-flex" style={{ flexShrink: 0, gap: 6 }}>
          {!done && <button className="ghost" onClick={onTimer}>Timer</button>}
          <button className="ghost" onClick={breakdown} disabled={breaking}>
            {breaking ? '…' : 'Break down'}
          </button>
          <button className="ghost" onClick={toggleExpand}>{expanded ? '▲' : '▼'}</button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {subtasks === null && <div className="item-meta">Loading steps…</div>}
          {subtasks?.length === 0 && (
            <div className="item-meta">
              No steps yet. "Break down" splits this into things you can start in under a minute.
            </div>
          )}
          {subtasks?.length > 0 && (
            <ul className="item-list" style={{ marginBottom: 8 }}>
              {subtasks.map((s) => (
                <li key={s.id} style={{ padding: '6px 0', borderBottom: 'none' }}>
                  <label className="row-flex" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={!!s.done}
                      onChange={async () => {
                        await api.tasks.toggleSubtask(s.id);
                        await loadSubtasks();
                        onChanged();
                      }}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <span style={{
                      textDecoration: s.done ? 'line-through' : 'none',
                      color: s.done ? 'var(--text-faint)' : 'var(--text)',
                      fontSize: 13,
                    }}>
                      {s.text} <span className="item-meta">({s.est_minutes}m)</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="row-flex" style={{ gap: 6 }}>
            {!done && <button className="ghost" onClick={defer}>Defer</button>}
            <button className="ghost danger-text" onClick={remove}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Cognitive load ------------------------------------------------------
function CognitiveLoad({ stats }) {
  const { totals, by_domain } = stats;
  const maxMinutes = Math.max(1, ...by_domain.map((d) => d.open_minutes));

  return (
    <div className="panel">
      <h2>Cognitive load</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 20 }}>
        <Metric label="Open" value={totals.open_count} />
        <Metric label="Committed time" value={`${Math.round(totals.open_minutes / 60 * 10) / 10}h`} />
        <Metric label="Completed" value={totals.done_count} accent="var(--success)" />
        <Metric label="High dread" value={totals.high_dread} accent={totals.high_dread > 0 ? 'var(--warn)' : undefined} />
      </div>

      <h3>Open time by life domain</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {by_domain.map((d) => (
          <div key={d.key}>
            <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>{d.name}</span>
              <span className="item-meta">{d.open_count} open · {d.open_minutes}m</span>
            </div>
            <div className="confidence-bar-track">
              <div className="confidence-bar-fill" style={{ width: `${(d.open_minutes / maxMinutes) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="item-meta" style={{ marginTop: 12 }}>
        A domain at zero is not necessarily a problem — but if it's one you rated high priority in
        your strategy scaffold, that gap is worth a look.
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
      <div className="item-meta" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: 'var(--mono)', color: accent || 'var(--accent-strong)' }}>{value}</div>
    </div>
  );
}
