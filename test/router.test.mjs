import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';

process.env.POS_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pos-router-'));

const { migrate } = await import('../server/migrations.mjs');
migrate();

const { salvageItems } = await import('../server/schemas.mjs');
const {
  splitFragments, preClassify, commitRoutes, BLAST_RADIUS,
  recordCorrection, learnedExamples, normalizeDate,
  routingContext, resolveRef, similarity, nearestMatch, cleanKeys,
} = await import('../server/router.mjs');
const { db } = await import('../server/db.mjs');
const { slackFor, parseDateLoose } = await import('../server/scoring.mjs');

// ---------------------------------------------------------------------------
// Relative dates — the silent one
// ---------------------------------------------------------------------------

// A Wednesday, so "Friday" is +2 and weekday maths is visible.
const WED = new Date(2026, 7, 19, 9, 0, 0);

test('weekday names resolve to the next occurrence', () => {
  assert.equal(normalizeDate('Friday', WED), '2026-08-21');
  assert.equal(normalizeDate('by Friday', WED), '2026-08-21');
  assert.equal(normalizeDate('monday', WED), '2026-08-24');
});

test('"Friday" said on a Friday means today, not next week', () => {
  const fri = new Date(2026, 7, 21, 9, 0, 0);
  assert.equal(normalizeDate('Friday', fri), '2026-08-21');
  assert.equal(normalizeDate('next Friday', fri), '2026-08-28');
});

test('common relative phrases resolve', () => {
  assert.equal(normalizeDate('today', WED), '2026-08-19');
  assert.equal(normalizeDate('tomorrow', WED), '2026-08-20');
  assert.equal(normalizeDate('in 3 days', WED), '2026-08-22');
  assert.equal(normalizeDate('next week', WED), '2026-08-26');
  assert.equal(normalizeDate('end of the week', WED), '2026-08-21');
  assert.equal(normalizeDate('end of month', WED), '2026-08-31');
});

test('real dates pass through untouched', () => {
  assert.equal(normalizeDate('2026-09-01', WED), '2026-09-01');
  assert.equal(normalizeDate('01.09.2026', WED), '2026-09-01');
});

test('genuine non-dates return null rather than a guess', () => {
  assert.equal(normalizeDate('soon', WED), null);
  assert.equal(normalizeDate('when I get round to it', WED), null);
  assert.equal(normalizeDate('', WED), null);
});

test('REGRESSION: a 3-day job due "Friday" produces real slack', () => {
  // The bug: a model echoes the user's words, so due_date arrives as "Friday".
  // parseDateLoose cannot read it, slackFor returns null, and the single
  // scenario Tier 0 exists for silently never fires.
  assert.equal(parseDateLoose('Friday'), null, 'precondition: raw "Friday" is unreadable');
  assert.equal(
    slackFor({ external_deadline: 'Friday', effort_remaining_minutes: 4320 }, WED),
    null, 'precondition: raw "Friday" yields no slack');

  const normalized = normalizeDate('Friday', WED);
  const slack = slackFor(
    { external_deadline: normalized, effort_remaining_minutes: 4320 }, WED, 6);

  assert.ok(slack, 'normalized date must produce slack');
  assert.equal(slack.band, 'critical');
  assert.ok(slack.hours < 0, `expected negative slack, got ${slack.hours}`);
});

// ---------------------------------------------------------------------------
// Fragmenting
// ---------------------------------------------------------------------------

test('splits on lines and strips bullet markers', () => {
  const f = splitFragments('- Call Mum\n* Book physio\n1. Send invoice');
  assert.deepEqual(f, ['Call Mum', 'Book physio', 'Send invoice']);
});

test('splits a long dictated run into sentences', () => {
  const long = 'I need to finish the report for Sarah by Friday. ' +
    'Also I keep thinking about whether the consulting thing is worth it. ' +
    'And I slept about five hours last night which is why today felt rough. ' +
    'Maybe I could try blocking the mornings for deep work instead of meetings.';
  const f = splitFragments(long);
  assert.ok(f.length >= 4, `expected 4+ fragments, got ${f.length}`);
});

