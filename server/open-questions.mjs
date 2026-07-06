import { db, now } from './db.mjs';

export function listOpenQuestions(status) {
  if (status) {
    return db.prepare(
      'SELECT * FROM open_questions WHERE status = ? ORDER BY strategic_importance, updated_at DESC'
    ).all(status);
  }
  return db.prepare(
    "SELECT * FROM open_questions WHERE status IN ('awaiting', 'exploring') ORDER BY strategic_importance, updated_at DESC"
  ).all();
}

export function addOpenQuestion({ question, context = '', strategic_importance = 3, review_date = null }) {
  const t = now();
  const info = db.prepare(
    `INSERT INTO open_questions (question, context, strategic_importance, review_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(question, context, strategic_importance, review_date, t, t);
  return db.prepare('SELECT * FROM open_questions WHERE id = ?').get(info.lastInsertRowid);
}

export function updateOpenQuestion(id, patch) {
  const fields = [];
  const args = [];
  for (const k of ['question', 'context', 'status', 'strategic_importance', 'review_date', 'resolution']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      args.push(patch[k]);
    }
  }
  if (!fields.length) return db.prepare('SELECT * FROM open_questions WHERE id = ?').get(id);
  fields.push('updated_at = ?');
  args.push(now(), id);
  db.prepare(`UPDATE open_questions SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return db.prepare('SELECT * FROM open_questions WHERE id = ?').get(id);
}

export function resolveOpenQuestion(id, resolution) {
  return updateOpenQuestion(id, { status: 'resolved', resolution });
}
