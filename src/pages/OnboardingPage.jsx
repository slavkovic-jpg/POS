import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const STEPS = [
  { key: 'profile', label: 'Profile' },
  { key: 'cv', label: 'CV analysis' },
  { key: 'review', label: 'Review hypotheses' },
  { key: 'discovery', label: 'Discovery' },
];

export default function OnboardingPage() {
  const [profile, setProfile] = useState(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    api.onboarding.profile().then((p) => {
      setProfile(p);
      if (p?.onboarded_at) setStep(3); // returning user — jump to discovery
    }).catch(console.error);
  }, []);

  if (!profile) return <div className="empty">Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Onboarding</h1>
        <p>
          I need to understand who you are, what matters to you, and where you want to go.
          Everything you share becomes a hypothesis I refine over time — not a fixed record.
        </p>
      </div>

      <StepBar step={step} setStep={setStep} />

      {step === 0 && <ProfileStep profile={profile} onSaved={setProfile} onNext={() => setStep(1)} />}
      {step === 1 && <CvStep profile={profile} onSaved={setProfile} onNext={() => setStep(2)} />}
      {step === 2 && <ReviewStep onNext={() => setStep(3)} />}
      {step === 3 && <DiscoveryStep profile={profile} onSaved={setProfile} />}
    </div>
  );
}

// ---- Step bar ------------------------------------------------------------
function StepBar({ step, setStep }) {
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            className={i === step ? '' : 'ghost'}
            style={{ flex: 1, padding: '10px 8px' }}
            onClick={() => setStep(i)}
          >
            {i + 1}. {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Step 1: profile -----------------------------------------------------
function ProfileStep({ profile, onSaved, onNext }) {
  const [form, setForm] = useState({
    name: profile?.name || '',
    bio: profile?.bio || '',
    linkedin_url: profile?.linkedin_url || '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.onboarding.updateProfile(form);
      onSaved(updated);
      onNext();
    } finally { setSaving(false); }
  }

  return (
    <div className="panel">
      <h2>Who are you?</h2>
      <p style={{ color: 'var(--text-dim)', margin: '0 0 12px' }}>
        Start with the basics. LinkedIn is optional — a good bio is more useful.
      </p>
      <label>Name</label>
      <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Milos Slavkovic" />
      <label>Short bio (a paragraph or two — what you do, what you care about)</label>
      <textarea rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })}
        placeholder="A trader building AI-native platforms. Founder mindset. Focus on sustainable long-term outcomes over quarterly noise. Live near a river." />
      <label>LinkedIn URL (optional)</label>
      <input type="text" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
        placeholder="https://www.linkedin.com/in/…" />
      <div className="row-flex" style={{ marginTop: 16 }}>
        <button onClick={save} disabled={saving || !form.name.trim()}>
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </div>
  );
}

