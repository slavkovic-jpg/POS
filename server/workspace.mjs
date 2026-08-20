import { db } from './db.mjs';
import { getContext } from './context-state.mjs';
import { burnoutRisk, rankWork, DEFAULT_WEIGHTS } from './scoring.mjs';

/**
 * Loads everything the scorer needs and hands it over.
 *
 * The split matters: scoring.mjs is pure and knows nothing about SQLite, so it
 * stays testable and keeps working with every backend down. This file is the
 * only place that turns rows into that shape.
 */

export function loadWeights() {
  const rows = db.prepare('SELECT key, value FROM weights').all();
  const out = { ...DEFAULT_WEIGHTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setWeight(key, value) {
  if (!(key in DEFAULT_WEIGHTS)) throw new Error(`unknown weight: ${key}`);
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error('value must be a number');
  db.prepare(
    `INSERT INTO weights (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, n, new Date().toISOString());
  return loadWeights();
}

export function resetWeights() {
  const t = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO weights (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) stmt.run(k, v, t);
  return loadWeights();
}

// ---------------------------------------------------------------------------

export function loadWorkspace() {
  return {
    tasks: db.prepare(
      `SELECT * FROM tasks WHERE status NOT IN ('done','dropped')`
    ).all(),
    commitments: db.prepare(
      `SELECT * FROM commitments WHERE status NOT IN ('delivered','dropped')`
    ).all(),
    projects: db.prepare(`SELECT * FROM projects`).all(),
    dependencies: db.prepare(`SELECT * FROM dependencies`).all(),
    sessions: db.prepare(
      `SELECT * FROM work_sessions WHERE stopped_at IS NOT NULL AND stopped_at <> ''`
    ).all(),
  };
}

/**
 * Burnout signals, built only from what is already recorded.
 *
 * Deliberately not self-report. On the day it matters most you are the least
 * reliable narrator of your own state, and a question you have to answer is a
 * question you will start skipping.
 */
export function loadBurnoutSignals(now = new Date()) {
  const iso = (d) => d.toISOString();
  const ago = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return d; };

  // Consecutive depleted days, walking backwards from today.
  const recentContext = db.prepare(
    `SELECT date, energy_state FROM daily_context ORDER BY date DESC LIMIT 30`
  ).all();
  let depletedDays = 0;
  for (const row of recentContext) {
    if (row.energy_state === 'low' || row.energy_state === 'overwhelmed') depletedDays++;
    else break;
  }

  // How much of what actually got finished put energy back.
  const completed = db.prepare(
    `SELECT COALESCE(SUM(time_minutes), 0) AS total,
            COALESCE(SUM(CASE WHEN restorative >= 3 THEN time_minutes ELSE 0 END), 0) AS restorative,
            COUNT(*) AS n
       FROM tasks
      WHERE status = 'done' AND completed_at >= ?`
  ).get(iso(ago(14)));

  const restorativeRatio = completed.total > 0
    ? completed.restorative / completed.total
    : null;

  const open = db.prepare(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN deferred_count >= 1 THEN 1 ELSE 0 END), 0) AS deferred
       FROM tasks WHERE status IN ('open','doing')`
  ).get();
  const deferralRate = open.n > 0 ? open.deferred / open.n : 0;

  // Late activity. A signal you cannot fake and would not think to report.
  const lateNightCount = db.prepare(
    `SELECT COUNT(DISTINCT substr(created_at, 1, 10)) AS n
       FROM chat_messages
      WHERE role = 'user' AND created_at >= ?
        AND (CAST(substr(created_at, 12, 2) AS INTEGER) >= 23
          OR CAST(substr(created_at, 12, 2) AS INTEGER) < 5)`
  ).get(iso(ago(7))).n;

  const sleep = db.prepare(
    `SELECT AVG(sleep_hours) AS avg FROM health_signals
      WHERE date >= ? AND sleep_hours IS NOT NULL`
  ).get(iso(ago(7)).slice(0, 10));

  return {
    depletedDays,
    restorativeRatio,
    completedCount: completed.n,
    deferralRate,
    lateNightCount,
    sleepHours: sleep?.avg ?? null,
  };
}

export function currentBurnout(now = new Date()) {
  return burnoutRisk(loadBurnoutSignals(now));
}

/**
 * The full ranking, ready to serve. No model involved — this is the answer,
 * and anything an LLM adds afterwards is commentary on it.
 */
export function rankNow({ limit = 6, capacity, now = new Date() } = {}) {
  const ctx = getContext();
  return rankWork(loadWorkspace(), {
    now,
    energyState: ctx.energy_state,
    availableMinutes: ctx.available_minutes,
    capacity: capacity || 'unsure',
    weights: loadWeights(),
    burnout: currentBurnout(now),
    limit,
  });
}
