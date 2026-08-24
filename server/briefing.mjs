import { db, now } from './db.mjs';
import { listOpenQuestions } from './open-questions.mjs';
import { listTasks, updateTask, getTask } from './tasks.mjs';
import { rankNow } from './workspace.mjs';
import { oneShot, oneShotJson } from './llm.mjs';
import { briefingPlanSchema } from './schemas.mjs';
import { resolveRef } from './router.mjs';

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
    accepted_plan: row.plan_json ? JSON.parse(row.plan_json) : [],
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

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

const BRIEFING_SYSTEM = `You are running a short morning briefing conversation — a dialogue that walks through six stages, not a form to fill in:

  1. urgencies_identified   — what actually has to happen today
  2. energy_evaluated       — what today's energy and time genuinely allow
  3. constraints_understood — meetings, commitments, anything fixed
  4. priorities_agreed      — what matters most among what's possible
  5. risks_considered       — what could derail the day
  6. plan_accepted          — set only once the user has actually agreed to a plan; never assume it

Ask short, specific questions — one or two per reply. Do not lecture, do not
summarize back at length, do not ask about a stage the data already answers
(e.g. do not ask "what's on your plate" if the task list below already says).
Once enough is genuinely settled, propose a concrete plan for the day and ask
if it looks right — do not keep the conversation going past the point where
you have enough to propose something.`;

/** Short refs for today's real tasks, the same discipline ROUTE_SCHEMA uses
 *  for project/commitment links (AGENTS.md invariant 20) — a model is handed
 *  a token it can copy exactly, never a raw row id it could get wrong. */
function taskRefs(tasks) {
  return tasks.map((t, i) => ({ ref: `T${i + 1}`, id: String(t.id), name: t.title }));
}

function groundingBlock(briefing) {
  const refs = taskRefs(briefing.active_tasks);
  const ranked = rankNow({ limit: 8 });
  const atRisk = ranked.risks.filter((r) => r.type === 'commitment');

  const lines = [
    `Today's tasks:`,
    refs.length
      ? refs.map((r) => `- ${r.ref} ${r.name}`).join('\n')
      : '(nothing open)',
  ];
  if (briefing.open_questions.length) {
    lines.push('', 'Open questions:',
      briefing.open_questions.map((q) => `- ${q.question}`).join('\n'));
  }
  if (atRisk.length) {
    lines.push('', 'At risk:', atRisk.map((r) => `- ${r.message}`).join('\n'));
  }
  lines.push('', 'Stages already settled:',
    STAGES.filter((s) => briefing.stages[s]).join(', ') || '(none yet)');

  return { text: lines.join('\n'), refs };
}

export function listBriefingMessages() {
  return db.prepare(
    'SELECT * FROM briefing_messages WHERE briefing_date = ? ORDER BY id'
  ).all(today());
}

function saveBriefingMessage(role, content) {
  db.prepare(
    'INSERT INTO briefing_messages (briefing_date, role, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(today(), role, content, now());
}

/**
 * One exchange: save the user's turn, reply, then separately propose stage
 * updates and a plan. The reply and the proposal are two different calls on
 * purpose — conversational text and a schema-constrained extraction do not
 * mix well in one response (the same reasoning ROUTE_SCHEMA's object-root
 * note documents), and the proposal must never be what the user reads as the
 * reply itself, since it is not yet agreed to anything.
 */
export async function briefingChat(text) {
  saveBriefingMessage('user', text);

  const briefing = getOrCreateTodayBriefing();
  const { text: grounding, refs } = groundingBlock(briefing);
  const history = listBriefingMessages()
    .map((m) => `${m.role === 'user' ? 'USER' : 'YOU'}: ${m.content}`)
    .join('\n\n');

  const reply = await oneShot({
    system: `${BRIEFING_SYSTEM}\n\n${grounding}`,
    user: history,
    maxTokens: 500,
    timeoutMs: 300_000,
  });
  saveBriefingMessage('assistant', reply.text);

  let proposal = { stages: briefing.stages, items: [] };
  try {
    const extracted = await oneShotJson({
      system: `${BRIEFING_SYSTEM}\n\n${grounding}\n\nThe conversation so far is below. Propose the current stage completions and, if enough is settled, a plan.`,
      user: `${history}\n\nYOU: ${reply.text}`,
      maxTokens: 800,
      timeoutMs: 300_000,
      schema: briefingPlanSchema(refs.map((r) => r.ref)),
    });
    const j = extracted.json || {};
    proposal = {
      stages: { ...briefing.stages, ...(j.stages || {}) },
      // Resolved here, at proposal time, so the client only ever sees a real
      // id or none — the same point ROUTE_SCHEMA resolves project_id at,
      // with writeOne re-checking at commit as a backstop (mirrored below in
      // acceptBriefingPlan).
      items: (j.items || []).map((it) => ({
        title: it.title, time_label: it.time_label || '', note: it.note || '',
        task_id: resolveRef(refs, it.task_ref)?.id || null,
      })),
    };
  } catch (err) {
    console.error('[briefing] plan extraction failed, no proposal this turn:', err.message);
  }

  return { reply: reply.text, proposal };
}

/**
 * The only thing here that writes. `items` is whatever came back from the
 * review screen — task_id is re-validated against a real task, exactly like
 * `existingId()` in router.mjs, because the review screen can edit these
 * fields and this is the last gate before anything is scheduled.
 */
export function acceptBriefingPlan({ items = [], stages = {} } = {}) {
  const date = today();
  const scheduled = [];

  for (const item of items) {
    if (!item.task_id || !item.time) continue;
    if (!getTask(item.task_id)) continue;
    updateTask(item.task_id, { scheduled_at: `${date}T${item.time}` });
    scheduled.push(item.task_id);
  }

  const row = getOrCreateTodayBriefing();
  const nextStages = { ...row.stages, ...stages, plan_accepted: true };
  db.prepare(
    `UPDATE briefings SET stages_json = ?, confidence = ?, plan_json = ?, accepted_at = ? WHERE date = ?`
  ).run(JSON.stringify(nextStages), computeConfidence(nextStages), JSON.stringify(items), now(), date);

  return { ...getOrCreateTodayBriefing(), scheduled_count: scheduled.length };
}
