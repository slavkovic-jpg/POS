import { db, now } from './db.mjs';
import { oneShotJson } from './llm.mjs';
import { getStrategy } from './strategy.mjs';
import { listTasks, addTask } from './tasks.mjs';
import { getContext, ENERGY_STATES } from './context-state.mjs';

// ---------------------------------------------------------------------------
// 1. Unpack — a chaotic brain dump becomes structured, scored tasks.
// ---------------------------------------------------------------------------

function domainList() {
  return db.prepare('SELECT key, name FROM life_domains ORDER BY name').all();
}

// Importance is requested as a LABEL, not a number. Our column is 1-5 with
// 1 = highest, and models reliably invert that polarity — producing a
// perfectly plausible task list ranked exactly backwards, with no error to
// catch it. Labels cannot be inverted; the mapping happens here.
const IMPORTANCE_LABELS = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  someday: 5,
};

const UNPACK_SYSTEM = (domains) => `Turn a raw brain dump into structured tasks for a Personal OS.

Return ONLY a JSON array (no prose, no markdown, no code fences). Each item:
{
  "title": "imperative, specific, one line",
  "domain_key": one of ${domains.map((d) => `"${d.key}"`).join(', ')},
  "time_minutes": 5|15|30|45|60|90|120,
  "importance": "critical" | "high" | "medium" | "low" | "someday",
  "energy_required": 1-5 (1 = can do while depleted, 5 = needs peak focus),
  "anxiety_level": 1-5 (1 = no dread, 5 = strong avoidance),
  "rationale": "one sentence: why doing this reduces friction or moves something that matters"
}

Rules:
- Extract every distinct actionable item. One dump often contains several.
- Do not invent tasks the text does not imply. Fewer, accurate items beat padding.
- A vague worry ("stressed about the deck") becomes a concrete first action ("Outline the Q3 deck's three key claims").
- "critical" means it genuinely matters most, not that it merely feels urgent. Reserve it — most items are "medium".
- Pick the domain that actually matches. A call to a family member is a relationships task, not a personal-development one.
- Start with [ and end with ].`;

/**
 * Fallback when no model can parse the dump: keep the text as one unscored
 * task rather than throwing.
 *
 * The user typed something they wanted to stop carrying around. Losing it
 * because a backend was down is the single worst thing this feature could do
 * — far worse than an unscored task they have to tidy up later. The scores
 * are the nice-to-have; the capture is the point.
 */
function rawFallbackCandidate(text) {
  const clean = text.trim().replace(/\s+/g, ' ');

  // Prefer the first sentence, but only when it carries enough to be a title.
  // A dump often opens with a throwaway line ("Head is a mess.") and the real
  // content follows — using that as the title would be accurate and useless.
  const first = clean.split(/(?<=[.!?])\s/)[0]?.trim() || '';
  const usableFirst = first.length >= 25 && first.length <= 90;
  const title = usableFirst ? first
    : clean.length <= 90 ? clean
    : clean.slice(0, 87).trimEnd() + '…';

  return {
    title,
    domain_key: null,
    time_minutes: 30,
    strategic_importance: 3,
    energy_required: 3,
    anxiety_level: 2,
    rationale: '',
    // Keep the original whenever the title is not the whole of it.
    notes: clean === title ? '' : clean,
  };
}

