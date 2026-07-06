import { db, now } from './db.mjs';

export function getStrategy() {
  const row = db.prepare('SELECT * FROM strategy WHERE id = 1').get();
  const domains = db.prepare('SELECT * FROM life_domains ORDER BY priority, name').all();
  return {
    mission: row?.mission || '',
    identity: row?.identity || '',
    long_term_vision: row?.long_term_vision || '',
    values: row?.values_json ? JSON.parse(row.values_json) : [],
    updated_at: row?.updated_at,
    domains,
  };
}

export function updateStrategy({ mission, values, identity, long_term_vision }) {
  db.prepare(
    `UPDATE strategy SET
       mission = COALESCE(?, mission),
       values_json = COALESCE(?, values_json),
       identity = COALESCE(?, identity),
       long_term_vision = COALESCE(?, long_term_vision),
       updated_at = ?
     WHERE id = 1`
  ).run(
    mission ?? null,
    values ? JSON.stringify(values) : null,
    identity ?? null,
    long_term_vision ?? null,
    now()
  );
  return getStrategy();
}

export function updateDomain(key, patch) {
  const fields = [];
  const args = [];
  for (const k of ['current_state', 'desired_state', 'priority', 'confidence', 'constraints']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      args.push(patch[k]);
    }
  }
  if (!fields.length) return db.prepare('SELECT * FROM life_domains WHERE key = ?').get(key);
  fields.push('updated_at = ?');
  args.push(now(), key);
  db.prepare(`UPDATE life_domains SET ${fields.join(', ')} WHERE key = ?`).run(...args);
  return db.prepare('SELECT * FROM life_domains WHERE key = ?').get(key);
}
