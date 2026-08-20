import { db, now } from './db.mjs';
import { oneShotJson } from './llm.mjs';
import { addTask } from './tasks.mjs';
import { rankNow } from './workspace.mjs';

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
//
// The ranking is computed by server/scoring.mjs: pure arithmetic, fully tested,
// works with every backend unreachable. A model is used only to PHRASE the
// result — it never chooses. That removes an entire class of failure (the model
// inverting a scale, hallucinating an id, or wasting a peak window) and means
// the app's central question keeps working offline and for free.
// ---------------------------------------------------------------------------

const EXPLAIN_SYSTEM = `You are the voice of a Personal OS that has already decided what the user should do next. The decision is made; do not revisit it.

You receive the chosen item, the factors that produced its score, and the user's current conditions. Write the handover.

Return ONLY this JSON object (no prose, no markdown):
{
  "reasoning": "at most 2 sentences: why this, for this energy, in this window",
  "mindset_primer": "one sentence to say to yourself before starting — concrete and specific to this task, never a platitude",
  "deferred_note": "one sentence if something notable is being consciously set aside, else empty string"
}

Rules:
- Never contradict or second-guess the choice. If it looks odd, explain the reasoning that produced it.
- The supplied reasons are already true. Compress them; do not invent new ones.
- Never comment on the person. Describe the work, the date, or who is waiting — never "you failed to", "you have been avoiding", or the polite versions.
- If the item cannot be delivered in time, say so plainly. Do not soften it into encouragement.
- Plain sentences. No lists, no headings.`;

export async function recommendNext({ capacity } = {}) {
  const ranked = rankNow({ limit: 5, capacity });

  if (!ranked.suggestions.length) {
    return {
      empty: true,
      reason: 'Nothing open. Dump a thought and let it be unpacked, or say it out loud.',
      burnout: ranked.burnout,
      context: ranked,
    };
  }

  const top = ranked.suggestions[0];
  const runnerUp = ranked.suggestions[1] || null;

  // Locally-computed answer. Everything below only decorates this.
  const result = {
    task: top,
    runner_up: runnerUp,
    tier: ranked.tier,
    tier_reason: ranked.tierReason,
    reasoning: top.reasons.join(' '),
    mindset_primer: '',
    deferred_note: defaultDeferredNote(ranked),
    breakdown: top.breakdown,
    slack: top.slack,
    burnout: ranked.burnout,
    income_at_risk: ranked.incomeAtRisk,
    risks: ranked.risks,
    waiting: ranked.waiting,
    context: { energy_state: ranked.energyState, available_minutes: ranked.availableMinutes },
    suggestions: ranked.suggestions,
    source: 'local',
    explained: false,
  };

  // Phrasing is a nicety. If no model answers, the recommendation still stands.
  try {
    const payload = {
      chosen: {
        title: top.title, type: top.type,
        minutes: top.effortMinutes, due: top.dueDate,
        reasons: top.reasons,
        score_factors: top.breakdown,
        cannot_be_delivered: top.slack?.band === 'critical',
        suppressed_for_income: !!top.suppressed,
      },
      runner_up: runnerUp ? runnerUp.title : null,
      tier: ranked.tier,
      tier_reason: ranked.tierReason,
      energy: ranked.energyState,
      minutes_available: ranked.availableMinutes,
      burnout_band: ranked.burnout.band,
    };
    const r = await oneShotJson({
      system: EXPLAIN_SYSTEM,
      user: JSON.stringify(payload, null, 2),
      maxTokens: 400,
      timeoutMs: 120_000,
    });
    const j = r.json || {};
    if (j.reasoning) result.reasoning = String(j.reasoning).trim();
    if (j.mindset_primer) result.mindset_primer = String(j.mindset_primer).trim();
    if (j.deferred_note) result.deferred_note = String(j.deferred_note).trim();
    result.source = r.source;
    result.model = r.model;
    result.explained = true;
  } catch (err) {
    // Expected whenever no backend is configured. Not an error worth surfacing.
    console.error('[recommend] explanation unavailable, using local reasons:', err.message);
  }

  return result;
}

/** Say what is being set aside, when something clearly is. */
function defaultDeferredNote(ranked) {
  if (ranked.tier === 'commitment_at_risk') {
    return 'Everything else is on hold until this is delivered or renegotiated.';
  }
  const suppressed = ranked.suggestions.filter((s) => s.suppressed);
  if (suppressed.length) {
    return `${suppressed.length} thing${suppressed.length === 1 ? '' : 's'} you would enjoy ` +
           `${suppressed.length === 1 ? 'is' : 'are'} being held back while a commitment is at risk.`;
  }
  return '';
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
