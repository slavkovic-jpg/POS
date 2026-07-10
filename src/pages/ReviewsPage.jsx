import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const SECTIONS = [
  { key: 'achievements', label: 'Achievements' },
  { key: 'failures', label: 'Failures & slips' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'energy_notes', label: 'Energy & engagement' },
  { key: 'burnout_indicators', label: 'Burnout indicators' },
  { key: 'next_period_recommendations', label: 'Recommendations for next period' },
];

export default function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activity, setActivity] = useState(null);
  const [starting, setStarting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    const list = await api.reviews.list();
    setReviews(list);
    if (list.length && selectedId == null) select(list[0].id);
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function select(id) {
    setSelectedId(id);
    setError(null);
    try {
      const act = await api.reviews.activity(id);
      setActivity(act);
    } catch (err) {
      setActivity(null);
      console.error(err);
    }
  }

  async function start(kind) {
    setStarting(true); setError(null);
    try {
      const r = await api.reviews.start(kind);
      await refresh();
      await select(r.id);
    } finally { setStarting(false); }
  }

  async function generate() {
    if (!selectedId) return;
    setGenerating(true); setError(null);
    try {
      await api.reviews.generate(selectedId);
      await refresh();
      await select(selectedId);
    } catch (err) {
      setError(err.message);
    } finally { setGenerating(false); }
  }

  const selected = reviews.find((r) => r.id === selectedId);

  return (
    <div>
      <div className="page-header">
        <h1>Reviews</h1>
        <p>
          Structured weekly and monthly reviews. Achievements, failures, lessons, and next-period recommendations —
          drafted from your actual activity, then edited by you.
        </p>
      </div>

      <div className="panel">
        <h2>Start a new review</h2>
        <div className="row-flex">
          <button onClick={() => start('weekly')} disabled={starting}>Weekly review (last 7 days)</button>
          <button onClick={() => start('monthly')} disabled={starting} className="ghost">Monthly (last 30 days)</button>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'flex-start' }}>
        {/* Left: list of reviews */}
        <div className="panel">
          <h2>Past reviews</h2>
          {reviews.length === 0 ? (
            <div className="empty">No reviews yet — start one above.</div>
          ) : (
            <ul className="item-list">
              {reviews.map((r) => (
                <li key={r.id} style={{ cursor: 'pointer', background: r.id === selectedId ? 'var(--bg)' : 'transparent' }}
                    onClick={() => select(r.id)}>
                  <div>
                    <div className="item-title">
                      <span className="badge">{r.kind}</span>{' '}
                      {r.period_start?.slice(0, 10)} → {r.period_end?.slice(0, 10)}
                    </div>
                    <div className="item-meta">
                      {r.achievements ? 'drafted' : 'empty'} · created {r.created_at?.slice(0, 10)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: selected review detail */}
        <div>
          {selected ? (
            <ReviewDetail
              review={selected}
              activity={activity}
              onGenerate={generate}
              generating={generating}
              error={error}
              onSaved={async () => { await refresh(); await select(selected.id); }}
            />
          ) : (
            <div className="panel"><div className="empty">Select a review on the left, or start a new one.</div></div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewDetail({ review, activity, onGenerate, generating, error, onSaved }) {
  const [form, setForm] = useState(() => sectionsToForm(review));
  const [saving, setSaving] = useState(false);

  // reset local form when the selected review changes
  useEffect(() => { setForm(sectionsToForm(review)); }, [review.id]);

  async function save() {
    setSaving(true);
    try {
      await api.reviews.update(review.id, form);
      onSaved?.();
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="panel">
        <h2>{review.kind === 'weekly' ? 'Weekly review' : 'Monthly review'}</h2>
        <div className="item-meta">
          {review.period_start?.slice(0, 10)} → {review.period_end?.slice(0, 10)}
        </div>
        <div className="row-flex" style={{ marginTop: 12 }}>
          <button onClick={onGenerate} disabled={generating}>
            {generating ? 'Drafting… (may take 1–3 min on Ollama)' : (review.achievements ? 'Regenerate draft' : 'Generate draft')}
          </button>
          <button className="ghost" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save edits'}
          </button>
        </div>
        {error && <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{error}</div>}
      </div>

      {activity && <ActivitySnapshot activity={activity} />}

      {SECTIONS.map((s) => (
        <div className="panel" key={s.key}>
          <h2>{s.label}</h2>
          <textarea
            rows={6}
            value={form[s.key] || ''}
            onChange={(e) => setForm({ ...form, [s.key]: e.target.value })}
            placeholder={`Draft or write ${s.label.toLowerCase()} here.`}
          />
        </div>
      ))}
    </div>
  );
}

function ActivitySnapshot({ activity }) {
  const chat = activity.chat_activity || {};
  return (
    <div className="panel">
      <h2>Activity snapshot</h2>
      <div className="item-meta" style={{ marginBottom: 12 }}>
        Auto-gathered from the period. Feeds the drafted review.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        <Metric label="Decisions" value={activity.decisions?.length ?? 0} />
        <Metric label="Tasks done" value={activity.tasks_done?.length ?? 0} />
        <Metric label="Procrastinating" value={activity.tasks_procrastinating?.length ?? 0} />
        <Metric label="Questions raised" value={activity.questions_raised?.length ?? 0} />
        <Metric label="Open questions" value={activity.open_questions?.length ?? 0} />
        <Metric label="Chat msgs (user)" value={chat.user_msgs ?? 0} />
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
      <div className="item-meta" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: 'var(--mono)', color: 'var(--accent-strong)' }}>{value}</div>
    </div>
  );
}

function sectionsToForm(r) {
  const out = {};
  for (const s of SECTIONS) out[s.key] = r[s.key] || '';
  return out;
}
