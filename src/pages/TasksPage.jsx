import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ListTodo, Sparkles, Target, Zap, Timer, Layers, Globe, Check,
  Clock, AlertTriangle, ChevronDown, ChevronUp, Trash2, ExternalLink,
  Inbox, Compass,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ENERGY_META, domainMeta } from '../lib/domains.js';
import { DomainBadge, HueScope, Stat, SectionHead, Callout } from '../components/ui.jsx';
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

  const [config, setConfig] = useState(null);

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
    api.config().then(setConfig).catch(console.error);
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
        <h1><ListTodo size={22} style={{ color: 'var(--accent)' }} />Tasks</h1>
        <p>
          Scored, not just listed. What surfaces depends on the energy and time you actually have —
          set those on the <Link to="/dashboard">dashboard</Link> or below. Each task carries three
          actions for the three reasons work stalls: you can't start it, it's too big, or you don't
          know enough yet.
        </p>
      </div>

      {/* Brain dump */}
      <div className="panel">
        <h2><Inbox size={15} />Brain dump</h2>
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
          <button onClick={() => setUnpackOpen(true)} disabled={!dump.trim()}><Sparkles size={13} />Unpack</button>
        </div>
      </div>

      {/* Current conditions */}
      <div className="panel">
        <h2><Zap size={15} />Current conditions</h2>
        <label>Energy right now</label>
        <div className="segmented">
          {energyStates.map(([key, val]) => {
            const meta = ENERGY_META[key] || {};
            return (
              <button
                key={key}
                className={`seg hue-${meta.hue}` + (ctx.energy_state === key ? ' active hue-tinted' : '')}
                onClick={() => patchContext({ energy_state: key })}
                title={val.description}
              >
                {meta.short || val.label}
              </button>
            );
          })}
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
          <h2 style={{ margin: 0 }}><Target size={15} />What should I do now?</h2>
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
            {domains.map((d) => {
              const meta = domainMeta(d.key);
              return (
                <button key={d.key}
                  className={`pill hue-${meta.hue}` + (filter === d.key ? ' active hue-tinted' : '')}
                  onClick={() => setFilter(d.key)}>{meta.label}</button>
              );
            })}
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
                groundingAvailable={!!config?.grounding_available}
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
/**
 * The three-action pattern from the Canvas prototype: Timer, Sub-steps, Ground
 * Web. They map onto the three reasons a task stalls — you can't start, it's
 * too big, or you don't know enough yet.
 */