test('empty input yields no fragments', () => {
  assert.deepEqual(splitFragments('   \n  '), []);
});

// ---------------------------------------------------------------------------
// Deterministic rules — the no-model path
// ---------------------------------------------------------------------------

test('rules classify without any model available', () => {
  assert.equal(preClassify('Is the consulting work actually worth it?').destination, 'open_question');
  assert.equal(preClassify('Idea: a weekly digest of open questions').destination, 'idea');
  assert.equal(preClassify("I've decided to drop the newsletter").destination, 'decision');
  assert.equal(preClassify('Slept 5 hours, energy was low all day').destination, 'health_signal');
});

test('a request phrased as a question is not an open question', () => {
  assert.equal(preClassify('Can you book the physio appointment?'), null);
});

test('commitment needs a person, a date AND a deliverable', () => {
  assert.equal(
    preClassify('Send the report to Sarah by Friday').destination, 'commitment');
  // Missing the deliverable verb — a note to self, not a promise.
  assert.equal(preClassify('Coffee with Sarah on Friday'), null);
  // Missing the date.
  assert.equal(preClassify('Send the report to Sarah'), null);
});

test('"Call Mum" is never a commitment', () => {
  const r = preClassify('Call Mum');
  assert.ok(r === null || r.destination !== 'commitment');
});

test('unrecognised text gets no rule opinion rather than a guess', () => {
  assert.equal(preClassify('The thing about the other thing'), null);
});

// ---------------------------------------------------------------------------
// Blast radius — the ordering that puts dangerous rows in front of fresh eyes
// ---------------------------------------------------------------------------

test('commitment and knowledge outrank tasks in blast radius', () => {
  assert.ok(BLAST_RADIUS.commitment > BLAST_RADIUS.task);
  assert.ok(BLAST_RADIUS.knowledge > BLAST_RADIUS.task);
  assert.ok(BLAST_RADIUS.unclear < BLAST_RADIUS.task);
});

// ---------------------------------------------------------------------------
// Commit — the only writer
// ---------------------------------------------------------------------------

const countOf = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

test('commit writes each destination to its own table', () => {
  const before = {
    tasks: countOf('tasks'), commitments: countOf('commitments'),
    ideas: countOf('ideas'), knowledge: countOf('knowledge'),
    inbox: countOf('inbox'),
  };

  const r = commitRoutes([
    { text: 'Book physio', destination: 'task', proposed: 'task', confidence: 'high', fields: { time_minutes: 15 } },
    { text: 'Send report to Sarah by Friday', destination: 'commitment', proposed: 'commitment', confidence: 'high',
      fields: { waiting_party: 'Sarah', due_date: '2026-08-28', effort_remaining_minutes: 240 } },
    { text: 'A weekly digest of open questions', destination: 'idea', proposed: 'idea', confidence: 'medium', fields: {} },
    { text: 'I focus best before 11am', destination: 'knowledge', proposed: 'knowledge', confidence: 'high', fields: { category: 'energy' } },
    { text: 'the thing about the thing', destination: 'unclear', proposed: 'unclear', confidence: 'low', fields: {} },
  ]);

  assert.equal(r.count, 5);
  assert.deepEqual(r.errors, []);
  assert.equal(countOf('tasks'), before.tasks + 1);
  assert.equal(countOf('commitments'), before.commitments + 1);
  assert.equal(countOf('ideas'), before.ideas + 1);
  assert.equal(countOf('knowledge'), before.knowledge + 1);
  assert.equal(countOf('inbox'), before.inbox + 1);
});

test('skipped items are not written', () => {
  const before = countOf('tasks');
  const r = commitRoutes([
    { text: 'Nope', destination: 'task', proposed: 'task', skip: true, fields: {} },
  ]);
  assert.equal(r.count, 0);
  assert.equal(countOf('tasks'), before);
});

