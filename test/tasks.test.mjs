import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Persistence round-trip.
 *
 * Exists because of a real bug: addTask had a hardcoded INSERT column list, so
 * four newly-added scoring fields were silently dropped. The API returned 200,
 * the row looked saved, and the scorer used defaults — a task worth 227 points
 * ranked below a ten-minute walk with nothing reporting a problem.
 *
 * The lesson generalises: any field a caller can set must be proven to survive
 * a write, or a future column will be added to the schema and forgotten in the
 * insert exactly the same way.
 */

let tasksMod, dbMod, tmpDir;

before(async () => {
  // Point the app at a scratch database so this never touches real data.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-test-'));
  process.env.POS_DATA_DIR = tmpDir;

  const { migrate } = await import('../server/migrations.mjs');
  migrate();
  tasksMod = await import('../server/tasks.mjs');
  dbMod = await import('../server/db.mjs');
});

after(() => {
  try { dbMod?.db?.close?.(); } catch { /* already closed */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('every writable field survives addTask', () => {
  const { addTask, WRITABLE_TASK_FIELDS } = tasksMod;

  // A distinct, type-appropriate value for each field, so a silently-dropped
  // one cannot coincidentally match its default.
  const sample = {
    title: 'Round trip', notes: 'n', rationale: 'r', domain_key: 'career',
    status: 'open', difficulty: 4, engagement: 3, satisfaction: 5,
    strategic_importance: 1, energy_required: 4, anxiety_level: 2,
    time_minutes: 45, learning_value: 3, due_date: '2026-09-01',
    project_id: 'prj_x', action_type: 'deep_work', definition_of_done: 'shipped',
    blocked_by: 'dep_x', source_ref: 'act_x',
    income_impact: 5, commitment_type: 'contracted',
    effort_remaining_minutes: 900, restorative: 4,
  };

  // Guard against the list growing without this test growing with it.
  for (const f of WRITABLE_TASK_FIELDS) {
    assert.ok(f in sample, `no sample value for writable field '${f}' — add one`);
  }

  const saved = addTask(sample);
  for (const f of WRITABLE_TASK_FIELDS) {
    assert.equal(String(saved[f]), String(sample[f]), `field '${f}' did not survive the insert`);
  }
});

test('every writable field survives updateTask', () => {
  const { addTask, updateTask, WRITABLE_TASK_FIELDS } = tasksMod;
  const t = addTask({ title: 'To be updated' });

  const patch = {
    title: 'Updated', notes: 'n2', rationale: 'r2', domain_key: 'health',
    status: 'doing', difficulty: 1, engagement: 1, satisfaction: 2,
    strategic_importance: 4, energy_required: 1, anxiety_level: 5,
    time_minutes: 10, learning_value: 1, due_date: '2026-10-02',
    project_id: 'prj_y', action_type: 'small', definition_of_done: 'done',
    blocked_by: 'dep_y', source_ref: 'act_y',
    income_impact: 1, commitment_type: 'speculative',
    effort_remaining_minutes: 30, restorative: 1,
  };

  const updated = updateTask(t.id, patch);
  for (const f of WRITABLE_TASK_FIELDS) {
    assert.equal(String(updated[f]), String(patch[f]), `field '${f}' did not survive the update`);
  }
});

test('defaults are applied when a field is omitted', () => {
  const t = tasksMod.addTask({ title: 'Minimal' });
  assert.equal(t.strategic_importance, 3);
  assert.equal(t.income_impact, 0);
  assert.equal(t.restorative, 0);
  assert.equal(t.commitment_type, 'personal');
  assert.equal(t.status, 'open');
});

test('deferring increments the count rather than overwriting it', () => {
  const { addTask, updateTask } = tasksMod;
  const t = addTask({ title: 'Avoided' });
  assert.equal(t.deferred_count, 0);
  assert.equal(updateTask(t.id, { status: 'deferred' }).deferred_count, 1);
  assert.equal(updateTask(t.id, { status: 'deferred' }).deferred_count, 2);
});

test('completing stamps completed_at', () => {
  const { addTask, updateTask } = tasksMod;
  const t = addTask({ title: 'Finish me' });
  assert.equal(t.completed_at, null);
  assert.ok(updateTask(t.id, { status: 'done' }).completed_at);
});
