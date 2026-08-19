import { db, now } from './db.mjs';

/**
 * Current conditions — the answer to "what is realistic right now?".
 *
 * Separate from `briefings` (which is a daily planning ritual) because this
 * changes several times a day: energy drops after a hard meeting, a two-hour
 * block collapses to fifteen minutes. Every planning surface reads it.
 */

export const ENERGY_STATES = {
  peak: {
    label: 'Peak focus',
    description: 'Sharp, rested, able to hold a hard problem in mind',
    max_task_energy: 5,
  },
  medium: {
    label: 'Moderate',
    description: 'Functional and steady, but not at your best',
    max_task_energy: 4,
  },
  low: {
    label: 'Low energy',
    description: 'Depleted; only low-friction work will actually happen',
    max_task_energy: 2,
  },
  overwhelmed: {
    label: 'Overwhelmed',
    description: 'Stressed and scattered — recovery beats output right now',
    max_task_energy: 1,
  },
};

const today = () => new Date().toISOString().slice(0, 10);

export function getContext() {
  const date = today();
  let row = db.prepare('SELECT * FROM daily_context WHERE date = ?').get(date);
  if (!row) {
    db.prepare(
      `INSERT INTO daily_context (date, energy_state, available_minutes, updated_at)
       VALUES (?, 'medium', 30, ?)`
    ).run(date, now());
    row = db.prepare('SELECT * FROM daily_context WHERE date = ?').get(date);
  }
  return {
    ...row,
    energy_label: ENERGY_STATES[row.energy_state]?.label ?? row.energy_state,
    energy_states: ENERGY_STATES,
  };
}

export function setContext({ energy_state, available_minutes, note }) {
  const date = today();
  getContext(); // ensure the row exists

  if (energy_state !== undefined && !ENERGY_STATES[energy_state]) {
    throw new Error(`energy_state must be one of: ${Object.keys(ENERGY_STATES).join(', ')}`);
  }

  db.prepare(
    `UPDATE daily_context SET
       energy_state = COALESCE(?, energy_state),
       available_minutes = COALESCE(?, available_minutes),
       note = COALESCE(?, note),
       updated_at = ?
     WHERE date = ?`
  ).run(
    energy_state ?? null,
    available_minutes !== undefined ? Math.max(5, Math.min(600, Number(available_minutes) || 30)) : null,
    note ?? null,
    now(),
    date,
  );

  return getContext();
}