// ---- Step 2: CV analysis --------------------------------------------------
function CvStep({ profile, onSaved, onNext }) {
  const [cv, setCv] = useState(profile?.cv_raw || '');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  async function analyze() {
    if (!cv.trim()) return;
    setAnalyzing(true); setError(null);
    try {
      await api.onboarding.updateProfile({ cv_raw: cv }).then(onSaved);
      const result = await api.onboarding.analyze(cv);
      // stash for the review step
      sessionStorage.setItem('pos_hypotheses', JSON.stringify(result.hypotheses));
      sessionStorage.setItem('pos_hypotheses_source', result.source || '');
      sessionStorage.setItem('pos_hypotheses_model', result.model || '');
      onNext();
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function skip() {
    if (cv.trim()) await api.onboarding.updateProfile({ cv_raw: cv }).then(onSaved);
    sessionStorage.setItem('pos_hypotheses', '[]');
    onNext();
  }

  return (
    <div className="panel">
      <h2>Paste your CV or resume</h2>
      <p style={{ color: 'var(--text-dim)', margin: '0 0 12px' }}>
        I'll extract hypotheses about your career, skills, and where you could go next.
        Everything I pull out will be marked as an assumption you can accept, edit, or reject on the next step.
      </p>
      <textarea rows={14} value={cv} onChange={(e) => setCv(e.target.value)}
        placeholder="Paste your CV text here…" />
      {error && (
        <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>
          {error}
        </div>
      )}
      <div className="row-flex" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <button className="ghost" onClick={skip}>Skip this step</button>
        <button onClick={analyze} disabled={analyzing || !cv.trim()}>
          {analyzing ? 'Analyzing… (may take ~30-90s cold)' : 'Analyze CV →'}
        </button>
      </div>
    </div>
  );
}

// ---- Step 3: review hypotheses ------------------------------------------
function ReviewStep({ onNext }) {
  const initial = React.useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem('pos_hypotheses') || '[]'); }
    catch { return []; }
  }, []);
  const source = sessionStorage.getItem('pos_hypotheses_source') || '';
  const model = sessionStorage.getItem('pos_hypotheses_model') || '';

  const [rows, setRows] = useState(
    initial.map((h, i) => ({ ...h, id: i, accepted: true }))
  );
  const [saving, setSaving] = useState(false);

  const grouped = groupBy(rows, (r) => r.category);

  function toggle(id) { setRows((rs) => rs.map((r) => r.id === id ? { ...r, accepted: !r.accepted } : r)); }
  function updateContent(id, content) { setRows((rs) => rs.map((r) => r.id === id ? { ...r, content } : r)); }
  function updateConfidence(id, confidence) { setRows((rs) => rs.map((r) => r.id === id ? { ...r, confidence: parseFloat(confidence) || 0 } : r)); }
  function remove(id) { setRows((rs) => rs.filter((r) => r.id !== id)); }

  async function accept() {
    const kept = rows.filter((r) => r.accepted).map(({ id, accepted, ...rest }) => rest);
    setSaving(true);
    try {
      if (kept.length) await api.onboarding.accept(kept);
      sessionStorage.removeItem('pos_hypotheses');
      sessionStorage.removeItem('pos_hypotheses_source');
      sessionStorage.removeItem('pos_hypotheses_model');
      onNext();
    } finally { setSaving(false); }
  }

  if (rows.length === 0) {
    return (
      <div className="panel">
        <h2>No hypotheses to review</h2>
        <p>Nothing was extracted (either the CV step was skipped or the LLM returned nothing). Move on when you're ready.</p>
        <button onClick={onNext}>Continue →</button>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h2>Review extracted hypotheses</h2>
        <p style={{ color: 'var(--text-dim)', margin: '0 0 8px' }}>
          {rows.filter((r) => r.accepted).length} of {rows.length} selected. Uncheck anything wrong,
          edit anything close-but-not-quite, remove anything irrelevant.
        </p>
        {source && (
          <div className="item-meta">
            <span className="badge">{source}</span>
            {model && <span> · {model}</span>}
          </div>
        )}
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <div className="panel" key={category}>
          <h2 style={{ textTransform: 'capitalize' }}>{category}</h2>
          <ul className="item-list">
            {items.map((r) => (
              <li key={r.id} style={{ alignItems: 'center', gap: 12 }}>
                <input type="checkbox" checked={r.accepted} onChange={() => toggle(r.id)}
                  style={{ width: 18, height: 18, flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <textarea
                    rows={2}
                    value={r.content}
                    onChange={(e) => updateContent(r.id, e.target.value)}
                    style={{ opacity: r.accepted ? 1 : 0.5 }}
                  />
                  <div className="row-flex" style={{ marginTop: 6, gap: 12 }}>
                    <span className="item-meta">confidence</span>
                    <input
                      type="range"
                      min={0.3} max={0.9} step={0.05}
                      value={r.confidence}
                      onChange={(e) => updateConfidence(r.id, e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <span className="item-meta" style={{ minWidth: 40 }}>{Math.round(r.confidence * 100)}%</span>
                  </div>
                </div>
                <button className="ghost" onClick={() => remove(r.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="panel">
        <div className="row-flex" style={{ justifyContent: 'flex-end' }}>
          <button onClick={accept} disabled={saving}>
            {saving ? 'Saving…' : `Save ${rows.filter((r) => r.accepted).length} & continue →`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Step 4: discovery (free-form + complete) ---------------------------
const DISCOVERY_STEPS = [
  { key: 'identity', prompt: 'Who are you? What are you proud of? What do people rely on you for?' },
  { key: 'values', prompt: 'What matters most? Freedom or stability, impact or income, security or growth?' },
  { key: 'current_reality', prompt: 'What is working well right now? What is frustrating? What are your biggest concerns?' },
  { key: 'motivations', prompt: 'What gives you energy? What drains it?' },
  { key: 'stress_triggers', prompt: 'What situations put you into your worst mode? What are the early warning signs?' },
  { key: 'career', prompt: 'Ambitions, career goals, skills to build, leadership aspirations, business opportunities.' },
  { key: 'personal_life', prompt: 'Health, relationships, family, recreation, personal projects, meaning and purpose.' },
  { key: 'learning', prompt: 'Desired skills, areas of curiosity, future competencies.' },
  { key: 'finances', prompt: 'Financial goals, constraints, risk tolerance.' },
];

function DiscoveryStep({ profile, onSaved }) {
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(!!profile?.onboarded_at);

  async function save() {
    setSaving(true);
    try {
      for (const step of DISCOVERY_STEPS) {
        const content = answers[step.key]?.trim();
        if (content) {
          await api.onboarding.accept([{
            category: step.key,
            content,
            confidence: 0.7,
          }]);
        }
      }
      const updated = await api.onboarding.complete();
      onSaved(updated);
      setDone(true);
    } finally { setSaving(false); }
  }

  return (
    <div>
      {done && (
        <div className="panel" style={{ borderColor: 'var(--success)' }}>
          <h2>Onboarded ✓</h2>
          <p>
            Everything above is now in your Personal Knowledge Model with confidence 0.7. Refine anytime
            from the <a href="/knowledge" style={{ color: 'var(--accent)' }}>Knowledge</a> page, or update
            your Strategy scaffold. When you're ready, head to <a href="/chat" style={{ color: 'var(--accent)' }}>Chat</a>{' '}
            or <a href="/briefing" style={{ color: 'var(--accent)' }}>Today's Briefing</a>.
          </p>
        </div>
      )}

      <div className="panel">
        <h2>Discovery</h2>
        <p style={{ color: 'var(--text-dim)', margin: 0 }}>
          I've captured your history. Now I need context the CV can't tell me. Answer whichever prompts feel
          relevant — leave the rest blank.
        </p>
      </div>

      {DISCOVERY_STEPS.map((s) => (
        <div className="panel" key={s.key}>
          <h2 style={{ textTransform: 'capitalize' }}>{s.key.replace('_', ' ')}</h2>
          <p style={{ color: 'var(--text-dim)', margin: '0 0 10px' }}>{s.prompt}</p>
          <textarea
            rows={4}
            value={answers[s.key] || ''}
            onChange={(e) => setAnswers({ ...answers, [s.key]: e.target.value })}
          />
        </div>
      ))}

      <div className="panel">
        <button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : done ? 'Save additional answers' : 'Save & complete onboarding'}
        </button>
      </div>
    </div>
  );
}

// ---- helpers -------------------------------------------------------------
function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
