import { db } from './db.mjs';
import { getContext } from './context-state.mjs';
import { getStrategy } from './strategy.mjs';
import { listTasks, taskStats, procrastinationCandidates } from './tasks.mjs';
import { listOpenQuestions } from './open-questions.mjs';
import { getOrCreateTodayBriefing } from './briefing.mjs';
import { rankNow } from './workspace.mjs';
import { getProfile } from './onboarding.mjs';

/**
 * Everything the dashboard needs, in one request.
 *
 * Assembled server-side rather than fanning out from the browser so the page
 * paints once, and so the cross-domain reasoning (which strategy domains are
 * being neglected, whether a review is overdue) lives next to the data it
 * reasons about.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * Last review and decisions awaiting one. Shared by `dashboardSummary()` and
 * `navStatus()` so "is a review overdue" has exactly one answer, computed
 * once, rather than two queries that could quietly drift apart.
 */
function reviewStatus(today) {
  const lastReview = db.prepare(
    'SELECT id, kind, period_end, created_at FROM reviews ORDER BY created_at DESC LIMIT 1'
  ).get();
  const daysSinceReview = lastReview
    ? Math.floor((Date.now() - new Date(lastReview.created_at).getTime()) / DAY)
    : null;

  const decisionsToReview = db.prepare(
    `SELECT id, decision, followup_date FROM decisions
     WHERE reviewed_at IS NULL AND followup_date IS NOT NULL AND followup_date <= ?
     ORDER BY followup_date`
  ).all(today);

  return {
    last: lastReview || null,
    days_since: daysSinceReview,
    overdue: daysSinceReview === null || daysSinceReview >= 7,
    decisionsToReview,
  };
}

export function dashboardSummary() {
  const ctx = getContext();
  const strategy = getStrategy();
  const stats = taskStats();
  const tasks = listTasks();
  const profile = getProfile();

  // Ranked by the same engine the recommendation uses. Previously this file
  // re-implemented the fit rule with its own inline energy map, which had
  // already drifted from context-state.mjs — two answers to one question.
  const ranked = rankNow({ limit: 8 });
  const doable = ranked.suggestions.filter((s) => s.fits);

  const questions = listOpenQuestions();
  const today = new Date().toISOString().slice(0, 10);
  const dueQuestions = questions.filter((q) => q.review_date && q.review_date <= today);

  const review = reviewStatus(today);

  // A domain rated high priority in the strategy scaffold with no open tasks
  // is the most useful cross-page signal in the app: intent and action have
  // come apart, and nothing else surfaces that.
  const openByDomain = new Map(stats.by_domain.map((d) => [d.key, d.open_count]));
  const neglected = strategy.domains
    .filter((d) => d.priority <= 2 && (openByDomain.get(d.key) || 0) === 0)
    .map((d) => ({ key: d.key, name: d.name, priority: d.priority }));

  const knowledgeCount = db.prepare('SELECT COUNT(*) AS n FROM knowledge').get().n;

  return {
    context: ctx,
    profile: { name: profile?.name || null, onboarded: !!profile?.onboarded_at },
    strategy: {
      mission: strategy.mission || '',
      has_scaffold: !!(strategy.mission || strategy.identity || strategy.long_term_vision),
      domains: strategy.domains,
    },
    tasks: {
      doable: doable.slice(0, 6),
      doable_count: doable.length,
      blocked_count: ranked.suggestions.length - doable.length,
      total_open: tasks.length,
      procrastinating: procrastinationCandidates().slice(0, 4),
      suppressed: ranked.suggestions.filter((s) => s.suppressed).length,
    },
    ranking: {
      tier: ranked.tier,
      tier_reason: ranked.tierReason,
      income_at_risk: ranked.incomeAtRisk,
    },
    burnout: ranked.burnout,
    risks: ranked.risks.slice(0, 5),
    waiting: ranked.waiting.slice(0, 5),
    stats,
    questions: { open: questions.slice(0, 5), open_count: questions.length, due: dueQuestions },
    briefing: getOrCreateTodayBriefing(),
    review: { last: review.last, days_since: review.days_since, overdue: review.overdue },
    decisions_to_review: review.decisionsToReview,
    neglected_domains: neglected,
    knowledge_count: knowledgeCount,
  };
}