test('effort_remaining_minutes survives the write — the field the scorer needs', () => {
  commitRoutes([{
    text: 'Rebuild the Q3 model', destination: 'task', proposed: 'task', confidence: 'high',
    fields: { effort_remaining_minutes: 1080, due_date: '2026-08-21', income_impact: 4, commitment_type: 'contracted' },
  }]);
  const row = db.prepare(
    'SELECT * FROM tasks WHERE title = ?').get('Rebuild the Q3 model');
  // A dropped column here is exactly how an 18-hour job once scored 7.
  assert.equal(row.effort_remaining_minutes, 1080);
  assert.equal(row.income_impact, 4);
  assert.equal(row.commitment_type, 'contracted');
});

test('a changed destination is recorded as a correction; an unchanged one is not', () => {
  const before = learnedExamples(100).length;
  commitRoutes([
    { text: 'Ping the accountant about the VAT thing', destination: 'task', proposed: 'unclear', confidence: 'low', fields: {} },
    { text: 'Book dentist', destination: 'task', proposed: 'task', confidence: 'high', fields: {} },
  ]);
  const after = learnedExamples(100);
  assert.equal(after.length, before + 1, 'only the changed one should be learned');
  assert.equal(after[0].chosen, 'task');
});

test('an unknown destination falls back to inbox rather than throwing', () => {
  const before = countOf('inbox');
  const r = commitRoutes([
    { text: 'mystery', destination: 'nonsense_destination', proposed: 'task', fields: {} },
  ]);
  assert.equal(r.count, 1);
  assert.equal(countOf('inbox'), before + 1);
});

test('an invalid domain key is dropped rather than stored as a near-miss', () => {
  // "career/contribution" matches no row in life_domains, so a task carrying it
  // shows no badge and is missing from every domain rollup — absent, not wrong.
  commitRoutes([
    { text: 'Domain test A', destination: 'task', proposed: 'task', confidence: 'high',
      fields: { domain_key: 'career/contribution' } },
    { text: 'Domain test B', destination: 'task', proposed: 'task', confidence: 'high',
      fields: { domain_key: 'career' } },
  ]);
  const keys = db.prepare('SELECT key FROM life_domains').all().map((d) => d.key);
  const a = db.prepare('SELECT domain_key FROM tasks WHERE title = ?').get('Domain test A');
  const b = db.prepare('SELECT domain_key FROM tasks WHERE title = ?').get('Domain test B');
  assert.ok(!a.domain_key || keys.includes(a.domain_key),
    `stored an unknown domain key: ${a.domain_key}`);
  assert.equal(b.domain_key, 'career', 'a valid key must survive');
});

test('items sharing a group all link to the project created in that batch', () => {
  const r = commitRoutes([
    // Deliberately out of order: the task comes first, so this only passes if
    // projects are written before the things that point at them.
    { text: 'Draft the sitemap', destination: 'task', proposed: 'task', confidence: 'high',
      fields: { group: 'g1', due_date: '2026-09-01' } },
    { text: 'Waiting on brand assets', destination: 'dependency', proposed: 'dependency',
      confidence: 'high', fields: { group: 'g1', owner: 'the client' } },
    { text: 'Website rebuild', destination: 'project', proposed: 'project', confidence: 'high',
      fields: { group: 'g1', title: 'Website rebuild', source_link: 'https://example.com/x' } },
  ]);
  assert.equal(r.count, 3);

  const p = db.prepare('SELECT id, source_links FROM projects WHERE name = ?').get('Website rebuild');
  assert.ok(p, 'project must exist');
  assert.equal(p.source_links, 'https://example.com/x');

  const t = db.prepare('SELECT project_id FROM tasks WHERE title = ?').get('Draft the sitemap');
  const dep = db.prepare('SELECT project_id, owner FROM dependencies WHERE dependency = ?')
    .get('Waiting on brand assets');
  assert.equal(t.project_id, p.id, 'task must link to the project from its group');
  assert.equal(dep.project_id, p.id, 'dependency must link to the project from its group');
  assert.equal(dep.owner, 'the client');
});

