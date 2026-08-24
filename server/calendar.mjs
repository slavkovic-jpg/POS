import { db } from './db.mjs';

/**
 * Everything with a date, normalized into one feed for the zoomable
 * calendar: `{ id, kind, title, date, time, duration_minutes, domain_key,
 * tone, link }`.
 *
 * Only tasks ever carry a real `time` — nothing else in the app has a
 * time-of-day, only a date (AGENTS.md's scheduled_at note in migrations.mjs
 * explains why that field exists at all). Everything else renders as an
 * all-day marker: a deadline, a review date, an expected date.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** danger once it's passed, warn on the day itself, neutral otherwise. */
function toneForDate(date, { danger = 'danger', warn = 'warn' } = {}) {
  if (!date) return 'neutral';
  const t = today();
  if (date < t) return danger;
  if (date === t) return warn;
  return 'neutral';
}

export function calendarEvents({ from, to } = {}) {
  const start = from || today();
  const end = to || from || today();
  const out = [];

  // ---- Tasks: scheduled_at (real time) when set, else due_date (all-day) --
  const tasks = db.prepare(
    `SELECT id, title, domain_key, status, due_date, scheduled_at, time_minutes
     FROM tasks
     WHERE status IN ('open', 'doing')
       AND (
         (scheduled_at IS NOT NULL AND substr(scheduled_at, 1, 10) BETWEEN ? AND ?)
         OR (scheduled_at IS NULL AND due_date IS NOT NULL AND due_date BETWEEN ? AND ?)
       )`
  ).all(start, end, start, end);
  for (const t of tasks) {
    const date = t.scheduled_at ? t.scheduled_at.slice(0, 10) : t.due_date;
    const time = t.scheduled_at ? t.scheduled_at.slice(11, 16) : null;
    out.push({
      id: `task-${t.id}`, kind: 'task', title: t.title, date, time,
      duration_minutes: t.scheduled_at ? t.time_minutes : null,
      domain_key: t.domain_key,
      tone: time ? 'neutral' : toneForDate(date),
      link: `/tasks#task-${t.id}`,
    });
  }

  // ---- Commitments: their deadline and your own target, each its own marker
  const commitments = db.prepare(
    `SELECT id, description, external_deadline, internal_target, status
     FROM commitments
     WHERE status NOT IN ('delivered', 'dropped')
       AND ((external_deadline BETWEEN ? AND ?) OR (internal_target BETWEEN ? AND ?))`
  ).all(start, end, start, end);
  for (const c of commitments) {
    const atRisk = c.status === 'at_risk';
    if (c.external_deadline && c.external_deadline >= start && c.external_deadline <= end) {
      out.push({
        id: `commitment-${c.id}-due`, kind: 'commitment', title: `${c.description} (due)`,
        date: c.external_deadline, time: null, duration_minutes: null, domain_key: null,
        tone: atRisk ? 'danger' : toneForDate(c.external_deadline),
        link: `/commitments#commitment-${c.id}`,
      });
    }
    if (c.internal_target && c.internal_target >= start && c.internal_target <= end) {
      out.push({
        id: `commitment-${c.id}-target`, kind: 'commitment', title: `${c.description} (your target)`,
        date: c.internal_target, time: null, duration_minutes: null, domain_key: null,
        tone: atRisk ? 'danger' : toneForDate(c.internal_target),
        link: `/commitments#commitment-${c.id}`,
      });
    }
  }

  // ---- Projects: deadline and next review date ----------------------------
  const projects = db.prepare(
    `SELECT id, name, domain_key, deadline, next_review_date, status
     FROM projects
     WHERE status NOT IN ('archived', 'completed')
       AND ((deadline BETWEEN ? AND ?) OR (next_review_date BETWEEN ? AND ?))`
  ).all(start, end, start, end);
  for (const p of projects) {
    const stalled = ['waiting', 'blocked'].includes(p.status);
    if (p.deadline && p.deadline >= start && p.deadline <= end) {
      out.push({
        id: `project-${p.id}-deadline`, kind: 'project', title: `${p.name} (deadline)`,
        date: p.deadline, time: null, duration_minutes: null, domain_key: p.domain_key,
        tone: stalled ? 'warn' : toneForDate(p.deadline),
        link: `/projects#project-${p.id}`,
      });
    }
    if (p.next_review_date && p.next_review_date >= start && p.next_review_date <= end) {
      out.push({
        id: `project-${p.id}-review`, kind: 'project', title: `${p.name} (review)`,
        date: p.next_review_date, time: null, duration_minutes: null, domain_key: p.domain_key,
        tone: 'neutral',
        link: `/projects#project-${p.id}`,
      });
    }
  }

  // ---- Decisions: follow-up date ------------------------------------------
  const decisions = db.prepare(
    `SELECT id, decision, followup_date FROM decisions
     WHERE reviewed_at IS NULL AND followup_date BETWEEN ? AND ?`
  ).all(start, end);
  for (const d of decisions) {
    out.push({
      id: `decision-${d.id}`, kind: 'decision', title: d.decision,
      date: d.followup_date, time: null, duration_minutes: null, domain_key: null,
      tone: toneForDate(d.followup_date),
      link: `/decisions#decision-${d.id}`,
    });
  }

  // ---- Open questions: review date ----------------------------------------
  const questions = db.prepare(
    `SELECT id, question, review_date FROM open_questions
     WHERE status IN ('awaiting', 'exploring') AND review_date BETWEEN ? AND ?`
  ).all(start, end);
  for (const q of questions) {
    out.push({
      id: `question-${q.id}`, kind: 'open_question', title: q.question,
      date: q.review_date, time: null, duration_minutes: null, domain_key: null,
      tone: toneForDate(q.review_date),
      link: `/questions#question-${q.id}`,
    });
  }

  // ---- Dependencies: expected date -----------------------------------------
  const dependencies = db.prepare(
    `SELECT id, dependency, expected_date, risk_level FROM dependencies
     WHERE status IN ('waiting', 'chasing') AND expected_date BETWEEN ? AND ?`
  ).all(start, end);
  for (const dep of dependencies) {
    out.push({
      id: `dependency-${dep.id}`, kind: 'dependency', title: dep.dependency,
      date: dep.expected_date, time: null, duration_minutes: null, domain_key: null,
      tone: dep.risk_level === 'high' ? 'danger' : toneForDate(dep.expected_date),
      link: '/inbox',
    });
  }

  // ---- Health signals: informational, never urgent ------------------------
  const health = db.prepare(
    `SELECT id, date, sleep_hours FROM health_signals WHERE date BETWEEN ? AND ?`
  ).all(start, end);
  for (const h of health) {
    out.push({
      id: `health-${h.id}`, kind: 'health_signal',
      title: h.sleep_hours != null ? `Sleep ${h.sleep_hours}h` : 'Health signal',
      date: h.date, time: null, duration_minutes: null, domain_key: 'health',
      tone: 'neutral', link: '/dashboard',
    });
  }

  return out.sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
}
