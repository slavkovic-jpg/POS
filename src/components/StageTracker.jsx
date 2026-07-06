import React from 'react';

const LABELS = {
  urgencies_identified: 'Urgencies identified',
  energy_evaluated: 'Energy evaluated',
  constraints_understood: 'Constraints understood',
  priorities_agreed: 'Priorities agreed',
  risks_considered: 'Risks considered',
  plan_accepted: 'Plan accepted',
};

export default function StageTracker({ stages, stageNames, onToggle }) {
  return (
    <ul className="stages" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {stageNames.map((s) => (
        <li key={s} className={'stage' + (stages[s] ? ' done' : '')} onClick={() => onToggle?.(s)} style={{ cursor: onToggle ? 'pointer' : 'default' }}>
          <span className="dot" />
          <span>{LABELS[s] || s}</span>
        </li>
      ))}
    </ul>
  );
}
