import { db, now } from './db.mjs';

/**
 * CRUD for the entities adopted from ExecAgent.
 *
 * One config drives list/get/create/update/delete for all of them. The writable
 * field list is declared once per entity and used by BOTH insert and update —
 * the same discipline `tasks.mjs` had to be retrofitted with after a hardcoded
 * INSERT silently dropped four columns and nothing reported a problem.
 *
 * `immutable` fields can be written at insert and never again. That is what
 * makes "the raw capture is preserved" a guarantee rather than a hope: edits go
 * to context_note, never over the original words.
 */

export const ENTITIES = {
  projects: {
    table: 'projects',
    prefix: 'prj',
    label: 'Project',
    required: ['name'],
    immutable: ['id', 'created_at'],
    fields: [
      'name', 'purpose', 'desired_outcome', 'current_state', 'status',
      'importance', 'urgency', 'energy_profile', 'next_outcome',
      'last_activity_at', 'next_review_date', 'deadline', 'domain_key',
      'income_impact', 'source_links', 'latest_context', 'pause_reason',
      'inbox_id',
    ],
    defaults: { status: 'active', importance: 'medium', urgency: 'medium', income_impact: 0 },
    enums: {
      status: ['active', 'paused', 'waiting', 'blocked', 'archived', 'completed'],
      importance: ['low', 'medium', 'high'],
      urgency: ['low', 'medium', 'high'],
      energy_profile: ['deep_work', 'finishing', 'routine', 'communication', 'exploration', 'small'],
    },
    order: 'CASE status WHEN \'active\' THEN 0 WHEN \'waiting\' THEN 1 WHEN \'blocked\' THEN 2 WHEN \'paused\' THEN 3 ELSE 4 END, name',
  },

  commitments: {
    table: 'commitments',
    prefix: 'cmt',
    label: 'Commitment',
    required: ['description'],
    immutable: ['id', 'created_at'],
    fields: [
      'description', 'project_id', 'waiting_party', 'promised_result',
      'external_deadline', 'internal_target', 'status', 'consequence',
      'commitment_type', 'income_impact', 'effort_remaining_minutes',
      'source_link', 'latest_update', 'postpone_count', 'inbox_id',
    ],
    defaults: {
      status: 'open', commitment_type: 'contracted', income_impact: 3,
      postpone_count: 0,
    },
    enums: {
      status: ['open', 'in_progress', 'delivered', 'renegotiated', 'at_risk', 'dropped'],
      commitment_type: ['contracted', 'speculative', 'personal', 'restorative'],
    },
    order: 'COALESCE(NULLIF(internal_target, \'\'), NULLIF(external_deadline, \'\'), \'9999\'), created_at',
  },

  inbox: {
    table: 'inbox',
    prefix: 'inb',
    label: 'Capture',
    required: ['raw_content'],
    // The original words are never editable. Second thoughts go to context_note.
    immutable: ['id', 'created_at', 'source', 'raw_content', 'external_ref'],
    fields: [
      'source', 'raw_content', 'context_note', 'processing_status',
      'classification_status', 'error_state', 'attachment_url', 'external_ref',
      'promoted_to_type', 'promoted_to_id',
    ],
    defaults: { source: 'web', processing_status: 'new', classification_status: 'unclassified' },
    enums: {
      source: ['web', 'voice', 'email', 'import', 'manual'],
      processing_status: ['new', 'in_progress', 'parked', 'done', 'error'],
      classification_status: ['unclassified', 'classified', 'needs_review'],
    },
    order: 'created_at DESC',
  },

  ideas: {
    table: 'ideas',
    prefix: 'idea',
    label: 'Idea',
    required: ['raw_capture'],
    immutable: ['id', 'created_at', 'raw_capture', 'inbox_id'],
    fields: [
      'raw_capture', 'expanded_context', 'trigger_origin', 'project_id',
      'possible_value', 'suggested_experiment', 'status', 'capture_source',
      'attachments', 'inbox_id',
    ],
    defaults: { status: 'captured' },
    enums: {
      status: ['captured', 'expanded', 'linked', 'acting', 'parked', 'realised', 'ruled_out'],
    },
    order: 'created_at DESC',
  },

  dependencies: {
    table: 'dependencies',
    prefix: 'dep',
    label: 'Dependency',
    required: ['dependency'],
    immutable: ['id', 'created_at'],
    fields: [
      'dependency', 'project_id', 'owner', 'decision_authority', 'expected_date',
      'status', 'downstream_effects', 'follow_up_action', 'risk_level',
    ],
    defaults: { status: 'waiting', risk_level: 'medium' },
    enums: {
      status: ['waiting', 'chasing', 'resolved', 'abandoned'],
      risk_level: ['low', 'medium', 'high'],
    },
    order: 'COALESCE(NULLIF(expected_date, \'\'), \'9999\'), created_at',
  },
};

// ---------------------------------------------------------------------------

/** ExecAgent's id shape: prj_20260820-143011-a3f2. Sorts chronologically. */
export function newId(prefix) {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
                `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${stamp}-${rand}`;
}

function spec(kind) {
  const s = ENTITIES[kind];
  if (!s) throw new Error(`unknown entity: ${kind}`);
  return s;
}

