import { db, now } from './db.mjs';
import { oneShotJson } from './llm.mjs';
import { REVIEW_SCHEMA } from './schemas.mjs';
import { getStrategy } from './strategy.mjs';
import { listOpenQuestions } from './open-questions.mjs';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// ---- CRUD -----------------------------------------------------------------
export function listReviews(kind) {
  if (kind) {
    return db.prepare('SELECT * FROM reviews WHERE kind = ? ORDER BY period_end DESC').all(kind);
  }
  return db.prepare('SELECT * FROM reviews ORDER BY period_end DESC').all();
}

export function getReview(id) {
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
}

export function startReview({ kind = 'weekly' } = {}) {
  if (kind !== 'weekly' && kind !== 'monthly') {
    throw new Error(`kind must be 'weekly' or 'monthly'`);
  }
  const end = new Date();
  const start = new Date(end.getTime() - (kind === 'monthly' ? MONTH_MS : WEEK_MS));
  const info = db.prepare(
    `INSERT INTO reviews (kind, period_start, period_end, created_at) VALUES (?, ?, ?, ?)`
  ).run(kind, start.toISOString(), end.toISOString(), now());
  return getReview(info.lastInsertRowid);
}

export function updateReview(id, patch) {
  const cols = [
    'achievements', 'failures', 'lessons',
    'energy_notes', 'burnout_indicators',
    'next_period_recommendations',
  ];
  const fields = [];
  const args = [];
  for (const k of cols) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); args.push(patch[k]); }
  }
  if (!fields.length) return getReview(id);
  args.push(id);
  db.prepare(`UPDATE reviews SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getReview(id);
}

// ---- Activity gathering ---------------------------------------------------
export function gatherActivity(periodStart, periodEnd) {
  const decisions = db.prepare(
    `SELECT decision, reasoning, confidence, decided_at FROM decisions
     WHERE decided_at >= ? AND decided_at <= ?
     ORDER BY decided_at`
  ).all(periodStart, periodEnd);

  const tasksDone = db.prepare(
    `SELECT title, domain_key, satisfaction, strategic_importance, completed_at FROM tasks
     WHERE completed_at IS NOT NULL AND completed_at >= ? AND completed_at <= ?
     ORDER BY completed_at`
  ).all(periodStart, periodEnd);

  const tasksDeferred = db.prepare(
    `SELECT title, domain_key, deferred_count FROM tasks
     WHERE deferred_count >= 2 AND status IN ('open', 'doing')
     ORDER BY deferred_count DESC`
  ).all();

  const questionsRaised = db.prepare(
    `SELECT question, context, strategic_importance, status FROM open_questions
     WHERE created_at >= ? AND created_at <= ?
     ORDER BY strategic_importance`
  ).all(periodStart, periodEnd);

  const openQuestions = listOpenQuestions();

  const chatCounts = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_msgs
     FROM chat_messages
     WHERE created_at >= ? AND created_at <= ?`
  ).get(periodStart, periodEnd);

  return {
    decisions,
    tasks_done: tasksDone,
    tasks_procrastinating: tasksDeferred,
    questions_raised: questionsRaised,
    open_questions: openQuestions.slice(0, 10),
    chat_activity: chatCounts,
    strategy_snapshot: getStrategy(),
  };
}

// ---- LLM draft generation -------------------------------------------------
const REVIEW_SYSTEM = `You are conducting a structured periodic review as the user's Chief of Staff.

You will receive a JSON snapshot of the user's activity during the review period plus their strategy scaffold. Draft the review by returning a JSON object with these fields:

{
  "achievements": "3-5 bullet points, one line each, prefixed with '- '. Concrete wins, not fluff.",
  "failures": "3-5 bullet points of what didn't work or slipped. Non-judgmental. Include patterns, not just events.",
  "lessons": "2-4 lessons the user should carry forward. Each should be a durable principle, not a task.",
  "energy_notes": "2-3 sentences on energy and engagement patterns you observe in the data (or 'insufficient data' if you truly can't tell).",
  "burnout_indicators": "Concrete signals if any (high procrastination + low satisfaction + high volume of user messages late at night = warning). If none, say 'no strong signals — check in on sleep and recovery anyway.'",
  "next_period_recommendations": "3-5 bullet points. Each should be SPECIFIC — a decision to make, a habit to install, an open question to resolve. Not vague like 'focus more'."
}

Rules:
- Return only the JSON object, no markdown, no prose outside it.
- If the data is thin, say so honestly rather than inventing content.
- Reference specific decisions/tasks/questions by name where useful.
- The user decides; you recommend. Frame recommendations, don't dictate.`;

export async function generateReview(id) {
  const review = getReview(id);
  if (!review) throw new Error(`review ${id} not found`);

  const activity = gatherActivity(review.period_start, review.period_end);
  const payload = {
    review_kind: review.kind,
    period_start: review.period_start,
    period_end: review.period_end,
    activity,
  };

  const result = await oneShotJson({
    system: REVIEW_SYSTEM,
    user: JSON.stringify(payload, null, 2),
    maxTokens: 2000,
    timeoutMs: 300_000,
    schema: REVIEW_SCHEMA,
  });

  const draft = result.json || {};
  const patch = {
    achievements: draft.achievements ?? '',
    failures: draft.failures ?? '',
    lessons: draft.lessons ?? '',
    energy_notes: draft.energy_notes ?? '',
    burnout_indicators: draft.burnout_indicators ?? '',
    next_period_recommendations: draft.next_period_recommendations ?? '',
  };

  updateReview(id, patch);
  const updated = getReview(id);
  return { ...updated, source: result.source, model: result.model, activity };
}
