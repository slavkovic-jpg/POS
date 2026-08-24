import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Target, ListTodo, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { domainMeta } from '../lib/domains.js';
import { HueScope, SectionHead } from '../components/ui.jsx';
import SectionTabs from '../components/SectionTabs.jsx';
import ConfidenceBar from '../components/ConfidenceBar.jsx';
import { useHashFlash } from '../lib/useHashFlash.js';

/**
 * The strategy scaffold, and the destination for every domain badge in the
 * app. Each domain card carries an id so `/strategy#health` scrolls to it and
 * briefly highlights it — otherwise those badges would be dead links.
 */
export default function StrategyPage() {
  const [s, setS] = useState(null);
  const [stats, setStats] = useState(null);
  const [navStatus, setNavStatus] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    api.strategy.get().then(setS).catch(console.error);
    api.tasks.stats().then(setStats).catch(console.error);
    api.navStatus().then(setNavStatus).catch(console.error);
  }, []);

  useHashFlash(!!s);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 1800);
    return () => clearTimeout(t);
  }, [saved]);

  if (!s) return <div className="empty">Loading strategy…</div>;

  async function save(patch) {
    setS(await api.strategy.update(patch)); setSaved('scaffold');
    api.navStatus().then(setNavStatus).catch(console.error);
  }
  async function saveDomain(key, patch) {
    const updated = await api.strategy.updateDomain(key, patch);
    setS((prev) => ({ ...prev, domains: prev.domains.map((d) => d.key === key ? updated : d) }));
    setSaved(key);
    api.navStatus().then(setNavStatus).catch(console.error);
  }

  const openByDomain = new Map((stats?.by_domain || []).map((d) => [d.key, d]));
  const missingDomainFields = s.domains.filter((d) => !d.current_state?.trim() || !d.desired_state?.trim()).length;

  return (
    <div>
      <div className="page-header">
        <h1><Compass size={22} style={{ color: 'var(--accent)' }} />Strategy scaffold</h1>
        <p>
          The frame everything else is judged against. The decision engine ranks tasks by importance,
          and "important" only means something once this is filled in. Changes save when you click
          away from a field.
        </p>
      </div>

      <SectionTabs sections={[
        { id: 'scaffold', label: 'Mission, identity, vision', icon: Target,
          badge: navStatus && navStatus.strategy.filled < navStatus.strategy.total
            ? { count: navStatus.strategy.filled, total: navStatus.strategy.total, tone: 'warn' }
            : null },
        { id: 'domains', label: 'Life domains', icon: Compass,
          badge: missingDomainFields > 0 ? { count: missingDomainFields, tone: 'warn' } : null },
      ]} />

      <div id="scaffold" className="panel hero">
        <SectionHead icon={Target} title="Mission, identity, vision" />
        <label>Mission</label>
        <textarea defaultValue={s.mission} placeholder="What you're ultimately trying to do."
          onBlur={(e) => save({ mission: e.target.value })} />
        <label>Identity</label>
        <textarea defaultValue={s.identity} placeholder="Who you are when you're at your best."
          onBlur={(e) => save({ identity: e.target.value })} />
        <label>Long-term vision</label>
        <textarea defaultValue={s.long_term_vision} placeholder="Where this is going over years, not weeks."
          onBlur={(e) => save({ long_term_vision: e.target.value })} />
        <label>Values (comma-separated)</label>
        <input type="text" defaultValue={s.values.join(', ')} placeholder="freedom, craft, health, honesty"
          onBlur={(e) => save({ values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} />
        {s.values.length > 0 && (
          <div className="row-flex" style={{ flexWrap: 'wrap', marginTop: 10, gap: 6 }}>
            {s.values.map((v) => <span key={v} className="badge exploring">{v}</span>)}
          </div>
        )}
      </div>

      <div id="domains" className="panel">
        <SectionHead icon={Compass} title="Life domains"
          action={<Link to="/tasks" className="item-meta">See these as tasks →</Link>} />
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
          Priority 1 means this genuinely matters most right now. The dashboard flags any domain you
          rate 1 or 2 that has no tasks pointing at it — that gap between what you say matters and
          what you're actually doing is the most useful thing this scaffold surfaces.
        </p>

        <div className="domain-grid">
          {s.domains.map((d) => {
            const meta = domainMeta(d.key);
            const Icon = meta.icon;
            const load = openByDomain.get(d.key);
            return (
              <HueScope key={d.key} domainKey={d.key} className="domain-card" id={d.key}>
                <h3><Icon size={15} />{meta.label}</h3>

                <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <Link to="/tasks" className="badge" title="Open tasks in this domain">
                    <ListTodo size={10} />{load ? `${load.open_count} open · ${load.open_minutes}m` : '0 open'}
                  </Link>
                  {saved === d.key && (
                    <span className="badge ok"><Check size={10} />saved</span>
                  )}
                </div>

                <label>Current state</label>
                <textarea defaultValue={d.current_state || ''} placeholder="Honestly, where is this now?"
                  onBlur={(e) => saveDomain(d.key, { current_state: e.target.value })} />
                <label>Desired state</label>
                <textarea defaultValue={d.desired_state || ''} placeholder="What would good look like?"
                  onBlur={(e) => saveDomain(d.key, { desired_state: e.target.value })} />

                <div className="row-flex" style={{ marginTop: 10 }}>
                  <label style={{ margin: 0, minWidth: 56 }}>Priority</label>
                  <select defaultValue={d.priority} onChange={(e) => saveDomain(d.key, { priority: +e.target.value })}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}{n === 1 ? ' — highest' : n === 5 ? ' — lowest' : ''}</option>
                    ))}
                  </select>
                </div>
                <ConfidenceBar value={d.confidence} label="Confidence" />
              </HueScope>
            );
          })}
        </div>
      </div>
    </div>
  );
}
