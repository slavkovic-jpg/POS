import { db, now } from './db.mjs';
import { listOpenQuestions } from './open-questions.mjs';
import { listTasks } from './tasks.mjs';

const STAGES = [
  'urgencies_identified',
  'energy_evaluated',
  'constraints_understood',
  'priorities_agreed',
  'risks_considered',
  'plan_accepted',
];

const today = () => new Date().toISOString().slice(0, 10);

export function getOrCreateTodayBriefing() {
  const date = today();
  let row = db.prepare('SELECT * FROM briefings WHERE date = ?').get(date);
  if (!row) {
    const stages = Object.fromEntries(STAGES.map((s) => [s, false]));
    db.prepare(
      'INSERT INTO briefings (date, stages_json, confidence, created_at) VALUES (?, ?, 0, ?)'
    ).run(date, JSON.stringify(stages), now());
    row = db.prepare('SELECT * FROM briefings WHERE date = ?').get(date);
  }
  const stages = JSON.parse(row.stages_json || '{}');
  const completed = STAGES.filter((s) => stages[s]).length;
  return {
    ...row,
    stages,
    progress: completed / STAGES.length,
    stage_names: STAGES,
    open_questions: listOpenQuestions().slice(0, 5),
    active_tasks: listTasks().slice(0, 10),
  };
}

export function updateBriefing(patch) {
  const date = today();
  const row = getOrCreateTodayBriefing();
  const stages = { ...row.stages };
  if (patch.stages) Object.assign(stages, patch.stages);

  const confidence =
    patch.confidence !== undefined ? patch.confidence : computeConfidence(stages);
  const plan = patch.plan !== undefined ? patch.plan : row.plan;
  const accepted_at = stages.plan_accepted ? (row.accepted_at || now()) : null;

  db.prepare(
    `UPDATE briefings SET stages_json = ?, confidence = ?, plan = ?, accepted_at = ? WHERE date = ?`
  ).run(JSON.stringify(stages), confidence, plan, accepted_at, date);

  return getOrCreateTodayBriefing();
}

function computeConfidence(stages) {
  const completed = STAGES.filter((s) => stages[s]).length;
  return completed / STAGES.length;
}
