import { getStrategy } from './strategy.mjs';
import { listKnowledge } from './knowledge.mjs';
import { listOpenQuestions } from './open-questions.mjs';
import { listTasks } from './tasks.mjs';
import { getContext, ENERGY_STATES } from './context-state.mjs';

const PRINCIPLES = `You are the user's Personal Operating System — Chief of Staff, strategic advisor, decision-support engine, and accountability partner.

Purpose. Help the user make consistently better decisions across career, health, learning, relationships, finances, contribution, enjoyment, and personal growth — while protecting energy and preventing burnout. This is not a task manager. Sustainable success over maximum throughput.

Three questions organize every response:
  1. What matters most right now?
  2. What is realistic given current conditions?
  3. What should happen next?

Operating principles:
- Conversation is the primary interface. Tasks, goals, and plans are outputs of understanding.
- The user decides. You recommend, explain, present alternatives — you do not overwrite strategy without explicit approval.
- Prefer confidence-raising questions over collection questions. Only ask what materially improves the plan.
- Never forget unresolved strategic questions. Surface them at the right moments.
- Challenge assumptions respectfully. Be a trusted advisor, not a cheerleader.
- Terse over verbose. Structured when useful, plain prose when not. No performative summaries.`;

function fmtDomains(domains) {
  if (!domains?.length) return '(none)';
  return domains.map((d) => {
    const parts = [`- ${d.name} (priority ${d.priority}, confidence ${Math.round((d.confidence ?? 0) * 100)}%)`];
    if (d.current_state) parts.push(`  current: ${d.current_state}`);
    if (d.desired_state) parts.push(`  desired: ${d.desired_state}`);
    return parts.join('\n');
  }).join('\n');
}

function fmtKnowledge(items) {
  if (!items?.length) return '(nothing captured yet)';
  const byCat = {};
  for (const i of items) (byCat[i.category] ??= []).push(i);
  return Object.entries(byCat).map(([cat, arr]) =>
    `- ${cat}:\n${arr.slice(0, 10).map((i) => `    · [${Math.round(i.confidence * 100)}%] ${i.content}`).join('\n')}`
  ).join('\n');
}

function fmtOpenQuestions(qs) {
  if (!qs?.length) return '(none)';
  return qs.slice(0, 10).map((q) =>
    `- [${q.status}, importance ${q.strategic_importance}] ${q.question}` +
    (q.review_date ? ` (review ${q.review_date})` : '')
  ).join('\n');
}

export function buildSystemPrompt() {
  const s = getStrategy();
  const knowledge = listKnowledge();
  const openQs = listOpenQuestions();

  const sections = [PRINCIPLES];

  const strategyLines = [];
  if (s.mission) strategyLines.push(`Mission: ${s.mission}`);
  if (s.identity) strategyLines.push(`Identity: ${s.identity}`);
  if (s.long_term_vision) strategyLines.push(`Long-term vision: ${s.long_term_vision}`);
  if (s.values?.length) strategyLines.push(`Values: ${s.values.join(', ')}`);
  if (strategyLines.length) {
    sections.push(`# Strategy scaffold\n${strategyLines.join('\n')}`);
  } else {
    sections.push(`# Strategy scaffold\n(empty — user has not yet defined mission/identity/vision. Ask what matters most before making recommendations.)`);
  }

  sections.push(`# Life domains\n${fmtDomains(s.domains)}`);
  sections.push(`# Personal knowledge model\n${fmtKnowledge(knowledge)}`);
  sections.push(`# Open strategic questions\n${fmtOpenQuestions(openQs)}`);

  const ctx = getContext();
  sections.push(
    `# Current conditions (${new Date().toISOString().slice(0, 10)})\n` +
    `Energy: ${ctx.energy_label} — ${ENERGY_STATES[ctx.energy_state]?.description}\n` +
    `Time available: ${ctx.available_minutes} minutes\n` +
    (ctx.note ? `Note: ${ctx.note}\n` : '') +
    `\nThese are the user's actual conditions right now, not an aspiration. A recommendation that ` +
    `does not fit this energy or this window is the wrong recommendation, however important the work is. ` +
    `When energy is low or overwhelmed, protecting recovery IS the high-value move — say so plainly ` +
    `rather than negotiating the user into pushing through.`
  );

  sections.push(`# Open tasks\n${fmtTasks(listTasks())}`);

  return sections.join('\n\n');
}

function fmtTasks(tasks) {
  if (!tasks?.length) return '(no open tasks)';
  return tasks.slice(0, 15).map((t) => {
    const bits = [
      t.time_minutes ? `${t.time_minutes}m` : null,
      t.strategic_importance ? `importance ${t.strategic_importance}` : null,
      t.energy_required ? `needs energy ${t.energy_required}/5` : null,
      t.deferred_count >= 2 ? `DEFERRED ${t.deferred_count}x` : null,
    ].filter(Boolean).join(', ');
    return `- ${t.title}${bits ? ` (${bits})` : ''}`;
  }).join('\n');
}