export async function unpackThoughts(text) {
  if (!text?.trim()) throw new Error('text required');
  const domains = domainList();
  const validKeys = new Set(domains.map((d) => d.key));

  let result;
  try {
    result = await oneShotJson({
      system: UNPACK_SYSTEM(domains),
      user: text,
      maxTokens: 1500,
      timeoutMs: 300_000,
    });
  } catch (err) {
    console.error('[unpack] parsing failed, keeping raw text:', err.message);
    return {
      candidates: [rawFallbackCandidate(text)],
      degraded: true,
      degraded_reason: err.message,
      source: null,
      model: null,
    };
  }

  const arr = Array.isArray(result.json) ? result.json : [];
  const candidates = arr
    .filter((t) => t?.title?.toString().trim())
    .map((t) => ({
      title: t.title.toString().trim(),
      domain_key: validKeys.has(t.domain_key) ? t.domain_key : null,
      time_minutes: clampInt(t.time_minutes, 5, 480, 30),
      strategic_importance: importanceToRank(t.importance),
      energy_required: clampInt(t.energy_required, 1, 5, 3),
      anxiety_level: clampInt(t.anxiety_level, 1, 5, 2),
      rationale: (t.rationale || '').toString().trim(),
    }));

  // A model that answered but produced nothing usable is the same outcome as
  // one that errored, from the user's point of view. Keep the text either way.
  if (candidates.length === 0) {
    return {
      candidates: [rawFallbackCandidate(text)],
      degraded: true,
      degraded_reason: 'the model returned no usable tasks',
      source: result.source,
      model: result.model,
    };
  }

  return { candidates, degraded: false, source: result.source, model: result.model };
}

/** Persist accepted unpack candidates. */
export function acceptTasks(items) {
  return items
    .filter((item) => item?.title?.trim())
    .map((item) => addTask(item));
}

// ---------------------------------------------------------------------------
// 2. Breakdown — turn a task you keep avoiding into 5-minute steps.
// ---------------------------------------------------------------------------

const BREAKDOWN_SYSTEM = `Break one task into low-friction micro-steps for someone who has been avoiding it.

Return ONLY a JSON array (no prose, no markdown). Each item:
{"text": "a concrete physical or mental action", "est_minutes": 2-15}

Rules:
- 3 to 6 steps. Never more than 8.
- The FIRST step must be startable in under 60 seconds with zero decisions ("Open the file and read the last paragraph you wrote"), because starting is the hard part.
- Each step must be observable — someone watching could tell whether you did it. Not "think about X".
- No step over 15 minutes. If one would be, split it.
- Start with [ and end with ].`;

// Guard against a model that ignores the step-count instruction entirely.
// Not a contract — small local models routinely return 8-10 — just a ceiling
// so one bad generation can't produce a 40-item wall.
const MAX_STEPS = 12;

