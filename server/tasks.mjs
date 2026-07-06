import { db, now } from './db.mjs';

export function listTasks({ status } = {}) {
  if (status) {
    return db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY strategic_importance, due_date').all(status);
  }
  return db.prepare(
    "SELECT * FROM tasks WHERE status IN ('open', 'doing') ORDER BY strategic_importance, due_date"
  ).all();
}

export function addTask(task) {
  const t = now();
  const info = db.prepare(
    `INSERT INTO tasks
       (title, notes, domain_key, difficulty, engagement, satisfaction,
        strategic_importance, energy_required, anxiety_level, time_minutes,
        learning_value, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.title,
    task.notes ?? '',
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
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
}

export function updateTask(id, patch) {
  const cols = [
    'title', 'notes', 'domain_key', 'status', 'difficulty', 'engagement', 'satisfaction',
    'strategic_importance', 'energy_required', 'anxiety_level', 'time_minutes',
    'learning_value', 'due_date',
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
  if (!fields.length) return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  fields.push('updated_at = ?');
  args.push(now(), id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

// Repeated avoidance signal
export function procrastinationCandidates(threshold = 2) {
  return db.prepare(
    `SELECT * FROM tasks WHERE deferred_count >= ? AND status IN ('open', 'doing') ORDER BY deferred_count DESC`
  ).all(threshold);
}
