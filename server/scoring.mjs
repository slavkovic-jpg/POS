/**
 * "What should I do now?" — deterministic, inspectable, no AI.
 *
 * Ported from ExecAgent's ranking.js and extended with the four things it had
 * no concept of: money, real deadline slack, burnout, and fulfilment.
 *
 * Pure. No database, no network, no model. That is load-bearing, not tidiness:
 * prioritisation is the one thing that must keep working when every backend is
 * down, and arithmetic is the only part of this app that can be genuinely
 * tested.
 *
 * Two rules inherited from ExecAgent, and worth restating because they are the
 * first things that erode:
 *
 *   1. Every suggestion carries its reasons in plain language. A ranking you
 *      cannot argue with is a ranking you cannot trust.
 *   2. No reason ever comments on the person. It describes the work, the date,
 *      or who is waiting — never "you failed to", "you wasted", or the polite
 *      versions of the same.
 */

// ---------------------------------------------------------------------------
// Dates — tolerant, because deadlines get typed however felt natural at the time
// ---------------------------------------------------------------------------

/** Accepts ISO, YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY. Returns a Date or null. */
export function parseDateLoose(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const s = String(value).trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return new Date(+iso[1], +iso[2] - 1, +iso[3],
                    +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0));
  }
  // Day-first, which is the convention where this is used.
  const dmy = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})\.?$/);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole days from `from` to `to`. Negative means the date has passed. */
export function daysUntil(value, from) {
  const target = parseDateLoose(value);
  if (!target) return null;
  const base = from || new Date();
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.round((a - b) / 86400000);
}

export function daysSince(value, from) {
  const d = daysUntil(value, from);
  return d === null ? null : -d;
}

/** "in 3 days", "today", "5 days ago" — plain, never alarmed. */
export function humanDays(n) {
  if (n === null || n === undefined) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
}

