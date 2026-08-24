import { db, now } from './db.mjs';

const WITH_SUBTASK_COUNTS = `
  SELECT t.*,
         (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
         (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
  FROM tasks t`;

export function listTasks({ status, domain_key } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('t.status = ?'); args.push(status); }
  else { where.push("t.status IN ('open', 'doing')"); }
  if (domain_key) { where.push('t.domain_key = ?'); args.push(domain_key); }
  return db.prepare(
    `${WITH_SUBTASK_COUNTS} WHERE ${where.join(' AND ')} ORDER BY t.strategic_importance, t.due_date`
  ).all(...args);
}

/** Every task regardless of status — for analytics and the completed view. */
export function allTasks() {
  return db.prepare(`${WITH_SUBTASK_COUNTS} ORDER BY t.strategic_importance, t.due_date`).all();
}

export function getTask(id) {
  return db.prepare(`${WITH_SUBTASK_COUNTS} WHERE t.id = ?`).get(id);
}

export function deleteTask(id) {
  db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

/**
 * Every field a caller may set on a task.
 *
 * Derived once and shared by insert and update, because the previous
 * hardcoded INSERT column list silently dropped four newly-added scoring
 * fields: the API returned 200, the row looked saved, and the scorer quietly
 * used defaults. A task worth 150 points ranked below a ten-minute walk and
 * nothing anywhere reported a problem. Anything not on this list is ignored
 * on purpose (id, timestamps, deferred_count, grounding_json).
 */
export const WRITABLE_TASK_FIELDS = [
  'title', 'notes', 'rationale', 'domain_key', 'status',
  'difficulty', 'engagement', 'satisfaction', 'strategic_importance',
  'energy_required', 'anxiety_level', 'time_minutes', 'learning_value',
  'due_date', 'scheduled_at',
  // Merged in from ExecAgent
  'project_id', 'action_type', 'definition_of_done', 'blocked_by', 'source_ref',
  // The weighting dimensions
  'income_impact', 'commitment_type', 'effort_remaining_minutes', 'restorative',
];

const INSERT_DEFAULTS = {
  notes: '', strategic_importance: 3, income_impact: 0, restorative: 0,
  commitment_type: 'personal',
};

export function addTask(task) {
  const t = now();
  const cols = WRITABLE_TASK_FIELDS.filter(
    (c) => task[c] !== undefined || c in INSERT_DEFAULTS
  );
  const values = cols.map((c) => task[c] ?? INSERT_DEFAULTS[c] ?? null);

  const info = db.prepare(
    `INSERT INTO tasks (${cols.join(', ')}, created_at, updated_at)
     VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`
  ).run(...values, t, t);

  return getTask(info.lastInsertRowid);
}

export function updateTask(id, patch) {
  const cols = WRITABLE_TASK_FIELDS;
  const fields = [];
  const args = [];
  for (const k of cols) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); args.push(patch[k]); }
  }
  if (patch.status === 'deferred') {
    fields.push('deferred_count = deferred_count + 1');
  }
  if (patch.status === 'done') {
    fields.push('completed_at = ?');
    args.push(now());
  }
  if (!fields.length) return getTask(id);
  fields.push('updated_at = ?');
  args.push(now(), id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getTask(id);
}

/** Cognitive-load rollup for the analytics view. */
export function taskStats() {
  const byDomain = db.prepare(
    `SELECT d.key, d.name,
            COUNT(t.id) AS total,
            COALESCE(SUM(CASE WHEN t.status IN ('open','doing') THEN 1 ELSE 0 END), 0) AS open_count,
            COALESCE(SUM(CASE WHEN t.status IN ('open','doing') THEN t.time_minutes ELSE 0 END), 0) AS open_minutes
     FROM life_domains d
     LEFT JOIN tasks t ON t.domain_key = d.key
     GROUP BY d.key, d.name
     ORDER BY d.priority, d.name`
  ).all();

  const totals = db.prepare(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status IN ('open','doing') THEN 1 ELSE 0 END), 0) AS open_count,
       COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done_count,
       COALESCE(SUM(CASE WHEN status IN ('open','doing') THEN time_minutes ELSE 0 END), 0) AS open_minutes,
       COALESCE(SUM(CASE WHEN status IN ('open','doing') AND anxiety_level >= 4 THEN 1 ELSE 0 END), 0) AS high_dread
     FROM tasks`
  ).get();

  return { by_domain: byDomain, totals };
}

// Repeated avoidance signal
export function procrastinationCandidates(threshold = 2) {
  return db.prepare(
    `SELECT * FROM tasks WHERE deferred_count >= ? AND status IN ('open', 'doing') ORDER BY deferred_count DESC`
  ).all(threshold);
}