/**
 * The compact numbers the sidebar needs, polled on an interval. Deliberately
 * not `dashboardSummary()` — that carries ranked suggestions, the waiting
 * list, and burnout detail, none of which a nav badge needs, and dragging it
 * along on every poll would cost real bytes for no reason.
 *
 * Counts come from direct queries rather than `rankNow()` — the ranking
 * engine is for deciding what to work on, not for a badge that only needs to
 * say how many rows are in a state.
 *
 * @param afterMessageId  What counts as "unread" is client state (what has
 *   this browser actually seen), which the server has no way to know on its
 *   own — so the client sends the last chat message id it saw, and the
 *   server answers with how many assistant replies came after it. Neither
 *   side owns the whole answer alone.
 */
export function navStatus(afterMessageId = 0) {
  const today = new Date().toISOString().slice(0, 10);

  const unreadReplies = db.prepare(
    `SELECT COUNT(*) AS n FROM chat_messages WHERE role = 'assistant' AND id > ?`
  ).get(afterMessageId).n;

  const taskDay = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END), 0) AS due_today,
       COALESCE(SUM(CASE WHEN due_date = ? AND status = 'done' THEN 1 ELSE 0 END), 0) AS done_today,
       COALESCE(SUM(CASE WHEN due_date < ? AND status IN ('open', 'doing') THEN 1 ELSE 0 END), 0) AS overdue
     FROM tasks`
  ).get(today, today, today);

  const inboxOpen = db.prepare(
    `SELECT COUNT(*) AS n FROM inbox WHERE processing_status != 'done'`
  ).get().n;

  // "Open" is anything not yet closed out, including at_risk — a promise
  // going badly is still a promise you have, not one that stopped counting.
  const commitments = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status NOT IN ('delivered', 'dropped') THEN 1 ELSE 0 END), 0) AS open_count,
       COALESCE(SUM(CASE WHEN status = 'at_risk' THEN 1 ELSE 0 END), 0) AS at_risk
     FROM commitments`
  ).get();

  const projects = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
       COALESCE(SUM(CASE WHEN status IN ('waiting', 'blocked') THEN 1 ELSE 0 END), 0) AS stalled_count
     FROM projects`
  ).get();

  const questionsOpen = db.prepare(
    `SELECT COUNT(*) AS n FROM open_questions WHERE status IN ('awaiting', 'exploring')`
  ).get().n;

  const review = reviewStatus(today);
  const strategy = scaffoldCompletion();
  const profile = getProfile();

  return {
    chat: { unread: unreadReplies },
    tasks: { due_today: taskDay.due_today, done_today: taskDay.done_today, overdue: taskDay.overdue },
    inbox: { open: inboxOpen },
    commitments: { open: commitments.open_count, at_risk: commitments.at_risk },
    projects: { active: projects.active_count, stalled: projects.stalled_count },
    questions: { open: questionsOpen },
    decisions: { to_review: review.decisionsToReview.length },
    review: { overdue: review.overdue },
    strategy,
    onboarded: !!profile?.onboarded_at,
  };
}

/**
 * `filled / total` over the strategy scaffold: the mission/identity/vision/
 * values block, plus current_state and desired_state on every life domain.
 * The same "x of y" shape the user described for onboarding, mapped onto the
 * thing that is actually incomplete — the scaffold, not the separate
 * /onboarding page, which is a one-time CV import rather than an ongoing
 * fill-in-the-blanks.
 */
function scaffoldCompletion() {
  const strategy = getStrategy();
  const topFields = [strategy.mission, strategy.identity, strategy.long_term_vision];
  let filled = topFields.filter((v) => String(v || '').trim()).length;
  if (strategy.values.length > 0) filled += 1;
  let total = topFields.length + 1;

  for (const d of strategy.domains) {
    total += 2;
    if (String(d.current_state || '').trim()) filled += 1;
    if (String(d.desired_state || '').trim()) filled += 1;
  }

  return { filled, total };
}