function validate(s, data, { partial = false } = {}) {
  if (!partial) {
    for (const f of s.required) {
      if (!String(data[f] ?? '').trim()) throw new Error(`${f} is required`);
    }
  }
  for (const [field, allowed] of Object.entries(s.enums || {})) {
    const v = data[field];
    if (v === undefined || v === null || v === '') continue;
    if (!allowed.includes(String(v))) {
      throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
    }
  }
}

export function listEntities(kind, { status, project_id, limit } = {}) {
  const s = spec(kind);
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (project_id) { where.push('project_id = ?'); args.push(project_id); }
  const sql = `SELECT * FROM ${s.table}` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${s.order}` +
    (limit ? ` LIMIT ${Number(limit)}` : '');
  return db.prepare(sql).all(...args);
}

export function getEntity(kind, id) {
  const s = spec(kind);
  return db.prepare(`SELECT * FROM ${s.table} WHERE id = ?`).get(id) || null;
}

export function createEntity(kind, data = {}) {
  const s = spec(kind);
  validate(s, data);

  const t = now();
  const cols = s.fields.filter((f) => data[f] !== undefined || f in s.defaults);
  const values = cols.map((f) => data[f] ?? s.defaults[f] ?? null);
  const id = data.id || newId(s.prefix);

  db.prepare(
    `INSERT INTO ${s.table} (id, ${cols.join(', ')}, created_at, updated_at)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`
  ).run(id, ...values, t, t);

  logEvent(s.table, id, 'created', s.required.map((f) => data[f]).join(' ').slice(0, 120));
  return getEntity(kind, id);
}

export function updateEntity(kind, id, patch = {}) {
  const s = spec(kind);
  const existing = getEntity(kind, id);
  if (!existing) throw new Error(`${s.label} not found`);
  validate(s, patch, { partial: true });

  // Refuse silently-destructive edits rather than accepting and discarding.
  for (const f of s.immutable) {
    if (patch[f] !== undefined && String(patch[f]) !== String(existing[f] ?? '')) {
      throw new Error(`${f} cannot be changed once set`);
    }
  }

  const editable = s.fields.filter((f) => !s.immutable.includes(f));
  const sets = [];
  const args = [];
  for (const f of editable) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    args.push(patch[f]);
  }
  if (!sets.length) return existing;

  sets.push('updated_at = ?');
  args.push(now(), id);
  db.prepare(`UPDATE ${s.table} SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  if (patch.status && patch.status !== existing.status) {
    logEvent(s.table, id, 'status_changed', `${existing.status} -> ${patch.status}`);
  }
  return getEntity(kind, id);
}

export function deleteEntity(kind, id) {
  const s = spec(kind);
  db.prepare(`DELETE FROM ${s.table} WHERE id = ?`).run(id);
  logEvent(s.table, id, 'deleted', '');
}

/** Append-only. Also the substrate burnout detection reads. */
export function logEvent(entityType, entityId, event, detail = '') {
  db.prepare(
    `INSERT INTO event_log (id, at, actor, entity_type, entity_id, event, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newId('evt'), now(), 'user', entityType, entityId, event, String(detail).slice(0, 500));
}

export function listEvents({ limit = 100 } = {}) {
  return db.prepare(`SELECT * FROM event_log ORDER BY at DESC LIMIT ?`).all(limit);
}

// ---------------------------------------------------------------------------

/**
 * Move a capture out of the inbox into whatever it turned out to be.
 *
 * The inbox row is kept and marked, not deleted: the original words survive
 * even after the thing they became is edited beyond recognition.
 */
export function promoteInbox(inboxId, targetType, fields = {}) {
  const item = getEntity('inbox', inboxId);
  if (!item) throw new Error('capture not found');
  if (item.processing_status === 'done') throw new Error('already promoted');

  let created;
  if (targetType === 'task') {
    // Imported lazily: tasks.mjs is the one entity not managed by this module.
    const { addTask } = requireTasks();
    created = addTask({ title: item.raw_content.slice(0, 120), ...fields });
  } else {
    created = createEntity(targetType, {
      inbox_id: inboxId,
      ...seedFromCapture(targetType, item),
      ...fields,
    });
  }

  updateEntity('inbox', inboxId, {
    processing_status: 'done',
    classification_status: 'classified',
    promoted_to_type: targetType,
    promoted_to_id: String(created.id),
  });

  logEvent('inbox', inboxId, 'promoted', `${targetType} ${created.id}`);
  return created;
}

function seedFromCapture(targetType, item) {
  const text = item.raw_content;
  if (targetType === 'ideas') return { raw_capture: text, capture_source: item.source };
  if (targetType === 'projects') return { name: text.slice(0, 120) };
  if (targetType === 'commitments') return { description: text.slice(0, 200) };
  if (targetType === 'dependencies') return { dependency: text.slice(0, 200) };
  return {};
}

let tasksModule = null;
function requireTasks() {
  // Set by server.mjs at boot to avoid a circular import at module load.
  if (!tasksModule) throw new Error('task module not registered');
  return tasksModule;
}
export function registerTasksModule(mod) { tasksModule = mod; }