export async function breakdownTask(taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);

  const context = [
    `Task: ${task.title}`,
    task.rationale ? `Why it matters: ${task.rationale}` : null,
    task.notes ? `Notes: ${task.notes}` : null,
    task.domain_key ? `Life domain: ${task.domain_key}` : null,
    task.time_minutes ? `Estimated total: ${task.time_minutes} minutes` : null,
    task.anxiety_level >= 4 ? `This task carries high dread — make the first step especially small.` : null,
    task.deferred_count >= 2 ? `Deferred ${task.deferred_count} times already — avoidance is the real obstacle.` : null,
  ].filter(Boolean).join('\n');

  const result = await oneShotJson({
    system: BREAKDOWN_SYSTEM,
    user: context,
    maxTokens: 800,
    timeoutMs: 300_000,
  });

  const arr = Array.isArray(result.json) ? result.json : [];
  const steps = arr
    .filter((s) => s?.text?.toString().trim())
    .slice(0, MAX_STEPS)
    .map((s, i) => ({
      text: s.text.toString().trim(),
      est_minutes: clampInt(s.est_minutes, 1, 60, 5),
      sort_order: i,
    }));

  // Replace any existing breakdown for this task
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(taskId);
    const insert = db.prepare(
      `INSERT INTO subtasks (task_id, text, est_minutes, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const t = now();
    for (const s of steps) insert.run(taskId, s.text, s.est_minutes, s.sort_order, t);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    subtasks: listSubtasks(taskId),
    source: result.source,
    model: result.model,
  };
}

export function listSubtasks(taskId) {
  return db.prepare(
    'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order, id'
  ).all(taskId);
}

export function toggleSubtask(id) {
  const row = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id);
  if (!row) throw new Error(`subtask ${id} not found`);
  db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(row.done ? 0 : 1, id);
  return db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// 3. Decision engine — "what should I actually do right now?"
// ---------------------------------------------------------------------------

const DECIDE_SYSTEM = `You are the decision engine of a Personal OS. Pick the ONE task the user should do right now.

You receive their current energy, the minutes they actually have, and their open tasks. Each task is pre-marked with "fits": true means it fits BOTH the time window and the energy state. Tasks are pre-sorted: eligible tasks first, most important first within that.

Return ONLY this JSON object (no prose, no markdown):
{
  "task_id": <id of the chosen task>,
  "reasoning": "2 sentences: why this task, for this energy, in this time window",
  "mindset_primer": "one sentence to say to yourself before starting — concrete, not a platitude",
  "runner_up_id": <id or null>,
  "deferred_note": "one sentence if something important is being consciously set aside, else empty string"
}

Decide in this order:

STEP 1 — If energy is "overwhelmed": pick the smallest restorative or clearing action and stop. Recovery IS the correct move at this energy; say so plainly. Ignore the remaining steps.

STEP 2 — Otherwise, consider ONLY tasks with "fits": true. Among those, pick the one with the LOWEST strategic_importance number (1 is the most important). That is your default answer.

STEP 3 — Depart from step 2 only for a reason you can state in one sentence. Legitimate reasons: a hard deadline on a less important task; a task deferred 3+ times where breaking the avoidance now matters more (only when energy is medium or better).

Two ways to get this wrong, both of which you must avoid:
- Picking a task that does not fit. A 90-minute task in a 20-minute window fails, however important it is.
- WASTING A GOOD WINDOW. When energy is peak or medium and a large window is available, picking a short low-importance task (a walk, a quick email, tidying) is WRONG even though it technically "fits". Long high-energy windows are scarce; spend them on the most important work that fits. Restorative tasks are for low or overwhelmed energy, or for leftover minutes — not for the best window of the day.

If no task has "fits": true, pick the closest and say plainly in the reasoning that nothing fits well.`;

export async function recommendNext() {
  const ctx = getContext();
  const tasks = listTasks();

  if (tasks.length === 0) {
    return { empty: true, reason: 'No open tasks. Add some, or dump a thought and let the system unpack it.' };
  }

  const strategy = getStrategy();
  const maxEnergy = ENERGY_STATES[ctx.energy_state]?.max_task_energy ?? 3;

  // Compute eligibility here rather than asking the model to infer it, and
  // present the strongest candidate first. Small models weight list order
  // heavily, so the ordering is doing real work — not just cosmetics.
  const scored = tasks.map((t) => {
    const fitsWindow = (t.time_minutes ?? 30) <= ctx.available_minutes;
    const fitsEnergy = (t.energy_required ?? 3) <= maxEnergy;
    return {
      id: t.id,
      title: t.title,
      domain: t.domain_key,
      time_minutes: t.time_minutes,
      strategic_importance: t.strategic_importance,
      energy_required: t.energy_required,
      anxiety_level: t.anxiety_level,
      deferred_count: t.deferred_count,
      rationale: t.rationale || undefined,
      due_date: t.due_date || undefined,
      fits: fitsWindow && fitsEnergy,
      why_not: fitsWindow ? (fitsEnergy ? undefined : 'needs more energy than you have')
                          : 'longer than the window',
    };
  }).sort((a, b) =>
    (b.fits - a.fits) ||
    ((a.strategic_importance ?? 3) - (b.strategic_importance ?? 3))
  );

  const payload = {
    current_energy: ctx.energy_state,
    energy_meaning: ENERGY_STATES[ctx.energy_state]?.description,
    available_minutes: ctx.available_minutes,
    context_note: ctx.note || null,
    mission: strategy.mission || null,
    top_priority_domains: strategy.domains
      .filter((d) => d.priority <= 2)
      .map((d) => d.name),
    eligible_count: scored.filter((t) => t.fits).length,
    tasks: scored,
  };

  let result;
  try {
    result = await oneShotJson({
      system: DECIDE_SYSTEM,
      user: JSON.stringify(payload, null, 2),
      maxTokens: 800,
      timeoutMs: 300_000,
    });
  } catch (err) {
    // The engine's hard rules — fit the window, fit the energy, then prefer
    // importance — are arithmetic, not judgement. When no model is reachable
    // we can still answer the question correctly; what's lost is the
    // reasoning and the primer, not the pick. Degrading to a worse answer
    // beats refusing to answer the app's central question.
    console.error('[recommend] model unavailable, using local scoring:', err.message);
    return localRecommendation(tasks, ctx, scored, err.message);
  }

  const j = result.json || {};
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const fitsById = new Map(scored.map((t) => [t.id, t.fits]));

  let chosen = byId.get(Number(j.task_id));
  let override = null;

  if (!chosen) {
    // Hallucinated id.
    chosen = heuristicPick(tasks, ctx);
    override = 'model returned an unknown task id';
  } else if (!fitsById.get(chosen.id) && payload.eligible_count > 0) {
    // Hard constraints are not the model's call. If it picked something that
    // does not fit while something does, that is a rule violation, not a
    // judgment we defer to.
    chosen = heuristicPick(tasks, ctx);
    override = 'model picked a task that does not fit the current window or energy';
  }

  return {
    task: chosen,
    reasoning: override
      ? `Chosen locally by fit and importance (${override}).`
      : (j.reasoning || '').toString().trim() || 'Selected as the closest fit for your current window.',
    mindset_primer: override ? '' : (j.mindset_primer || '').toString().trim(),
    runner_up: byId.get(Number(j.runner_up_id)) || null,
    deferred_note: override ? '' : (j.deferred_note || '').toString().trim(),
    context: ctx,
    source: result.source,
    model: result.model,
    fallback_used: !!override,
    fallback_reason: override,
  };
}

/**
 * A complete recommendation computed without any model. Same rules the prompt
 * states, applied directly.
 */
function localRecommendation(tasks, ctx, scored, reason) {
  const eligible = scored.filter((t) => t.fits);
  const chosen = heuristicPick(tasks, ctx);
  const runnerUp = eligible.length > 1
    ? tasks.find((t) => t.id === eligible.find((e) => e.id !== chosen?.id)?.id)
    : null;

  const overwhelmed = ctx.energy_state === 'overwhelmed';
  const why = !eligible.length
    ? `Nothing fits ${ctx.available_minutes} minutes at ${ctx.energy_state} energy, so this is the closest match rather than a good one.`
    : overwhelmed
      ? 'Smallest thing that fits, because at overwhelmed energy recovery is the higher-value move.'
      : `Highest-importance task that fits ${ctx.available_minutes} minutes at ${ctx.energy_state} energy.`;

  return {
    task: chosen,
    reasoning: why,
    mindset_primer: '',
    runner_up: runnerUp || null,
    deferred_note: '',
    context: ctx,
    source: 'local',
    model: null,
    degraded: true,
    degraded_reason: reason,
    fallback_used: true,
    fallback_reason: 'no model reachable; scored locally',
  };
}

/** Deterministic backup if the model returns an unusable id. */
function heuristicPick(tasks, ctx) {
  const maxEnergy = ENERGY_STATES[ctx.energy_state]?.max_task_energy ?? 3;
  const fits = tasks.filter(
    (t) => (t.time_minutes ?? 30) <= ctx.available_minutes
        && (t.energy_required ?? 3) <= maxEnergy
  );
  const pool = fits.length ? fits : tasks;
  return [...pool].sort(
    (a, b) => (a.strategic_importance ?? 3) - (b.strategic_importance ?? 3)
  )[0];
}

/**
 * Map the importance label to our 1-5 column (1 = highest).
 * Falls back to "medium" for anything unrecognised — never guesses a rank
 * from a bare number, since that is the inversion this exists to prevent.
 */
function importanceToRank(label) {
  const key = (label ?? '').toString().trim().toLowerCase();
  return IMPORTANCE_LABELS[key] ?? 3;
}

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