test('a group with no project in the batch links nothing, rather than guessing', () => {
  commitRoutes([
    { text: 'Orphan task', destination: 'task', proposed: 'task', confidence: 'high',
      fields: { group: 'nonexistent_group' } },
  ]);
  const t = db.prepare('SELECT project_id FROM tasks WHERE title = ?').get('Orphan task');
  assert.ok(!t.project_id, `expected no project link, got ${t.project_id}`);
});

test('recordCorrection ignores a no-op change', () => {
  const before = learnedExamples(100).length;
  recordCorrection('same', 'task', 'task');
  assert.equal(learnedExamples(100).length, before);
});

// ---------------------------------------------------------------------------
// Existing records — linking instead of duplicating
// ---------------------------------------------------------------------------

test('routingContext lists what is open, with short references', () => {
  const { written } = commitRoutes([
    { text: 'Q3 reporting', destination: 'project', proposed: 'project',
      confidence: 'high', fields: { title: 'Q3 reporting' } },
  ]);
  const projectId = written[0].id;

  const ctx = routingContext();
  const mine = ctx.projects.find((p) => p.id === projectId);
  assert.ok(mine, 'an open project must appear in the routing context');
  assert.match(mine.ref, /^P\d+$/, 'the model is handed a short reference, not a raw id');
  assert.equal(mine.name, 'Q3 reporting');
});

test('routingContext excludes what is closed', () => {
  const { written } = commitRoutes([
    { text: 'Old thing', destination: 'project', proposed: 'project',
      confidence: 'high', fields: { title: 'Old thing' } },
  ]);
  db.prepare("UPDATE projects SET status = 'completed' WHERE id = ?").run(written[0].id);
  assert.ok(!routingContext().projects.some((p) => p.id === written[0].id));
});

test('a reference resolves to its row; an invented one resolves to nothing', () => {
  const ctx = routingContext();
  assert.ok(ctx.projects.length, 'precondition: something to link to');
  const first = ctx.projects[0];
  assert.equal(resolveRef(ctx.projects, first.ref).id, first.id);
  assert.equal(resolveRef(ctx.projects, first.id).id, first.id, 'a raw id still works');
  assert.equal(resolveRef(ctx.projects, 'P999'), null);
  assert.equal(resolveRef(ctx.projects, 'prj_made_up'), null);
});

test('a task links to an existing project', () => {
  const project = routingContext().projects.find((p) => p.name === 'Q3 reporting');
  commitRoutes([
    { text: 'Finish the Q3 model', destination: 'task', proposed: 'task',
      confidence: 'high', fields: { project_id: project.id } },
  ]);
  const t = db.prepare('SELECT project_id FROM tasks WHERE title = ?').get('Finish the Q3 model');
  assert.equal(t.project_id, project.id);
});

test('a project_id matching no row is dropped rather than stored', () => {
  // An orphan is obvious. A link pointing at nothing looks filed and is not.
  commitRoutes([
    { text: 'Book a dentist', destination: 'task', proposed: 'task',
      confidence: 'high', fields: { project_id: 'prj_does_not_exist' } },
  ]);
  const t = db.prepare('SELECT project_id FROM tasks WHERE title = ?').get('Book a dentist');
  assert.ok(!t.project_id, `expected no project link, got ${t.project_id}`);
});

