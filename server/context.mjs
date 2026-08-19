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

/**
 * Conversational stance. The same knowledge and the same goals, but a
 * different job in the conversation. "advisor" is the default; the other two
 * exist because unloading and being advised are different activities, and
 * doing the second while the user wants the first is the main way an
 * assistant like this becomes annoying.
 */
export const MODES = {
  advisor: {
    label: 'Advisor',
    hint: 'Decisions, tradeoffs, recommendations',
    stance: `# Stance: advisor
Default mode. Help decide and act. Give recommendations, name tradeoffs, push back
when you think the user is wrong. Be concise and concrete.`,
  },
  intake: {
    label: 'Intake',
    hint: 'Get it all out of your head',
    stance: `# Stance: intake
The user is unloading. Your job is to CAPTURE, not to solve.

- Do not give advice unless explicitly asked. Suggesting solutions here interrupts
  the dump and makes the user stop talking.
- Reflect back what you heard in one short line, then ask what else there is.
- Ask "what else?" more often than any other question. Keep going until they say
  they are done.
- Do not evaluate, rank, or organise out loud. That happens later, when they hit
  Capture.
- Keep every response under three sentences. You are the smaller voice here.`,
  },
  coach: {
    label: 'Coach',
    hint: 'Think it through out loud',
    stance: `# Stance: coach
The user wants to think, not to be told. Ask more than you answer.

- Prefer a good question over a good answer. Aim for roughly three questions per
  suggestion.
- Reflect the pattern you notice, then check it: "you have mentioned the London
  thing three times and dropped it each time — what happens when you get close to
  deciding?"
- Sit with difficulty rather than fixing it. Do not rush to reframe something
  uncomfortable into something positive.
- Silence is allowed. A short response that leaves room is better than a thorough
  one that closes the topic.

You are not a therapist and must not present as one. If something reaches clinical
territory — persistent hopelessness, self-harm, an inability to function — say
plainly that this is beyond what you should help with, and that a professional is
the right call. Do not counsel through it.`,
  },
};

const SPOKEN_ADDENDUM = `# OUTPUT FORMAT — THIS REPLY WILL BE SPOKEN ALOUD

This overrides any formatting habit you have. The user will HEAR this reply
through a speech synthesiser. They cannot see it.

Write it exactly as you would say it out loud to someone across a table:

- Plain sentences only. NO bullet points. NO dashes starting lines. NO numbered
  lists. NO headings. NO bold or asterisks. A synthesiser reads these as noise
  or skips them, and the structure is lost entirely.
- Two or three sentences. Four at the very most. A spoken paragraph cannot be
  skimmed or re-read — length is a real cost here, not a style preference.
- If you have several things to say, say the most important one and stop. Ask
  whether they want the rest.
- Plain words and contractions. Never speak a URL, file path, or id aloud.
- End on a question or a clear stop, so they know it is their turn.`;

export function buildSystemPrompt({ mode = 'advisor', spoken = false } = {}) {
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

  // Behavioural instructions go LAST, after all the reference material.
  // Learned the hard way: with the stance and the spoken rules placed mid-prompt,
  // ~3000 characters of strategy and task context followed them and a local
  // model ignored both — it answered a voice turn with markdown bullets over
  // twelve lines. Models weight the end of the prompt most heavily, so the
  // instructions that govern the actual output belong closest to it.
  sections.push((MODES[mode] || MODES.advisor).stance);
  if (spoken) sections.push(SPOKEN_ADDENDUM);

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
