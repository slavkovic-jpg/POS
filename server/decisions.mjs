import { db, now } from './db.mjs';

export function listDecisions() {
  return db.prepare('SELECT * FROM decisions ORDER BY decided_at DESC').all();
}

export function addDecision({
  decision,
  reasoning = '',
  expected_outcome = '',
  confidence = 0.5,
  followup_date = null,
}) {
  const info = db.prepare(
    `INSERT INTO decisions (decision, reasoning, expected_outcome, confidence, followup_date, decided_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(decision, reasoning, expected_outcome, confidence, followup_date, now());
  return db.prepare('SELECT * FROM decisions WHERE id = ?').get(info.lastInsertRowid);
}

export function reviewDecision(id, { actual_outcome, lessons }) {
  db.prepare(
    `UPDATE decisions SET actual_outcome = ?, lessons = ?, reviewed_at = ? WHERE id = ?`
  ).run(actual_outcome ?? '', lessons ?? '', now(), id);
  return db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
}