function humanHours(h) {
  const a = Math.abs(Math.round(h));
  if (a < 1) return 'under an hour';
  if (a === 1) return 'an hour';
  if (a < 16) return `${a} hours`;
  const d = Math.round(a / 8);
  return d === 1 ? 'about a day' : `about ${d} days`;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_WEIGHTS = {
  commitmentOverdue: 100, commitmentDue3: 70, commitmentDue7: 45, commitmentDue14: 25,
  deadlineOverdue: 80, deadlineDue3: 55, deadlineDue7: 35, deadlineDue14: 18,
  importanceHigh: 15, importanceMedium: 7,
  urgencyHigh: 12, urgencyMedium: 5,
  staleProject: 12,
  capacityMatch: 30, capacityMismatch: -15,
  quickWin: 8, quickWinWhenSmall: 25,
  dependencyRisk: 10, repeatedlyCarried: 10,
  inProgress: 14, resumeAvailable: 22,
  income: 14, restorative: 8, fulfilment: 5, therapyBonus: 35,
  slackCritical: 150, slackAtRisk: 60, slackTight: 25,
  nonIncomeSuppression: 0.25,
  workHoursPerDay: 6,
};

/** Missing your own target is real, but not the same as missing theirs. */
const INTERNAL_WEIGHT = 0.8;
const STALE_DAYS = 21;
const RISK_HORIZON_DAYS = 14;
const QUICK_WIN_MINUTES = 20;
const FINISHABLE_MINUTES = 45;

/** How much energy a task may demand at each state. */
export const MAX_TASK_ENERGY = { peak: 5, medium: 4, low: 2, overwhelmed: 1 };

const BURNOUT_BANDS = ['ok', 'elevated', 'high', 'severe'];
const bandAtLeast = (band, min) => BURNOUT_BANDS.indexOf(band) >= BURNOUT_BANDS.indexOf(min);

// ---------------------------------------------------------------------------
// Commitment clock — which date actually governs
// ---------------------------------------------------------------------------

/**
 * Whichever of the promised external deadline and your own internal target
 * falls first. Scoring only the external date made the internal one
 * decorative, and meant the first nudge arrived when there was no longer time
 * to act on it.
 */
export function commitmentClock(c, now) {
  const ext = daysUntil(c.external_deadline, now);
  const own = daysUntil(c.internal_target, now);
  if (ext === null && own === null) return null;
  if (own === null) return { days: ext, kind: 'external' };
  if (ext === null) return { days: own, kind: 'internal' };
  return own <= ext ? { days: own, kind: 'internal' } : { days: ext, kind: 'external' };
}

function commitmentReason(c, clock, now) {
  const who = c.waiting_party || 'someone outside';
  if (clock.kind === 'internal') {
    const ext = daysUntil(c.external_deadline, now);
    const tail = ext === null ? '' : ` ${who} expects it ${humanDays(ext)}.`;
    return (clock.days < 0
      ? `Your own target passed ${humanDays(clock.days)}.`
      : `Your own target is ${humanDays(clock.days)}.`) + tail;
  }
  return clock.days < 0
    ? `${who} is waiting and the agreed date passed ${humanDays(clock.days)}.`
    : `${who} is expecting this ${humanDays(clock.days)}.`;
}

function commitmentWeight(clock, W) {
  const d = clock.days;
  const base = d < 0 ? W.commitmentOverdue
    : d <= 3 ? W.commitmentDue3
    : d <= 7 ? W.commitmentDue7
    : d <= 14 ? W.commitmentDue14
    : 0;
  return clock.kind === 'internal' ? Math.round(base * INTERNAL_WEIGHT) : base;
}

// ---------------------------------------------------------------------------
// Slack — the mechanic ExecAgent lacked
// ---------------------------------------------------------------------------

/**
 * Days-until-due answers "when is this due". It does not answer the question
 * that actually matters: **can this still be delivered at all?**
 *
 * A 3-day job due tomorrow and a 20-minute errand due tomorrow are both "due
 * tomorrow". Only one of them is an emergency.
 *
 * @returns {null | {hours, capacityHours, effortHours, band, dueInDays}}
 *          band: critical | at_risk | tight | ok
 */
export function slackFor(item, now = new Date(), hoursPerDay = 6) {
  const due = item.external_deadline || item.internal_target || item.due_date || item.deadline;
  const dueInDays = daysUntil(due, now);
  if (dueInDays === null) return null;

  const effortMinutes = firstNumber(
    item.effort_remaining_minutes,
    item.time_minutes,
    item.estimated_effort_min,
  );
  if (effortMinutes === null) return null;

  // A deadline means "by the end of that day", so the capacity is whatever is
  // left of today plus every whole day after it. A date that has passed offers
  // no capacity — but not negative capacity, so clamp and let the outstanding
  // effort do the talking.
  const capacityHours = hoursLeftInDay(now, hoursPerDay)
                      + Math.max(0, dueInDays) * hoursPerDay;
  const effortHours = effortMinutes / 60;
  const hours = capacityHours - effortHours;

  // Bands are relative to the size of the job, not absolute. Five spare hours
  // is luxurious for a twenty-minute errand and nothing at all for a
  // three-day build; an absolute threshold calls both the same thing.
  const band = hours <= 0 ? 'critical'
    : hours < effortHours * 0.5 ? 'at_risk'
    : hours < effortHours * 1.5 ? 'tight'
    : 'ok';

  return { hours, capacityHours, effortHours, band, dueInDays };
}

/**
 * Working hours left today. Without this, anything due today has zero capacity
 * and is called undeliverable at nine in the morning.
 */
function hoursLeftInDay(now, hoursPerDay, startHour = 9) {
  const endHour = startHour + hoursPerDay;
  const h = now.getHours() + now.getMinutes() / 60;
  return Math.max(0, Math.min(hoursPerDay, endHour - Math.max(h, startHour)));
}

function slackWeight(slack, W) {
  if (!slack) return 0;
  return slack.band === 'critical' ? W.slackCritical
    : slack.band === 'at_risk' ? W.slackAtRisk
    : slack.band === 'tight' ? W.slackTight
    : 0;
}

function slackReason(slack) {
  if (!slack) return null;
  if (slack.band === 'critical') {
    return `Due ${humanDays(slack.dueInDays)}, and there is ${humanHours(slack.effortHours)} of work left — ` +
           `${humanHours(Math.abs(slack.hours))} more than the time remaining. It cannot be finished as scheduled.`;
  }
  if (slack.band === 'at_risk') {
    return `Due ${humanDays(slack.dueInDays)} with ${humanHours(slack.effortHours)} left. ` +
           `That leaves almost no room.`;
  }
  if (slack.band === 'tight') {
    return `Due ${humanDays(slack.dueInDays)} with ${humanHours(slack.effortHours)} left.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Burnout
// ---------------------------------------------------------------------------

/**
 * A number between 0 and 100, and a band. Deliberately built only from things
 * already recorded, so it costs nothing to compute and cannot be gamed by
 * self-report on a bad day.
 *
 * @param signals {
 *   depletedDays,        consecutive days at low/overwhelmed
 *   restorativeRatio,    restorative minutes / total completed, last 14 days
 *   deferralRate,        deferrals / open tasks
 *   lateNightCount,      activity after 23:00, last 7 days
 *   sleepHours,          mean, when health data exists
 * }
 */
export function burnoutRisk(signals = {}) {
  const factors = [];
  let score = 0;

  const depleted = num(signals.depletedDays, 0);
  if (depleted >= 2) {
    const pts = Math.min(30, depleted * 8);
    score += pts;
    factors.push({ factor: 'depleted_days', points: pts,
      note: `${depleted} days in a row at low or overwhelmed energy.` });
  }

  // Only meaningful once there is something to take a ratio of.
  if (signals.restorativeRatio !== null && signals.restorativeRatio !== undefined
      && num(signals.completedCount, 0) >= 5) {
    const ratio = num(signals.restorativeRatio, 0);
    if (ratio < 0.15) {
      const pts = Math.round((0.15 - ratio) * 160);
      score += pts;
      factors.push({ factor: 'little_recovery', points: pts,
        note: `Almost none of the last two weeks' finished work was restorative.` });
    }
  }

  const deferral = num(signals.deferralRate, 0);
  if (deferral > 0.3) {
    const pts = Math.min(20, Math.round((deferral - 0.3) * 60));
    score += pts;
    factors.push({ factor: 'deferrals', points: pts,
      note: `A growing share of open work is being carried forward.` });
  }

  const lateNights = num(signals.lateNightCount, 0);
  if (lateNights >= 3) {
    const pts = Math.min(20, lateNights * 4);
    score += pts;
    factors.push({ factor: 'late_nights', points: pts,
      note: `${lateNights} late sessions in the last week.` });
  }

  if (signals.sleepHours !== null && signals.sleepHours !== undefined) {
    const sleep = num(signals.sleepHours, 8);
    if (sleep < 6.5) {
      const pts = Math.min(25, Math.round((6.5 - sleep) * 18));
      score += pts;
      factors.push({ factor: 'sleep', points: pts,
        note: `Sleep is averaging ${sleep.toFixed(1)} hours.` });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const band = score >= 70 ? 'severe' : score >= 45 ? 'high' : score >= 22 ? 'elevated' : 'ok';
  return { score, band, factors };
}

/** Restorative work is worth more the more depleted you are. */
function burnoutGain(band) {
  return { ok: 1, elevated: 1.6, high: 2.4, severe: 3.2 }[band] ?? 1;
}

// ---------------------------------------------------------------------------
// The ranking
// ---------------------------------------------------------------------------

/**
 * @param ws { tasks, commitments, projects, dependencies, sessions }
 * @param opts { now, energyState, availableMinutes, capacity, weights, burnout, limit }
 */
export function rankWork(ws = {}, opts = {}) {
  const now = opts.now || new Date();
  const W = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const hoursPerDay = W.workHoursPerDay || 6;
  const energyState = opts.energyState || 'medium';
  const availableMinutes = num(opts.availableMinutes, 30);
  const capacity = opts.capacity || 'unsure';
  const limit = opts.limit || 6;
  const maxEnergy = MAX_TASK_ENERGY[energyState] ?? 3;

  const tasks = ws.tasks || [];
  const commitments = ws.commitments || [];
  const projects = ws.projects || [];
  const dependencies = ws.dependencies || [];

  const burnout = opts.burnout || { score: 0, band: 'ok', factors: [] };

  const projectById = indexBy(projects, 'id');
  const commitmentsByProject = groupBy(
    commitments.filter((c) => c.project_id && !isClosed(c.status, ['delivered', 'dropped'])),
    'project_id');
  const riskyDepsByProject = groupBy(
    dependencies.filter((d) => ['waiting', 'chasing'].includes(String(d.status))),
    'project_id');
  const resumeByTask = resumePointByTask(ws.sessions || []);

  // --- Is income under threat? ---------------------------------------------
  //
  // Computed before scoring, because the answer changes how everything else is
  // judged. Deliberately spans BOTH tables: an obligation is an obligation
  // whether it was recorded as a commitment or captured as a task marked
  // contracted. Reading only `commitments` meant a contracted task could be
  // undeliverable while the app cheerfully suggested a hobby.
  const obligations = [
    ...commitments
      .filter((c) => !isClosed(c.status, ['delivered', 'dropped']))
      .map((c) => ({ kind: 'commitment', row: c, slack: slackFor(c, now, hoursPerDay) })),
    ...tasks
      .filter((t) => !isClosed(t.status, ['done', 'dropped'])
                  && String(t.commitment_type) === 'contracted')
      .map((t) => ({ kind: 'task', row: t, slack: slackFor(t, now, hoursPerDay) })),
  ];

  const atRisk = obligations.filter(({ row, slack }) =>
    (slack && (slack.band === 'critical' || slack.band === 'at_risk')) ||
    (num(row.income_impact, 0) > 0 && (commitmentClock(row, now)?.days ?? 99) <= 1));

  const incomeAtRisk = atRisk.some(({ row }) =>
    String(row.commitment_type || 'contracted') === 'contracted' || num(row.income_impact, 0) > 0);

  // --- TIER 0: an obligation that cannot be delivered at all ---------------
  const undeliverable = atRisk
    .filter(({ row, slack }) =>
      String(row.commitment_type || 'contracted') === 'contracted'
      && slack && slack.band === 'critical')
    .sort((a, b) => a.slack.hours - b.slack.hours);

  if (undeliverable.length) {
    return {
      tier: 'commitment_at_risk',
      tierReason:
        'Something promised cannot be delivered in the time left. Nothing else is ' +
        'being offered until it is either done or the date is renegotiated.',
      suggestions: undeliverable.slice(0, limit).map(({ kind, row, slack }) =>
        kind === 'commitment'
          ? commitmentSuggestion(row, slack, projectById[row.project_id], now, W)
          : scoreTask(row, {
              project: projectById[row.project_id],
              projectCommitments: commitmentsByProject[row.project_id] || [],
              riskyDeps: riskyDepsByProject[row.project_id] || [],
              resumeSession: resumeByTask[row.id],
              now, W, hoursPerDay, capacity, maxEnergy, availableMinutes,
              burnout, incomeAtRisk: true,
            })),
      incomeAtRisk: true,
      burnout,
      risks: assessRisks(ws, now, hoursPerDay),
      waiting: waitingOnOthers(ws, now),
      energyState, availableMinutes,
    };
  }

  // --- Score everything else -----------------------------------------------
  const candidates = [];

  for (const t of tasks) {
    const status = String(t.status || 'open');
    if (['done', 'dropped'].includes(status)) continue;
    if (['waiting', 'blocked'].includes(status)) continue;

    const project = projectById[t.project_id];
    if (project && ['archived', 'completed'].includes(String(project.status))) continue;

    candidates.push(scoreTask(t, {
      project,
      projectCommitments: commitmentsByProject[t.project_id] || [],
      riskyDeps: riskyDepsByProject[t.project_id] || [],
      resumeSession: resumeByTask[t.id],
      now, W, hoursPerDay, capacity, maxEnergy, availableMinutes,
      burnout, incomeAtRisk,
    }));
  }

  // Commitments with nothing planned yet — deciding the first step IS the work.
  for (const c of commitments) {
    if (isClosed(c.status, ['delivered', 'dropped'])) continue;
    const hasTask = tasks.some((t) =>
      t.project_id && t.project_id === c.project_id && !['done', 'dropped'].includes(String(t.status)));
    if (hasTask) continue;
    candidates.push(commitmentSuggestion(
      c, slackFor(c, now, hoursPerDay), projectById[c.project_id], now, W));
  }

  candidates.sort((a, b) =>
    (b.score - a.score) || String(a.title).localeCompare(String(b.title)));

  // --- TIER 1: burnout guard ------------------------------------------------
  // Promote recovery above output. Not a nudge — a reordering, stated plainly.
  let tier = 'normal';
  let tierReason = null;
  if (bandAtLeast(burnout.band, 'high')) {
    const restorative = candidates.filter((c) => c.restorative >= 3 || c.fitsDepleted);
    if (restorative.length) {
      tier = 'burnout_guard';
      tierReason =
        'The signals say you are running low, and nothing is at risk of being missed. ' +
        'Recovery is the higher-value move right now, so it is being offered first.';
      const rest = candidates.filter((c) => !restorative.includes(c));
      candidates.length = 0;
      candidates.push(...restorative, ...rest);
    }
  }

  return {
    tier, tierReason,
    suggestions: candidates.slice(0, limit),
    incomeAtRisk,
    burnout,
    risks: assessRisks(ws, now, hoursPerDay),
    waiting: waitingOnOthers(ws, now),
    energyState, availableMinutes,
  };
}

// ---------------------------------------------------------------------------

export function scoreTask(t, ctx) {
  const { project, projectCommitments, riskyDeps, resumeSession, now, W,
          hoursPerDay, capacity, maxEnergy, availableMinutes, burnout, incomeAtRisk } = ctx;

  let score = 0;
  const reasons = [];
  const breakdown = {};
  const add = (key, points, reason) => {
    if (!points) return;
    score += points;
    breakdown[key] = (breakdown[key] || 0) + points;
    if (reason) reasons.push(reason);
  };

  // Someone outside waiting on this project is the sharpest signal there is.
  for (const c of projectCommitments) {
    const clock = commitmentClock(c, now);
    if (!clock || clock.days > RISK_HORIZON_DAYS) continue;
    add('commitment', commitmentWeight(clock, W), commitmentReason(c, clock, now));
  }

  // Can this still be finished in time? Distinct from when it is due.
  const slack = slackFor(t, now, hoursPerDay);
  add('slack', slackWeight(slack, W), slackReason(slack));

  // Plain date pressure, for anything with no effort estimate to compute slack from.
  if (!slack) {
    const ad = daysUntil(t.due_date, now);
    if (ad !== null) {
      if (ad < 0) add('deadline', W.deadlineOverdue, `Its own date passed ${humanDays(ad)}.`);
      else if (ad <= 3) add('deadline', W.deadlineDue3, `Due ${humanDays(ad)}.`);
      else if (ad <= 7) add('deadline', W.deadlineDue7, `Due ${humanDays(ad)}.`);
      else if (ad <= 14) add('deadline', W.deadlineDue14, `Due ${humanDays(ad)}.`);
    }
  }

  const income = num(t.income_impact, 0);
  if (income > 0) {
    add('income', W.income * income,
      income >= 4 ? 'Directly tied to income.' : 'Contributes to income.');
  }

  if (String(t.status) === 'in_progress' || String(t.status) === 'doing') {
    add('in_progress', W.inProgress, 'Already started — finishing is cheaper than restarting.');
  }

  if (resumeSession) {
    const point = String(resumeSession.resume_point || resumeSession.unresolved_thought || '').trim();
    add('resume', W.resumeAvailable, point
      ? `You left a way back in: ${preview(point, 90)}`
      : 'You paused this with notes to pick up from.');
  }

  // POS's strategic_importance is 1 = highest; ExecAgent's is a label. Accept both.
  add('importance', importanceScore(t.importance ?? rankToLabel(t.strategic_importance), W));
  add('urgency', urgencyScore(t.urgency, W));

  const cap = capacityScore(t.action_type, capacity, W);
  add('capacity', cap.score, cap.reason);

  const minutes = toMinutes(t.time_minutes ?? t.estimated_effort_min);
  if (minutes !== null && minutes <= QUICK_WIN_MINUTES) {
    add('quick_win', capacity === 'small' ? W.quickWinWhenSmall : W.quickWin,
      `About ${minutes} minutes.`);
  }

  if (riskyDeps.length) {
    const high = riskyDeps.filter((d) => String(d.risk_level) === 'high');
    if (high.length) {
      add('dependency', W.dependencyRisk,
        `Blocked downstream by: ${high[0].dependency || 'a dependency'}.`);
    }
  }

  const carried = num(t.deferred_count ?? t.postpone_count, 0);
  if (carried >= 3) add('carried', W.repeatedlyCarried, carriedForwardNote(carried));

  // --- Recovery and fulfilment ---------------------------------------------
  const restorative = num(t.restorative, 0);
  const fulfilment = num(t.satisfaction, 0);   // `satisfaction` reused as fulfilment
  const gain = burnoutGain(burnout.band);

  if (restorative > 0) {
    add('restorative', Math.round(W.restorative * restorative * gain),
      bandAtLeast(burnout.band, 'elevated')
        ? 'This is the kind of thing that puts energy back, which is in short supply.'
        : null);
  }
  if (fulfilment > 0) add('fulfilment', Math.round(W.fulfilment * fulfilment));

  // "Small fulfilling outside projects could be considered occupational
  // therapy" — worth MORE when depleted, but only while income is safe.
  const isTherapy = fulfilment >= 4 && minutes !== null && minutes <= 60
    && bandAtLeast(burnout.band, 'elevated') && !incomeAtRisk;
  if (isTherapy) {
    add('therapy', W.therapyBonus,
      'Small, and the kind of work you actually enjoy. Right now that counts as recovery, not as a distraction.');
  }

  // "Fulfilling work fits in only if it doesn't disrupt income generation."
  // Suppressed, never hidden — you can still choose it, with the cost visible.
  let suppressed = false;
  if (incomeAtRisk && income === 0 && !isTherapy) {
    const before = score;
    score = Math.round(score * W.nonIncomeSuppression);
    breakdown.income_suppression = score - before;
    suppressed = true;
    reasons.push('Held back while a commitment to someone else is at risk.');
  }

  const fitsWindow = (minutes ?? 30) <= availableMinutes;
  const fitsEnergy = num(t.energy_required, 3) <= maxEnergy;

  if (!reasons.length) {
    reasons.push(project
      ? `Open and unblocked on ${project.name}. Nothing is pushing it.`
      : 'Open and unblocked. Nothing is pushing it.');
  }

  return {
    type: 'task',
    id: t.id,
    title: t.title || t.description || '(untitled)',
    projectId: t.project_id || '',
    projectName: project ? project.name : '',
    domainKey: t.domain_key || '',
    effortMinutes: minutes,
    dueDate: t.due_date || '',
    slack,
    score,
    breakdown,
    reasons,
    restorative,
    fulfilment,
    incomeImpact: income,
    suppressed,
    fitsWindow,
    fitsEnergy,
    fits: fitsWindow && fitsEnergy,
    fitsDepleted: num(t.energy_required, 3) <= 2,
    whyNot: fitsWindow ? (fitsEnergy ? null : 'needs more energy than you have')
                       : 'longer than the window',
    tone: toneFor(t, projectCommitments, now, minutes, slack),
  };
}

function commitmentSuggestion(c, slack, project, now, W) {
  const reasons = [];
  let score = 0;
  const breakdown = {};

  const clock = commitmentClock(c, now);
  if (clock && clock.days <= RISK_HORIZON_DAYS) {
    const pts = commitmentWeight(clock, W);
    score += pts; breakdown.commitment = pts;
    reasons.push(commitmentReason(c, clock, now));
  }
  const sw = slackWeight(slack, W);
  if (sw) { score += sw; breakdown.slack = sw; }
  const sr = slackReason(slack);
  if (sr) reasons.push(sr);

  const income = num(c.income_impact, 0);
  if (income > 0) {
    const pts = W.income * income;
    score += pts; breakdown.income = pts;
  }

  reasons.push('No action defined yet — deciding the first step is the work.');

  const carried = num(c.postpone_count, 0);
  if (carried >= 3) {
    score += W.repeatedlyCarried; breakdown.carried = W.repeatedlyCarried;
    reasons.push(carriedForwardNote(carried));
  }

  return {
    type: 'commitment',
    id: c.id,
    title: c.description || c.promised_result || '(untitled commitment)',
    projectId: c.project_id || '',
    projectName: project ? project.name : '',
    waitingParty: c.waiting_party || '',
    dueDate: c.external_deadline || c.internal_target || '',
    effortMinutes: toMinutes(c.effort_remaining_minutes),
    slack, score, breakdown, reasons,
    restorative: 0, fulfilment: 0, incomeImpact: income,
    suppressed: false,
    fits: true, fitsWindow: true, fitsEnergy: true, fitsDepleted: false,
    whyNot: null,
    tone: slack?.band === 'critical' ? 'red'
      : (clock && clock.days <= 2) ? 'red' : 'orange',
  };
}

// ---------------------------------------------------------------------------
// Risks and waiting
// ---------------------------------------------------------------------------

export function assessRisks(ws, now = new Date(), hoursPerDay = 6) {
  const risks = [];

  for (const c of ws.commitments || []) {
    if (isClosed(c.status, ['delivered', 'dropped'])) continue;

    const slack = slackFor(c, now, hoursPerDay);
    if (slack && slack.band === 'critical') {
      risks.push({ level: 'red', type: 'commitment', id: c.id,
        title: c.description || c.promised_result, message: slackReason(slack) });
    }

    const clock = commitmentClock(c, now);
    if (clock && clock.days <= RISK_HORIZON_DAYS) {
      risks.push({
        level: clock.kind === 'external' && clock.days <= 3 ? 'red' : 'orange',
        type: 'commitment', id: c.id,
        title: c.description || c.promised_result,
        message: commitmentReason(c, clock, now),
      });
    }
    if (num(c.postpone_count, 0) >= 3) {
      risks.push({ level: 'orange', type: 'commitment', id: c.id,
        title: c.description || c.promised_result,
        message: carriedForwardNote(num(c.postpone_count, 0)) });
    }
  }

  for (const d of ws.dependencies || []) {
    if (!['waiting', 'chasing'].includes(String(d.status))) continue;
    const due = daysUntil(d.expected_date, now);
    if (due !== null && due < 0) {
      risks.push({ level: 'orange', type: 'dependency', id: d.id, title: d.dependency,
        message: `${d.owner || 'Someone'} was expected to deliver ${humanDays(due)}. Worth a nudge?` });
    }
  }

  for (const p of ws.projects || []) {
    if (String(p.status) !== 'active') continue;
    const idle = daysSince(p.last_activity_at, now);
    if (idle !== null && idle >= STALE_DAYS) {
      risks.push({ level: 'orange', type: 'project', id: p.id, title: p.name,
        message: `Marked active but nothing has moved in ${idle} days. Still active, or paused?` });
    }
  }

  const order = { red: 0, orange: 1 };
  return risks.sort((a, b) => order[a.level] - order[b.level]);
}

export function waitingOnOthers(ws, now = new Date()) {
  const out = [];
  for (const d of ws.dependencies || []) {
    if (!['waiting', 'chasing'].includes(String(d.status))) continue;
    const due = daysUntil(d.expected_date, now);
    out.push({
      type: 'dependency', id: d.id, title: d.dependency || '(unnamed dependency)',
      who: d.owner || '', expected: d.expected_date || '',
      overdue: due !== null && due < 0, days: due,
      tone: (due !== null && due < 0) || String(d.risk_level) === 'high' ? 'orange' : 'grey',
    });
  }
  for (const t of ws.tasks || []) {
    if (String(t.status) !== 'waiting') continue;
    out.push({ type: 'task', id: t.id, title: t.title || '(untitled)',
      who: '', expected: t.due_date || '', overdue: false, days: null, tone: 'grey' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Describe the pattern, then ask what is going on. Never assert a cause, never
 * imply fault. This wording is the rule, not an example of it.
 */
export function carriedForwardNote(count) {
  return `Carried forward ${count} times. Is it unclear, emotionally heavy, ` +
         `unnecessary, blocked, or simply less important than it looked?`;
}

function importanceScore(v, W) {
  if (String(v) === 'high') return W.importanceHigh;
  if (String(v) === 'medium') return W.importanceMedium;
  return 0;
}
function urgencyScore(v, W) {
  if (String(v) === 'high') return W.urgencyHigh;
  if (String(v) === 'medium') return W.urgencyMedium;
  return 0;
}
/** POS stores 1-5 with 1 = highest. Map onto ExecAgent's labels. */
function rankToLabel(rank) {
  const n = num(rank, null);
  if (n === null) return null;
  return n <= 1 ? 'high' : n <= 3 ? 'medium' : 'low';
}

function capacityScore(actionType, capacity, W) {
  if (!capacity || capacity === 'unsure' || !actionType) return { score: 0, reason: null };
  if (String(actionType) === capacity) {
    return { score: W.capacityMatch, reason: `Matches the kind of work you have capacity for.` };
  }
  return { score: W.capacityMismatch, reason: null };
}

function toneFor(t, projectCommitments, now, minutes, slack) {
  if (slack?.band === 'critical') return 'red';
  const live = projectCommitments.filter((c) => !isClosed(c.status, ['delivered', 'dropped']));
  // Red is reserved for a promise to someone else. Your own missed target is
  // orange — real, but a different kind of problem.
  if (live.some((c) => { const d = daysUntil(c.external_deadline, now); return d !== null && d <= 2; })) return 'red';
  if (live.some((c) => { const d = daysUntil(c.internal_target, now); return d !== null && d <= 3; })) return 'orange';
  const ad = daysUntil(t.due_date, now);
  if (ad !== null && ad <= 3) return 'orange';
  if (num(t.restorative, 0) >= 3) return 'green';
  if (String(t.action_type) === 'exploration') return 'purple';
  if (minutes !== null && minutes <= FINISHABLE_MINUTES) return 'green';
  if (String(t.action_type) === 'finishing') return 'green';
  return 'blue';
}

function resumePointByTask(sessions) {
  const out = {};
  for (const s of sessions) {
    if (!s.task_id) continue;
    if (s.stopped_at && (s.resume_point || s.unresolved_thought)) {
      const prev = out[s.task_id];
      if (!prev || String(s.stopped_at) > String(prev.stopped_at)) out[s.task_id] = s;
    }
  }
  return out;
}

const isClosed = (status, closed) => closed.includes(String(status));
const preview = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

function toMinutes(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}
function num(v, dflt) {
  if (v === '' || v === null || v === undefined) return dflt;
  const n = Number(v);
  return Number.isNaN(n) ? dflt : n;
}
function firstNumber(...vals) {
  for (const v of vals) { const n = toMinutes(v); if (n !== null) return n; }
  return null;
}
function indexBy(arr, key) {
  const out = {}; for (const x of arr) out[x[key]] = x; return out;
}
function groupBy(arr, key) {
  const out = {}; for (const x of arr) (out[x[key]] ||= []).push(x); return out;
}
