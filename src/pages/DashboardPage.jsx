import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, Target, Zap, Clock, ListTodo, HelpCircle, CalendarCheck,
  Brain, AlertTriangle, ArrowRight, Timer, Layers, Globe, Check,
  Compass, TrendingUp, Inbox, MessageSquare, Battery, Shuffle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ENERGY_META } from '../lib/domains.js';
import { DomainBadge, HueScope, Stat, Callout, SectionHead } from '../components/ui.jsx';
import FocusTimer from '../components/FocusTimer.jsx';
import UnpackModal from '../components/UnpackModal.jsx';
import RouteModal from '../components/RouteModal.jsx';

const TIME_BLOCKS = [15, 30, 60, 120];

/**
 * The command center. Deliberately the only page you need on an ordinary day:
 * set your conditions, get a recommendation, act on it, dump what's on your
 * mind, and see what the rest of the system is waiting on — with a route into
 * the relevant page for anything deeper.
 */
export default function DashboardPage() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [dump, setDump] = useState('');
  const [unpackOpen, setUnpackOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [timerTask, setTimerTask] = useState(null);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try { setD(await api.dashboard()); }
    catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function patchContext(patch) {
    await api.context.set(patch);
    setRec(null);           // conditions changed; the old pick is stale
    refresh();
  }

  async function recommend() {
    setRecLoading(true);
    try { setRec(await api.tasks.recommend()); }
    catch (err) { setToast(err.message); }
    finally { setRecLoading(false); }
  }

  async function completeTask(id) {
    await api.tasks.update(id, { status: 'done' });
    setRec(null); setToast('Done.'); refresh();
  }

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, []);

  if (error) return <Callout tone="danger" icon={AlertTriangle} title="Could not load dashboard">{error}</Callout>;
  if (!d) return <div className="empty">Loading…</div>;

  const energy = ENERGY_META[d.context.energy_state] || {};
  const nudges = buildNudges(d);

  return (
    <div>
      <div className="page-header">
        <h1><Sparkles size={22} style={{ color: 'var(--accent)' }} />
          {greeting}{d.profile.name ? `, ${d.profile.name.split(' ')[0]}` : ''}
        </h1>
        <p>
          {d.tasks.doable_count > 0
            ? `${d.tasks.doable_count} thing${d.tasks.doable_count === 1 ? '' : 's'} you could actually do in ${d.context.available_minutes} minutes at ${energy.short?.toLowerCase()} energy.`
            : d.tasks.total_open > 0
              ? `Nothing on your list fits ${d.context.available_minutes} minutes at ${energy.short?.toLowerCase()} energy. Widen the window or lower the bar.`
              : 'Nothing on your list yet. Dump whatever is on your mind below.'}
        </p>
      </div>

      {nudges.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          {nudges.map((n) => (
            <Callout key={n.key} tone={n.tone} icon={n.icon} title={n.title}>
              {n.body}{' '}
              <Link to={n.to} style={{ fontWeight: 550 }}>{n.cta} →</Link>
            </Callout>
          ))}
        </div>
      )}

      {/* ---- Conditions + decision engine ---- */}
      <div className="grid-2">
        <div className="panel">
          <SectionHead icon={Zap} title="Right now" />
          <label>Energy</label>
          <div className="segmented">
            {Object.entries(d.context.energy_states || {}).map(([key, val]) => {
              const meta = ENERGY_META[key] || {};
              return (
                <button
                  key={key}
                  className={`seg hue-${meta.hue}` + (d.context.energy_state === key ? ' active hue-tinted' : '')}
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
              <button key={m}
                className={'seg' + (d.context.available_minutes === m ? ' active' : '')}
                onClick={() => patchContext({ available_minutes: m })}>
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
          </div>

          <div className="item-meta" style={{ marginTop: 12 }}>
            {d.context.energy_states?.[d.context.energy_state]?.description}
          </div>
          <div className="item-meta" style={{ marginTop: 8 }}>
            {d.tasks.blocked_count > 0 && `${d.tasks.blocked_count} task${d.tasks.blocked_count === 1 ? " doesn't" : "s don't"} fit these conditions. `}
            Everything else in the app reads this.
          </div>
        </div>

        <div className="panel hero">
          <SectionHead icon={Target} title="What should I do now?"
            action={<button onClick={recommend} disabled={recLoading}>
              {recLoading ? 'Deciding…' : rec ? 'Re-evaluate' : 'Decide'}
            </button>} />

          {!rec && (
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: 13 }}>
              One task, picked for the energy and window on the left — with the reasoning, so you
              can disagree with it.
            </p>
          )}

          {rec?.empty && <div className="empty">{rec.reason}</div>}

          {rec?.tier === 'commitment_at_risk' && (
            <Callout tone="danger" icon={AlertTriangle} title="A promise is at risk">
              {rec.tier_reason}
            </Callout>
          )}
          {rec?.tier === 'burnout_guard' && (
            <Callout tone="warn" icon={Battery} title="Recovery first">
              {rec.tier_reason}
            </Callout>
          )}

          {rec?.task && (
            <HueScope domainKey={rec.task.domainKey}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 7 }}>{rec.task.title}</div>
              <div className="row-flex" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
                {rec.task.domainKey && <DomainBadge domainKey={rec.task.domainKey} />}
                {rec.task.effortMinutes != null && (
                  <span className="badge"><Clock size={11} />{rec.task.effortMinutes}m</span>
                )}
                {rec.task.slack?.band === 'critical' && (
                  <span className="badge danger"><AlertTriangle size={11} />cannot be finished in time</span>
                )}
                {rec.task.incomeImpact > 0 && <span className="badge ok">income</span>}
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
                <strong style={{ color: 'var(--accent)' }}>Why: </strong>{rec.reasoning}
              </div>
              {rec.mindset_primer && (
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, fontStyle: 'italic' }}>
                  <strong style={{ color: 'var(--success)', fontStyle: 'normal' }}>Before you start: </strong>
                  {rec.mindset_primer}
                </div>
              )}
              {!rec.explained && (
                <div className="item-meta">
                  Scored locally. The ranking is exactly as it would be with a model connected —
                  only the wording is unpolished.
                </div>
              )}

              <div className="row-flex" style={{ flexWrap: 'wrap' }}>
                <button onClick={() => setTimerTask(rec.task)}><Timer size={13} />Start focus block</button>
                <button className="ghost" onClick={() => completeTask(rec.task.id)}><Check size={13} />Done</button>
                <Link to="/tasks" className="badge" style={{ padding: '7px 11px' }}>Open in Tasks <ArrowRight size={11} /></Link>
              </div>
            </HueScope>
          )}
        </div>
      </div>

      {/* ---- Capture ---- */}
      <div className="panel">
        <SectionHead icon={Inbox} title="Get it out of your head"
          action={<Link to="/copilot" className="badge" style={{ padding: '6px 11px' }}>
            <MessageSquare size={11} />Talk instead
          </Link>} />
        <textarea rows={2} value={dump} onChange={(e) => setDump(e.target.value)}
          placeholder="Write it messy — several things at once is fine. Tasks, promises, ideas, questions, things about you. It gets sorted, and nothing is saved until you agree." />
        <div className="row-flex" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={() => setUnpackOpen(true)} disabled={!dump.trim()}>
            <Sparkles size={13} />Tasks only
          </button>
          <button onClick={() => setRouteOpen(true)} disabled={!dump.trim()}>
            <Shuffle size={13} />Sort it
          </button>
        </div>
      </div>

      {/* ---- Doable now + open questions ---- */}
      <div className="grid-2">
        <div className="panel">
          <SectionHead icon={ListTodo} title={`Fits right now (${d.tasks.doable_count})`}
            action={<Link to="/tasks" className="item-meta">All tasks →</Link>} />
          {d.tasks.doable.length === 0 ? (
            <div className="empty">
              Nothing fits these conditions.{' '}
              {d.tasks.total_open > 0
                ? 'Try a longer window, or break something big into steps on the '
                : 'Add something with the box above, or on the '}
              <Link to="/tasks">Tasks page</Link>.
            </div>
          ) : (
            <div>
              {d.tasks.doable.map((t) => (
                <HueScope key={t.id} domainKey={t.domainKey} className="task-card">
                  <div className="row-flex" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 520 }}>{t.title}</div>
                      <div className="row-flex" style={{ marginTop: 5, flexWrap: 'wrap', gap: 6 }}>
                        {t.domainKey && <DomainBadge domainKey={t.domainKey} size="sm" />}
                        {t.effortMinutes != null && <span className="item-meta">{t.effortMinutes}m</span>}
                        {t.suppressed && <span className="badge awaiting">held back</span>}
                      </div>
                      {t.reasons?.[0] && (
                        <div className="item-meta" style={{ marginTop: 5 }}>{t.reasons[0]}</div>
                      )}
                    </div>
                    <div className="row-flex" style={{ gap: 5 }}>
                      <button className="ghost sm" onClick={() => setTimerTask(t)} title="Start a focus block"><Timer size={12} /></button>
                      <button className="ghost sm" onClick={() => completeTask(t.id)} title="Mark done"><Check size={12} /></button>
                    </div>
                  </div>
                </HueScope>
              ))}
            </div>
          )}

          {d.tasks.procrastinating.length > 0 && (
            <>
              <h3>Avoided repeatedly</h3>
              {d.tasks.procrastinating.map((t) => (
                <div key={t.id} className="row-flex" style={{ justifyContent: 'space-between', padding: '5px 0' }}>
                  <span style={{ fontSize: 13 }}>{t.title}</span>
                  <span className="badge awaiting">{t.deferred_count}×</span>
                </div>
              ))}
              <div className="item-meta" style={{ marginTop: 6 }}>
                Breaking one into steps on the <Link to="/tasks">Tasks page</Link> is usually what unsticks it.
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <SectionHead icon={HelpCircle} title={`Open questions (${d.questions.open_count})`}
            action={<Link to="/questions" className="item-meta">All →</Link>} />
          {d.questions.open.length === 0 ? (
            <div className="empty">
              None open. They accumulate as you talk — <Link to="/copilot">Copilot</Link> captures them.
            </div>
          ) : (
            <ul className="item-list">
              {d.questions.open.map((q) => (
                <li key={q.id}>
                  <div>
                    <div className="item-title" style={{ fontSize: 13.5 }}>{q.question}</div>
                    <div className="item-meta">
                      <span className={`badge ${q.status}`}>{q.status}</span>
                      {' '}importance {q.strategic_importance}
                      {q.review_date && ` · review ${q.review_date}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- Life balance ---- */}
      <div className="panel">
        <SectionHead icon={Compass} title="Life balance"
          action={<Link to="/strategy" className="item-meta">Strategy scaffold →</Link>} />
        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <Stat label="Open" value={d.stats.totals.open_count} icon={ListTodo} />
          <Stat label="Committed" value={`${Math.round(d.stats.totals.open_minutes / 6) / 10}h`} icon={Clock} />
          <Stat label="Done" value={d.stats.totals.done_count} icon={Check} tone="ok" />
          <Stat label="High dread" value={d.stats.totals.high_dread} icon={AlertTriangle}
            tone={d.stats.totals.high_dread > 0 ? 'warn' : 'muted'} />
          <Stat label="Knowledge" value={d.knowledge_count} icon={Brain} tone="muted" />
        </div>

        <div style={{ display: 'grid', gap: 9 }}>
          {d.stats.by_domain.map((dom) => {
            const max = Math.max(1, ...d.stats.by_domain.map((x) => x.open_minutes));
            return (
              <HueScope key={dom.key} domainKey={dom.key}>
                <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                  <DomainBadge domainKey={dom.key} size="sm" />
                  <span className="item-meta">{dom.open_count} open · {dom.open_minutes}m</span>
                </div>
                <div className="confidence-bar-track">
                  <div className="confidence-bar-fill domain" style={{ width: `${(dom.open_minutes / max) * 100}%` }} />
                </div>
              </HueScope>
            );
          })}
        </div>
      </div>

      <UnpackModal open={unpackOpen} text={dump} onClose={() => setUnpackOpen(false)}
        onSaved={(n) => { setDump(''); setToast(`Added ${n} task${n === 1 ? '' : 's'}.`); refresh(); }} />
      <RouteModal open={routeOpen} initialText={dump} onClose={() => setRouteOpen(false)}
        onFiled={(r) => { setDump(''); setToast(filedToast(r)); refresh(); }} />
      {timerTask && (
        <FocusTimer task={timerTask} onClose={() => setTimerTask(null)}
          onComplete={async () => { await completeTask(timerTask.id); setTimerTask(null); }} />
      )}
      {toast && <div className="toast"><Check size={14} style={{ color: 'var(--success)' }} />{toast}</div>}
    </div>
  );
}

/**
 * Cross-page nudges. Each one is something only the dashboard can notice,
 * because it needs data from two places at once.
 */
function buildNudges(d) {
  const out = [];

  if (!d.profile.onboarded) {
    out.push({
      key: 'onboard', tone: 'warn', icon: Sparkles,
      title: 'The system barely knows you yet',
      body: 'Recommendations get sharper once your strategy and background are in.',
      to: '/onboarding', cta: 'Start onboarding',
    });
  } else if (!d.strategy.has_scaffold) {
    out.push({
      key: 'scaffold', tone: 'warn', icon: Compass,
      title: 'No mission or vision set',
      body: 'Without it, "important" is guesswork — the decision engine has nothing to rank against.',
      to: '/strategy', cta: 'Fill in the scaffold',
    });
  }

  if (d.questions.due.length) {
    out.push({
      key: 'due-q', tone: 'warn', icon: HelpCircle,
      title: `${d.questions.due.length} question${d.questions.due.length === 1 ? '' : 's'} due for review`,
      body: 'You set a date to come back to these, and it has arrived.',
      to: '/questions', cta: 'Review them',
    });
  }

  if (d.decisions_to_review.length) {
    out.push({
      key: 'dec', tone: 'warn', icon: CalendarCheck,
      title: `${d.decisions_to_review.length} decision${d.decisions_to_review.length === 1 ? '' : 's'} ready to score`,
      body: 'Recording what actually happened is what makes the journal worth keeping.',
      to: '/decisions', cta: 'Score them',
    });
  }

  if (d.review.overdue && d.tasks.total_open > 0) {
    out.push({
      key: 'review', tone: 'warn', icon: TrendingUp,
      title: d.review.days_since === null ? 'No review yet' : `${d.review.days_since} days since your last review`,
      body: 'A weekly review drafts itself from what you actually did.',
      to: '/reviews', cta: 'Run one',
    });
  }

  for (const dom of d.neglected_domains.slice(0, 2)) {
    out.push({
      key: `neg-${dom.key}`, tone: 'warn', icon: AlertTriangle,
      title: `${dom.name} is priority ${dom.priority} with nothing on the list`,
      body: 'You rated this among the things that matter most, but no task points at it.',
      to: '/tasks', cta: 'Add something',
    });
  }

  return out.slice(0, 3);
}

/** "Filed 5: 2 tasks, 1 commitment, 2 ideas" — say where things actually went. */
function filedToast(result) {
  const written = result?.written || [];
  if (!written.length) return 'Nothing filed.';
  const counts = {};
  for (const w of written) counts[w.destination] = (counts[w.destination] || 0) + 1;
  const names = {
    task: 'task', commitment: 'commitment', project: 'project', idea: 'idea',
    knowledge: 'knowledge note', open_question: 'open question',
    decision: 'decision', health_signal: 'health signal', unclear: 'left in inbox',
  };
  const parts = Object.entries(counts).map(([k, n]) =>
    k === 'unclear' ? `${n} left in inbox` : `${n} ${names[k]}${n === 1 ? '' : 's'}`);
  return `Filed ${written.length}: ${parts.join(', ')}.`;
}