function TaskCard({ task, onChanged, onTimer, onToast, groundingAvailable }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [breaking, setBreaking] = useState(false);
  const [grounding, setGrounding] = useState(false);
  const done = task.status === 'done';

  const subtasks = detail?.subtasks ?? null;
  const research = detail?.grounding ?? null;

  async function loadDetail() {
    setDetail(await api.tasks.get(task.id));
  }

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && detail === null) await loadDetail();
  }

  async function breakdown() {
    setBreaking(true);
    try {
      const r = await api.tasks.breakdown(task.id);
      setDetail((d) => ({ ...(d || {}), subtasks: r.subtasks }));
      setExpanded(true);
      onToast?.(`Broke into ${r.subtasks.length} steps.`);
      onChanged();
    } catch (err) {
      onToast?.(`Breakdown failed: ${err.message}`);
    } finally { setBreaking(false); }
  }

  async function ground() {
    setGrounding(true);
    try {
      const r = await api.tasks.ground(task.id);
      setDetail((d) => ({ ...(d || {}), grounding: r }));
      setExpanded(true);
      onToast?.('Fetched web research.');
    } catch (err) {
      onToast?.(err.message);
    } finally { setGrounding(false); }
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
    <HueScope domainKey={task.domain_key} className={'task-card' + (done ? ' done' : '')}>
      <div className="row-flex" style={{ alignItems: 'flex-start', gap: 12 }}>
        <input type="checkbox" checked={done} onChange={toggleStatus}
          style={{ width: 17, height: 17, marginTop: 3, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 520, textDecoration: done ? 'line-through' : 'none' }}>
            {task.title}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {task.domain_key && <DomainBadge domainKey={task.domain_key} size="sm" />}
            {task.time_minutes != null && <span className="badge"><Clock size={10} />{task.time_minutes}m</span>}
            {task.strategic_importance != null && (
              <span className="badge">importance {task.strategic_importance}</span>
            )}
            {task.energy_required != null && (
              <span className="badge"><Zap size={10} />{task.energy_required}/5</span>
            )}
            {task.anxiety_level >= 4 && <span className="badge awaiting"><AlertTriangle size={10} />high dread</span>}
            {task.deferred_count >= 2 && <span className="badge awaiting">deferred {task.deferred_count}×</span>}
            {task.subtask_total > 0 && (
              <span className="badge"><Layers size={10} />{task.subtask_done}/{task.subtask_total}</span>
            )}
            {task.grounding_json && <span className="badge"><Globe size={10} />researched</span>}
          </div>
          {task.rationale && <div className="task-rationale">{task.rationale}</div>}
        </div>

        {/* Timer → Sub-steps → Ground Web */}
        <div className="row-flex" style={{ flexShrink: 0, gap: 5 }}>
          {!done && (
            <button className="ghost sm" onClick={onTimer} title="Start a focus block sized to this task">
              <Timer size={13} /><span className="btn-label">Timer</span>
            </button>
          )}
          <button className="ghost sm" onClick={breakdown} disabled={breaking}
            title="Break into steps you can start in under a minute">
            <Layers size={13} /><span className="btn-label">{breaking ? '…' : 'Sub-steps'}</span>
          </button>
          <button className="ghost sm" onClick={ground} disabled={grounding || !groundingAvailable}
            title={groundingAvailable
              ? 'Search the web for current guidance on this task'
              : 'Needs Claude or Gemini — a local model has no web access'}>
            <Globe size={13} /><span className="btn-label">{grounding ? '…' : 'Ground'}</span>
          </button>
          <button className="ghost sm" onClick={toggleExpand}>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--border)' }}>
          {detail === null && <div className="item-meta">Loading…</div>}

          {subtasks?.length === 0 && !research && (
            <div className="item-meta">
              Nothing here yet. <strong>Sub-steps</strong> splits this into actions you can start in
              under a minute; <strong>Ground</strong> searches the web for current guidance.
            </div>
          )}

          {subtasks?.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}><Layers size={11} style={{ verticalAlign: -1 }} /> Sub-steps</h3>
              <ul className="item-list" style={{ marginBottom: 12 }}>
                {subtasks.map((s) => (
                  <li key={s.id} style={{ padding: '5px 0', borderBottom: 'none' }}>
                    <label className="row-flex" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={!!s.done}
                        onChange={async () => {
                          await api.tasks.toggleSubtask(s.id);
                          await loadDetail();
                          onChanged();
                        }}
                        style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }} />
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
            </>
          )}

          {research && (
            <div style={{
              background: 'var(--bg-panel)', border: '1px solid rgba(52,211,153,0.28)',
              borderRadius: 'var(--radius-sm)', padding: 13, marginBottom: 12,
            }}>
              <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 7 }}>
                <span style={{
                  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.09em',
                  fontWeight: 650, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Globe size={12} />Web research
                </span>
                <span className="item-meta">{research.source} · {research.fetched_at?.slice(0, 10)}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)' }}>{research.summary}</div>
              {research.sources?.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
                  <div className="item-meta" style={{ marginBottom: 6 }}>Sources</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {research.sources.map((s, i) => (
                      <a key={i} href={s.url} target="_blank" rel="noreferrer" className="badge exploring"
                        style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.title}<ExternalLink size={9} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="row-flex" style={{ gap: 6 }}>
            {!done && <button className="ghost sm" onClick={defer}>Defer</button>}
            <button className="ghost sm danger-text" onClick={remove}><Trash2 size={12} />Delete</button>
          </div>
        </div>
      )}
    </HueScope>
  );
}

// ---- Cognitive load ------------------------------------------------------
function CognitiveLoad({ stats }) {
  const { totals, by_domain } = stats;
  const maxMinutes = Math.max(1, ...by_domain.map((d) => d.open_minutes));

  return (
    <div className="panel">
      <h2><Compass size={15} />Cognitive load</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 20 }}>
        <Metric label="Open" value={totals.open_count} />
        <Metric label="Committed time" value={`${Math.round(totals.open_minutes / 60 * 10) / 10}h`} />
        <Metric label="Completed" value={totals.done_count} accent="var(--success)" />
        <Metric label="High dread" value={totals.high_dread} accent={totals.high_dread > 0 ? 'var(--warn)' : undefined} />
      </div>

      <h3>Open time by life domain</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {by_domain.map((d) => (
          <HueScope key={d.key} domainKey={d.key}>
            <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
              <DomainBadge domainKey={d.key} size="sm" />
              <span className="item-meta">{d.open_count} open · {d.open_minutes}m</span>
            </div>
            <div className="confidence-bar-track">
              <div className="confidence-bar-fill domain" style={{ width: `${(d.open_minutes / maxMinutes) * 100}%` }} />
            </div>
          </HueScope>
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
