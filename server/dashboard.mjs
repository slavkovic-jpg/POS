import { db } from './db.mjs';
import { getContext } from './context-state.mjs';
import { getStrategy } from './strategy.mjs';
import { listTasks, taskStats, procrastinationCandidates } from './tasks.mjs';
import { listOpenQuestions } from './open-questions.mjs';
import { getOrCreateTodayBriefing } from './briefing.mjs';
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

export function dashboardSummary() {
  const ctx = getContext();
  const strategy = getStrategy();
  const stats = taskStats();
  const tasks = listTasks();
  const profile = getProfile();

  const maxEnergy = { peak: 5, medium: 4, low: 2, overwhelmed: 1 }[ctx.energy_state] ?? 3;

  // Tasks that fit the window AND the energy — the honest "you could do this
  // now" list, computed the same way the decision engine computes it.
  const doable = tasks
    .filter((t) => (t.time_minutes ?? 30) <= ctx.available_minutes
                && (t.energy_required ?? 3) <= maxEnergy)
    .sort((a, b) => (a.strategic_importance ?? 3) - (b.strategic_importance ?? 3));

  const questions = listOpenQuestions();
  const today = new Date().toISOString().slice(0, 10);
  const dueQuestions = questions.filter((q) => q.review_date && q.review_date <= today);

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
      blocked_count: tasks.length - doable.length,
      total_open: tasks.length,
      procrastinating: procrastinationCandidates().slice(0, 4),
    },
    stats,
    questions: { open: questions.slice(0, 5), open_count: questions.length, due: dueQuestions },
    briefing: getOrCreateTodayBriefing(),
    review: { last: lastReview || null, days_since: daysSinceReview, overdue: daysSinceReview === null || daysSinceReview >= 7 },
    decisions_to_review: decisionsToReview,
    neglected_domains: neglected,
    knowledge_count: knowledgeCount,
  };
}
