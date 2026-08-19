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

export function addTask(task) {
  const t = now();
  const info = db.prepare(
    `INSERT INTO tasks
       (title, notes, rationale, domain_key, difficulty, engagement, satisfaction,
        strategic_importance, energy_required, anxiety_level, time_minutes,
        learning_value, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.title,
    task.notes ?? '',
    task.rationale ?? null,
    task.domain_key ?? null,
    task.difficulty ?? null,
    task.engagement ?? null,
    task.satisfaction ?? null,
    task.strategic_importance ?? 3,
    task.energy_required ?? null,
    task.anxiety_level ?? null,
    task.time_minutes ?? null,
    task.learning_value ?? null,
    task.due_date ?? null,
    t,
    t,
  );
  return getTask(info.lastInsertRowid);
}

export function updateTask(id, patch) {
  const cols = [
    'title', 'notes', 'rationale', 'domain_key', 'status', 'difficulty', 'engagement',
    'satisfaction', 'strategic_importance', 'energy_required', 'anxiety_level',
    'time_minutes', 'learning_value', 'due_date',
  ];
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
