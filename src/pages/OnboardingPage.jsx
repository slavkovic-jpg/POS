import React, { useState } from 'react';
import { api } from '../lib/api.js';

const STEPS = [
  { key: 'identity', prompt: 'Who are you? What are you proud of? What do people rely on you for?' },
  { key: 'values', prompt: 'What matters most? Freedom or stability, impact or income, security or growth?' },
  { key: 'current', prompt: 'What is working well right now? What is frustrating? What are your biggest concerns?' },
  { key: 'professional', prompt: 'Ambitions, career goals, skills to build, leadership aspirations, business opportunities.' },
  { key: 'personal', prompt: 'Health, relationships, family, recreation, personal projects, meaning and purpose.' },
  { key: 'learning', prompt: 'Desired skills, areas of curiosity, future competencies.' },
  { key: 'finances', prompt: 'Financial goals, constraints, risk tolerance.' },
];

export default function OnboardingPage() {
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function save() {
    setSaving(true);
    try {
      for (const step of STEPS) {
        const content = answers[step.key];
        if (content?.trim()) {
          await api.knowledge.add({
            category: step.key === 'current' ? 'current_reality'
              : step.key === 'professional' ? 'career'
              : step.key === 'personal' ? 'personal_life'
              : step.key,
            content,
            confidence: 0.7,
            source: 'discovery',
          });
        }
      }
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Discovery mode</h1>
        <p>
          I need to understand who you are, what matters to you, and where you want to go. Treat each answer as a hypothesis —
          we'll refine over time. Confidence starts at 0.7 for what you write here.
        </p>
      </div>

      {done && (
        <div className="panel" style={{ borderColor: 'var(--success)' }}>
          <h2>Saved.</h2>
          <p>Everything above was stored in the personal knowledge model with confidence 0.7. Refine anytime from the Knowledge page.</p>
        </div>
      )}

      {STEPS.map((s) => (
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
          {saving ? 'Saving…' : 'Save discovery answers'}
        </button>
      </div>
    </div>
  );
}
