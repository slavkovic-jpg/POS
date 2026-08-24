import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';

process.env.POS_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pos-dashboard-'));

const { migrate } = await import('../server/migrations.mjs');
migrate();

const { navStatus } = await import('../server/dashboard.mjs');
const { addTask } = await import('../server/tasks.mjs');
const { createEntity } = await import('../server/entities.mjs');
const { updateStrategy, updateDomain, getStrategy } = await import('../server/strategy.mjs');
const { saveMessage } = await import('../server/chat.mjs');

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

test('a fresh workspace reports zero everywhere, not an error', () => {
  const s = navStatus();
  assert.equal(s.tasks.due_today, 0);
  assert.equal(s.tasks.overdue, 0);
  assert.equal(s.commitments.open, 0);
  assert.equal(s.onboarded, false);
});

test('tasks due today, done today, and overdue are counted separately', () => {
  addTask({ title: 'due today, still open', due_date: today });
  addTask({ title: 'due today, finished', due_date: today, status: 'done' });
  addTask({ title: 'overdue', due_date: yesterday });
  addTask({ title: 'no date' });

  const s = navStatus();
  assert.equal(s.tasks.due_today, 2, 'both today-dated tasks count, regardless of status');
  assert.equal(s.tasks.done_today, 1);
  assert.equal(s.tasks.overdue, 1, 'yesterday and still open is overdue; a task with no date is not');
});

test('inbox counts only rows not yet triaged', () => {
  createEntity('inbox', { raw_content: 'new capture' });
  createEntity('inbox', { raw_content: 'already handled', processing_status: 'done' });
  assert.equal(navStatus().inbox.open, 1);
});

test('commitments: open+in_progress counted, at_risk flagged separately', () => {
  createEntity('commitments', { description: 'a promise', status: 'open' });
  createEntity('commitments', { description: 'in trouble', status: 'at_risk' });
  createEntity('commitments', { description: 'done with', status: 'delivered' });

  const s = navStatus();
  assert.equal(s.commitments.open, 2, 'at_risk is still open work, so it counts here too');
  assert.equal(s.commitments.at_risk, 1);
});

test('projects: active counted, waiting/blocked flagged as stalled', () => {
  createEntity('projects', { name: 'moving' });                       // defaults to active
  createEntity('projects', { name: 'stuck', status: 'blocked' });
  createEntity('projects', { name: 'archived one', status: 'archived' });

  const s = navStatus();
  assert.equal(s.projects.active, 1);
  assert.equal(s.projects.stalled, 1);
});

test('scaffold completion counts filled fields against a fixed total', () => {
  const before = navStatus().strategy;
  const domainCount = getStrategy().domains.length;
  assert.equal(before.total, 4 + domainCount * 2, 'mission/identity/vision/values plus 2 per domain');
  assert.equal(before.filled, 0);

  updateStrategy({ mission: 'do the thing' });
  const oneField = navStatus().strategy;
  assert.equal(oneField.filled, 1);

  const firstDomain = getStrategy().domains[0].key;
  updateDomain(firstDomain, { current_state: 'here', desired_state: 'there' });
  assert.equal(navStatus().strategy.filled, 3);
});

test('unread replies are counted after a client-supplied cursor, not a server-side concept', () => {
  // "Unread" is what a particular browser has seen, which the server cannot
  // know on its own — it can only answer "how many came after id X".
  const a = saveMessage('user', 'hello');
  const b = saveMessage('assistant', 'hi there');
  const c = saveMessage('assistant', 'and another thing');

  assert.equal(navStatus(0).chat.unread, 2, 'both assistant replies are unread from a cursor of 0');
  assert.equal(navStatus(b.id).chat.unread, 1, 'only the reply after the cursor counts');
  assert.equal(navStatus(c.id).chat.unread, 0, 'caught up to the latest reply');
  assert.equal(navStatus(a.id).chat.unread, 2, 'a user message id is a valid cursor too');
});