test('existing_id updates the commitment instead of recording it twice', () => {
  const first = commitRoutes([
    { text: 'Send the Q3 model to Sarah by Friday', destination: 'commitment',
      proposed: 'commitment', confidence: 'high',
      fields: { waiting_party: 'Sarah', due_date: '2026-08-21', effort_remaining_minutes: 240 } },
  ]).written[0];

  const before = countOf('commitments');
  const again = commitRoutes([
    { text: 'Still need to send Sarah the Q3 model, now Monday', destination: 'commitment',
      proposed: 'commitment', confidence: 'high',
      fields: { existing_id: first.id, due_date: '2026-08-24' } },
  ]).written[0];

  assert.equal(countOf('commitments'), before, 'no second obligation for one promise');
  assert.equal(again.id, first.id);
  assert.equal(again.updated, true);

  const row = db.prepare('SELECT * FROM commitments WHERE id = ?').get(first.id);
  assert.equal(row.external_deadline, '2026-08-24', 'the new date applies');
  assert.equal(row.waiting_party, 'Sarah', 'a field not restated is not blanked');
  assert.equal(row.effort_remaining_minutes, 240);
  assert.match(row.latest_update, /Monday/);
});

test('an existing_id matching no row creates rather than throwing', () => {
  const before = countOf('commitments');
  const r = commitRoutes([
    { text: 'Invoice Acme for the audit by Friday', destination: 'commitment',
      proposed: 'commitment', confidence: 'high',
      fields: { existing_id: 'cmt_invented', due_date: '2026-08-21' } },
  ]);
  assert.deepEqual(r.errors, []);
  assert.equal(countOf('commitments'), before + 1);
  assert.ok(!r.written[0].updated);
});

test('a re-worded promise is recognised; an unrelated one is not', () => {
  const pool = routingContext().commitments;
  const near = nearestMatch(pool, 'send Sarah the Q3 model');
  assert.ok(near, 'the same promise in different words must be offered as a match');
  assert.match(near.name, /Q3 model/);
  assert.equal(nearestMatch(pool, 'Book a dentist appointment'), null);
});

test('one shared word is a coincidence, not a duplicate', () => {
  assert.equal(similarity('Invoice Acme', 'Invoice Bergman'), 0);
  assert.ok(similarity('Send the Q3 model to Sarah', 'Send Sarah the Q3 model') > 0.9);
});

// ---------------------------------------------------------------------------
// A response that stops being JSON halfway
// ---------------------------------------------------------------------------

test('the complete records survive a response that breaks mid-way', () => {
  // Verbatim shape of a real hosted-provider failure on an HTTP 200: two good
  // records, then the model starts escaping its own quotes and never recovers.
  // Strict parsing yields nothing and the whole batch would come back
  // "unclear" — with most of the answer sitting right there.
  const corrupt = '{"items": [{"text": "need to finish the Q3 model", "destination": "task", "confidence": "high", "why": "w", "project_id": "P1"}, {"text": "send Sarah the summary by Friday", "destination": "commitment", "confidence": "high", "why": "w"}, {": "text\\": \\"book a dentist\\", \\"destination\\": \\"task\\"}]}```json {"';

  const items = salvageItems(corrupt);
  assert.equal(items.length, 2, 'both complete records must survive');
  assert.equal(items[0].destination, 'task');
  assert.equal(items[0].project_id, 'P1', 'the link on a salvaged item survives too');
  assert.equal(items[1].destination, 'commitment');
});

test('salvage returns nothing rather than guessing at junk', () => {
  assert.deepEqual(salvageItems('I am sorry, I cannot help with that.'), []);
  assert.deepEqual(salvageItems(''), []);
  assert.deepEqual(salvageItems(null), []);
});

test('a stray colon on a model key does not cost a commitment its deadline', () => {
  // Observed on an otherwise perfect, cleanly parsed response: "due_date:"
  // instead of "due_date". The field is then simply absent — no deadline, no
  // slack, and Tier 0 never fires for the one case it exists for.
  assert.deepEqual(
    cleanKeys({ 'due_date:': 'Friday', 'importance ': 'high', text: 'x' }),
    { due_date: 'Friday', importance: 'high', text: 'x' });
  assert.equal(cleanKeys(null), null);
});
