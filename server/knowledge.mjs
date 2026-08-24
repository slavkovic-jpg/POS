import { db, now } from './db.mjs';

export function listKnowledge(category) {
  if (category) {
    return db.prepare(
      'SELECT * FROM knowledge WHERE category = ? ORDER BY confidence DESC, updated_at DESC'
    ).all(category);
  }
  return db.prepare('SELECT * FROM knowledge ORDER BY category, confidence DESC').all();
}

export function addKnowledge({ category, content, confidence = 0.5, source = 'conversation' }) {
  const t = now();
  const info = db.prepare(
    `INSERT INTO knowledge (category, content, confidence, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(category, content, confidence, source, t, t);
  return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(info.lastInsertRowid);
}

export function updateKnowledge(id, patch) {
  const fields = [];
  const args = [];
  for (const k of ['category', 'content', 'confidence', 'source']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      args.push(patch[k]);
    }
  }
  if (!fields.length) return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id);
  fields.push('updated_at = ?');
  args.push(now(), id);
  db.prepare(`UPDATE knowledge SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id);
}

export function deleteKnowledge(id) {
  db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
}

// Builds a safe FTS5 MATCH expression out of free text a user typed — never
// pass user text to MATCH unescaped, since FTS5 query syntax treats
// characters like " * - ( ) as operators and a stray one throws.
function ftsQuery(text) {
  const tokens = (text.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 12);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

/**
 * Rows relevant to a question, ranked by FTS5's bm25. Exists so
 * buildSystemPrompt() can stop dumping the whole knowledge table into every
 * prompt — retrieval instead of brute force is what lets it grow.
 */
export function searchKnowledge(text, limit = 20) {
  const q = ftsQuery(text || '');
  if (!q) return [];
  return db.prepare(
    `SELECT knowledge.* FROM knowledge_fts
     JOIN knowledge ON knowledge.id = knowledge_fts.rowid
     WHERE knowledge_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).all(q, limit);
}
