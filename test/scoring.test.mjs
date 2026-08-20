import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankWork, slackFor, burnoutRisk, commitmentClock, carriedForwardNote,
  DEFAULT_WEIGHTS,
} from '../server/scoring.mjs';

const NOW = new Date(2026, 7, 20, 9, 0, 0);           // 2026-08-20, 09:00
const day = (n) => {
  const d = new Date(NOW); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const task = (o) => ({
  id: o.id, title: o.title, status: 'open',
  time_minutes: 30, energy_required: 3, satisfaction: 0, restorative: 0,
  income_impact: 0, deferred_count: 0, ...o,
});

const rank = (ws, opts = {}) => rankWork(ws, { now: NOW, ...opts });

// ---------------------------------------------------------------------------
// Slack — the mechanic that makes a deadline mean something
// ---------------------------------------------------------------------------

test('slack: a 3-day job due tomorrow cannot be delivered', () => {
  const s = slackFor(
    { due_date: day(1), effort_remaining_minutes: 3 * 6 * 60 },  // 3 working days
    NOW, 6);
  assert.equal(s.band, 'critical');
  assert.ok(s.hours < 0, 'slack must be negative');
  // NOW is 09:00, so a full working day is left today, plus tomorrow.
  assert.equal(s.capacityHours, 12);
  assert.equal(s.effortHours, 18);
});

test('slack: capacity counts the hours left today, not just whole days', () => {
  const morning = slackFor({ due_date: day(0), effort_remaining_minutes: 60 },
    new Date(2026, 7, 20, 9, 0), 6);
  const evening = slackFor({ due_date: day(0), effort_remaining_minutes: 60 },
    new Date(2026, 7, 20, 20, 0), 6);
  assert.equal(morning.capacityHours, 6, 'a full day still ahead');
  assert.equal(evening.capacityHours, 0, 'the working day is over');
  assert.equal(morning.band, 'ok');
  assert.equal(evening.band, 'critical', 'due today, no hours left to do it in');
});

test('slack: a 20-minute errand due tomorrow is fine', () => {
  const s = slackFor({ due_date: day(1), effort_remaining_minutes: 20 }, NOW, 6);
  assert.equal(s.band, 'ok');
});

test('slack: same due date, different effort, different urgency', () => {
  // The whole point. Days-until-due cannot tell these apart.
  const big = slackFor({ due_date: day(2), effort_remaining_minutes: 20 * 60 }, NOW, 6);
  const small = slackFor({ due_date: day(2), effort_remaining_minutes: 30 }, NOW, 6);
  assert.equal(big.dueInDays, small.dueInDays);
  assert.equal(big.band, 'critical');
  assert.equal(small.band, 'ok');
});

test('slack: no due date or no effort estimate returns null, not a guess', () => {
  assert.equal(slackFor({ effort_remaining_minutes: 600 }, NOW, 6), null);
  assert.equal(slackFor({ due_date: day(3) }, NOW, 6), null);
});

test('slack: falls back to time_minutes when effort_remaining is unset', () => {
  const s = slackFor({ due_date: day(1), time_minutes: 1200 }, NOW, 6);
  assert.equal(s.effortHours, 20);
});

// ---------------------------------------------------------------------------
// Tier 0 — an undeliverable commitment outranks everything
// ---------------------------------------------------------------------------

const undeliverableWorkspace = {
  tasks: [
    task({ id: 1, title: 'Ten minute walk', time_minutes: 10, energy_required: 1,
           restorative: 5, satisfaction: 5 }),
    task({ id: 2, title: 'Reply to easy email', time_minutes: 15, energy_required: 2 }),
  ],
  commitments: [{
    id: 'cmt_1', description: 'Deliver the Domovik build',
    waiting_party: 'the client', status: 'open',
    commitment_type: 'contracted', income_impact: 5,
    external_deadline: day(1), effort_remaining_minutes: 3 * 6 * 60,
  }],
};

test('tier 0: a contracted job that cannot be delivered takes over the ranking', () => {
  for (const energyState of ['peak', 'medium', 'low', 'overwhelmed']) {
    const r = rank(undeliverableWorkspace, { energyState, availableMinutes: 15 });
    assert.equal(r.tier, 'commitment_at_risk', `energy=${energyState}`);
    assert.equal(r.suggestions[0].id, 'cmt_1');
    assert.equal(r.suggestions.length, 1, 'nothing else is offered');
    assert.ok(r.incomeAtRisk);
  }
});

test('tier 0: says plainly that it cannot be finished as scheduled', () => {
  const r = rank(undeliverableWorkspace);
  const text = r.suggestions[0].reasons.join(' ');
  assert.match(text, /cannot be finished as scheduled/);
  assert.match(r.tierReason, /renegotiated/);
});

test('tier 0: fires for a contracted TASK too, not only a commitment row', () => {
  // The obligation is the same thing whichever table it landed in. Reading
  // only `commitments` let an undeliverable contracted task sit quietly while
  // the app suggested a hobby.
  const r = rank({
    tasks: [
      task({ id: 1, title: 'Woodworking', satisfaction: 5, restorative: 4, time_minutes: 30 }),
      task({ id: 2, title: 'Draft the handover doc', commitment_type: 'contracted',
             income_impact: 5, due_date: day(1), effort_remaining_minutes: 18 * 60 }),
    ],
  }, { availableMinutes: 120 });

  assert.equal(r.tier, 'commitment_at_risk');
  assert.equal(r.suggestions[0].id, 2);
  assert.equal(r.suggestions.length, 1);
  assert.ok(r.incomeAtRisk);
});

test('a contracted task at risk suppresses fulfilling work', () => {
  const r = rank({
    tasks: [
      task({ id: 1, title: 'Woodworking', satisfaction: 5, time_minutes: 30 }),
      // at_risk, not critical — so tier 0 does not take over
      task({ id: 2, title: 'Client work', commitment_type: 'contracted',
             income_impact: 5, due_date: day(1), effort_remaining_minutes: 11 * 60 }),
    ],
  }, { availableMinutes: 120 });

  assert.equal(r.tier, 'normal');
  assert.ok(r.incomeAtRisk, 'a contracted task counts as income at risk');
  assert.ok(r.suggestions.find((s) => s.id === 1).suppressed);
});

test('tier 0: does not fire for a personal commitment, only a contracted one', () => {
  const ws = {
    ...undeliverableWorkspace,
    commitments: [{ ...undeliverableWorkspace.commitments[0],
      commitment_type: 'personal', income_impact: 0 }],
  };
  assert.notEqual(rank(ws).tier, 'commitment_at_risk');
});

// ---------------------------------------------------------------------------
// The income rule
// ---------------------------------------------------------------------------

test('fulfilling work is suppressed while a contracted job is at risk', () => {
  const ws = {
    tasks: [
      task({ id: 1, title: 'Learn the modular synth', satisfaction: 5,
             time_minutes: 120, income_impact: 0 }),
      task({ id: 2, title: 'Invoice the client', income_impact: 5, time_minutes: 20 }),
    ],
    commitments: [{
      id: 'cmt_1', description: 'Ship the report', status: 'open',
      commitment_type: 'contracted', income_impact: 4,
      external_deadline: day(1), effort_remaining_minutes: 5 * 60,   // at_risk, not critical
    }],
  };
  const r = rank(ws, { availableMinutes: 240 });
  assert.equal(r.tier, 'normal', 'at_risk should not trigger tier 0');
  assert.ok(r.incomeAtRisk);

  const synth = r.suggestions.find((s) => s.id === 1);
  assert.ok(synth.suppressed, 'non-income work is held back');
  assert.match(synth.reasons.join(' '), /Held back while a commitment/);

  const invoice = r.suggestions.find((s) => s.id === 2);
  assert.ok(!invoice.suppressed);
  assert.ok(invoice.score > synth.score, 'income work outranks the hobby');
});

test('suppressed work is still visible, not hidden', () => {
  const ws = {
    tasks: [task({ id: 1, title: 'Hobby', satisfaction: 5, income_impact: 0 })],
    commitments: [{ id: 'cmt_1', description: 'Ship', status: 'open',
      commitment_type: 'contracted', income_impact: 4,
      external_deadline: day(1), effort_remaining_minutes: 5 * 60 }],
  };
  const r = rank(ws);
  assert.ok(r.suggestions.some((s) => s.id === 1), 'you can still choose it');
});

// ---------------------------------------------------------------------------
// The occupational-therapy rule
// ---------------------------------------------------------------------------

const therapyTask = task({
  id: 1, title: 'Half an hour on the woodworking bench',
  satisfaction: 5, restorative: 4, time_minutes: 45, energy_required: 2,
});

test('therapy bonus fires when depleted and income is safe', () => {
  const r = rank({ tasks: [therapyTask] }, {
    burnout: burnoutRisk({ depletedDays: 3, lateNightCount: 4 }),
    availableMinutes: 60,
  });
  const s = r.suggestions[0];
  assert.ok(s.breakdown.therapy > 0, 'therapy bonus applied');
  assert.match(s.reasons.join(' '), /counts as recovery, not as a distraction/);
});

test('therapy bonus does NOT fire when income is at risk', () => {
  const r = rank({
    tasks: [therapyTask],
    commitments: [{ id: 'cmt_1', description: 'Ship', status: 'open',
      commitment_type: 'contracted', income_impact: 5,
      external_deadline: day(1), effort_remaining_minutes: 5 * 60 }],
  }, { burnout: burnoutRisk({ depletedDays: 3, lateNightCount: 4 }), availableMinutes: 60 });

  assert.equal(r.suggestions.find((s) => s.id === 1).breakdown.therapy, undefined);
});

test('therapy bonus does NOT fire when rested', () => {
  const r = rank({ tasks: [therapyTask] },
    { burnout: burnoutRisk({}), availableMinutes: 60 });
  assert.equal(r.suggestions[0].breakdown.therapy, undefined);
});

test('therapy bonus does NOT fire for a long task', () => {
  const r = rank({ tasks: [{ ...therapyTask, time_minutes: 180 }] },
    { burnout: burnoutRisk({ depletedDays: 3, lateNightCount: 4 }), availableMinutes: 240 });
  assert.equal(r.suggestions[0].breakdown.therapy, undefined);
});

// ---------------------------------------------------------------------------
// Tier 1 — burnout guard
// ---------------------------------------------------------------------------

test('overwhelmed with nothing at risk: restorative work is offered first', () => {
  const r = rank({
    tasks: [
      task({ id: 1, title: 'Rewrite the pricing page', energy_required: 5,
             time_minutes: 120, income_impact: 4, strategic_importance: 1 }),
      task({ id: 2, title: 'Walk by the river', energy_required: 1,
             time_minutes: 30, restorative: 5, satisfaction: 4 }),
    ],
  }, {
    energyState: 'overwhelmed',
    burnout: burnoutRisk({ depletedDays: 5, lateNightCount: 6, sleepHours: 5 }),
    availableMinutes: 120,
  });

  assert.equal(r.tier, 'burnout_guard');
  assert.equal(r.suggestions[0].id, 2, 'recovery comes first');
  assert.match(r.tierReason, /Recovery is the higher-value move/);
});

test('burnout guard does not override a commitment at risk', () => {
  const r = rank({
    ...undeliverableWorkspace,
    tasks: [task({ id: 2, title: 'Nap', restorative: 5, energy_required: 1 })],
  }, { burnout: burnoutRisk({ depletedDays: 6, lateNightCount: 7, sleepHours: 4.5 }) });
  assert.equal(r.tier, 'commitment_at_risk', 'the promise still wins');
});

// ---------------------------------------------------------------------------
// Burnout scoring
// ---------------------------------------------------------------------------

test('burnout: quiet by default', () => {
  const b = burnoutRisk({});
  assert.equal(b.band, 'ok');
  assert.equal(b.score, 0);
});

test('burnout: escalates with accumulating signals', () => {
  const mild = burnoutRisk({ depletedDays: 2 });
  const bad = burnoutRisk({ depletedDays: 5, lateNightCount: 6, sleepHours: 5,
                            deferralRate: 0.6 });
  assert.ok(bad.score > mild.score);
  assert.ok(['high', 'severe'].includes(bad.band), `got ${bad.band}`);
  assert.ok(bad.factors.length >= 3, 'every contribution is itemised');
});

test('burnout: ratio ignored until there is enough completed work to judge', () => {
  const thin = burnoutRisk({ restorativeRatio: 0, completedCount: 2 });
  assert.ok(!thin.factors.some((f) => f.factor === 'little_recovery'));
  const enough = burnoutRisk({ restorativeRatio: 0, completedCount: 20 });
  assert.ok(enough.factors.some((f) => f.factor === 'little_recovery'));
});

// ---------------------------------------------------------------------------
// Commitment clock
// ---------------------------------------------------------------------------

test('commitment clock: whichever date bites first', () => {
  const c = { external_deadline: day(10), internal_target: day(3) };
  assert.deepEqual(commitmentClock(c, NOW), { days: 3, kind: 'internal' });
});

test('commitment clock: your own target weighs less than theirs', () => {
  const mine = rank({ tasks: [task({ id: 1, title: 'T', project_id: 'p1' })],
    projects: [{ id: 'p1', name: 'P', status: 'active' }],
    commitments: [{ id: 'c', project_id: 'p1', status: 'open', internal_target: day(1) }] });
  const theirs = rank({ tasks: [task({ id: 1, title: 'T', project_id: 'p1' })],
    projects: [{ id: 'p1', name: 'P', status: 'active' }],
    commitments: [{ id: 'c', project_id: 'p1', status: 'open', external_deadline: day(1) }] });
  assert.ok(theirs.suggestions[0].breakdown.commitment > mine.suggestions[0].breakdown.commitment);
});

// ---------------------------------------------------------------------------
// Invariants that must not erode
// ---------------------------------------------------------------------------

test('every suggestion carries at least one reason', () => {
  const r = rank({
    tasks: [
      task({ id: 1, title: 'Nothing pushing this' }),
      task({ id: 2, title: 'Due soon', due_date: day(2) }),
      task({ id: 3, title: 'Carried', deferred_count: 4 }),
    ],
  });
  assert.equal(r.suggestions.length, 3);
  for (const s of r.suggestions) {
    assert.ok(s.reasons.length >= 1, `${s.title} has no reason`);
    assert.ok(s.reasons.every((x) => typeof x === 'string' && x.trim()), 'no empty reasons');
  }
});

test('no reason ever comments on the person', () => {
  // The rule most likely to erode as prompts and copy get edited. Asserted
  // against the actual failure vocabulary, not a vague sentiment check.
  const forbidden = [
    /\byou failed\b/i, /\byou wasted\b/i, /\byou should have\b/i,
    /\byou didn'?t\b/i, /\byou never\b/i, /\byou always\b/i,
    /\byou'?re being\b/i, /\blazy\b/i, /\bprocrastinating\b/i,
    /\bdiscipline\b/i, /\bexcuse\b/i,
  ];
  const r = rank({
    tasks: [
      task({ id: 1, title: 'Avoided thing', deferred_count: 7, satisfaction: 5,
             restorative: 4, time_minutes: 30, due_date: day(-3),
             effort_remaining_minutes: 600 }),
      task({ id: 2, title: 'Ordinary thing' }),
    ],
    commitments: [{ id: 'c', description: 'Late promise', status: 'open',
      waiting_party: 'a client', external_deadline: day(-5), postpone_count: 5 }],
  }, { burnout: burnoutRisk({ depletedDays: 6, lateNightCount: 8 }) });

  const all = [
    ...r.suggestions.flatMap((s) => s.reasons),
    ...r.risks.map((x) => x.message),
    r.tierReason,
    carriedForwardNote(7),
  ].filter(Boolean);

  assert.ok(all.length > 3, 'sanity: there is text to check');
  for (const line of all) {
    for (const bad of forbidden) {
      assert.ok(!bad.test(line), `judgemental phrasing in: "${line}"`);
    }
  }
});

test('score breakdown sums to the reported total', () => {
  const r = rank({
    tasks: [
      task({ id: 1, title: 'Mixed', income_impact: 3, satisfaction: 4,
             restorative: 3, due_date: day(2), deferred_count: 4,
             time_minutes: 15, status: 'in_progress' }),
    ],
  }, { burnout: burnoutRisk({ depletedDays: 3 }), availableMinutes: 60 });

  const s = r.suggestions[0];
  const sum = Object.values(s.breakdown).reduce((a, b) => a + b, 0);
  assert.equal(sum, s.score, `breakdown ${JSON.stringify(s.breakdown)} != ${s.score}`);
});

test('breakdown still sums when suppression applies', () => {
  const r = rank({
    tasks: [task({ id: 1, title: 'Hobby', satisfaction: 4, due_date: day(2) })],
    commitments: [{ id: 'c', description: 'Ship', status: 'open',
      commitment_type: 'contracted', income_impact: 5,
      external_deadline: day(1), effort_remaining_minutes: 5 * 60 }],
  });
  const s = r.suggestions.find((x) => x.id === 1);
  assert.ok(s.suppressed);
  const sum = Object.values(s.breakdown).reduce((a, b) => a + b, 0);
  assert.equal(sum, s.score);
});

test('fit is reported, not used to hide things', () => {
  const r = rank({
    tasks: [
      task({ id: 1, title: 'Too long', time_minutes: 240, energy_required: 2 }),
      task({ id: 2, title: 'Too demanding', time_minutes: 10, energy_required: 5 }),
      task({ id: 3, title: 'Just right', time_minutes: 10, energy_required: 1 }),
    ],
  }, { energyState: 'low', availableMinutes: 15 });

  assert.equal(r.suggestions.length, 3, 'nothing is dropped');
  const byId = Object.fromEntries(r.suggestions.map((s) => [s.id, s]));
  assert.equal(byId[1].whyNot, 'longer than the window');
  assert.equal(byId[2].whyNot, 'needs more energy than you have');
  assert.equal(byId[3].fits, true);
  assert.equal(byId[3].whyNot, null);
});

test('ranking is deterministic', () => {
  const ws = { tasks: [
    task({ id: 1, title: 'A', income_impact: 2 }),
    task({ id: 2, title: 'B', income_impact: 2 }),
    task({ id: 3, title: 'C', satisfaction: 3 }),
  ]};
  const a = rank(ws).suggestions.map((s) => s.id);
  const b = rank(ws).suggestions.map((s) => s.id);
  assert.deepEqual(a, b);
});

test('empty workspace does not throw', () => {
  const r = rank({});
  assert.deepEqual(r.suggestions, []);
  assert.equal(r.tier, 'normal');
});

test('weights are overridable', () => {
  const ws = { tasks: [task({ id: 1, title: 'Money', income_impact: 5 })] };
  const base = rank(ws).suggestions[0].score;
  const doubled = rank(ws, { weights: { ...DEFAULT_WEIGHTS, income: DEFAULT_WEIGHTS.income * 2 } })
    .suggestions[0].score;
  assert.ok(doubled > base, 'tuning a weight changes the outcome');
});

test('closed work never appears', () => {
  const r = rank({ tasks: [
    task({ id: 1, title: 'Done', status: 'done' }),
    task({ id: 2, title: 'Dropped', status: 'dropped' }),
    task({ id: 3, title: 'Open' }),
  ]});
  assert.deepEqual(r.suggestions.map((s) => s.id), [3]);
});
