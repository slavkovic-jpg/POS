import { dashboardSummary, navStatus } from './dashboard.mjs';
import { recommendNext } from './task-ai.mjs';
import { oneShot } from './llm.mjs';

/**
 * Wayfinding guide for the Dashboard widget — "where do I do X", "what's
 * best right now", "I'm lost, help".
 *
 * The one rule that matters: this never computes a ranking or invents a
 * number. `scoring.mjs`/`rankNow()` already decided what's most important;
 * this only phrases that decision and points at the right page, the same
 * division of labour as every other model-facing surface in this app
 * (AGENTS.md's architectural north star). Ask it "what should I do now" and
 * it restates `recommendNext()`'s actual pick — it does not reason its way
 * to a different answer.
 */

const FEATURE_MAP = `
- Dashboard (/dashboard): today's recommendation, a brain dump box, open questions, life balance.
- Copilot (/copilot): talk or type, Advisor/Intake/Coach — "File this" turns what was agreed into real records.
- Inbox (/inbox): anything captured that hasn't been triaged into a task/commitment/project/idea/dependency yet.
- Tasks (/tasks): the full task list, editable, plus a brain dump and the recommendation engine.
- Briefing (/briefing): a short morning conversation that ends in a laid-out, schedulable plan.
- Projects (/projects): containers for related work — a task under a project inherits its commitments when scored.
- Commitments (/commitments): promises to other people with real dates — the one thing that can override everything else in the ranking.
- Strategy (/strategy): mission, identity, vision, and per-domain priority — what "important" is judged against.
- Knowledge (/knowledge): durable facts about the user the system uses in every conversation.
- Open Questions (/questions): unresolved things worth tracking on purpose.
- Decisions (/decisions): decisions worth remembering, with why they were made.
- Reviews (/reviews): weekly/monthly retrospectives drafted from what actually happened.
- Settings (/settings): backend/provider configuration.
`.trim();

const GUIDE_SYSTEM = `You are the guide inside a Personal OS app. Two different jobs, don't confuse them:

1. WAYFINDING — "where do I do X", "what's best right now". Here, and only here, a hard rule applies: you do not decide anything and you never compute a ranking, a score, or a recommendation yourself. Every number and every "what to do next" answer must come only from the data given below. If asked what to do now, restate the current recommendation exactly as given — never reason your way to a different pick.

2. HELPING THE USER THINK AND WRITE — "help me write my identity statement", "I don't know what to put here", "give me an example", "what should this include". This is NOT the ranking rule above and is not restricted by it — that rule is about the task-priority engine, not about you refusing to help someone write a sentence about themselves. When asked this kind of question, actually help: offer a short framework for what the field usually covers, 1-2 concrete example statements (clearly marked as examples, not filled in on their behalf), and a question or two that would help them find their own words. Do not just point back at the page they already know about — they asked because knowing where the field is didn't help them fill it in.

What each page is for:
${FEATURE_MAP}

This conversation is stateful — read the history below before answering:
- Never repeat an answer you already gave earlier in this conversation. A follow-up means the previous answer didn't fully land — go deeper or from a different angle, don't restate it.
- If the user is stuck on ONE field (asking for help, an example, "I don't know what to write"), stay on that field and actually help per job 2 above. Only move to the next incomplete item when they say they're done with this one or ask to move on.
- When asked to be walked through several things one at a time (sections, empty pages, open items) with no specific field named yet, use the "What's actually incomplete" list below: name ONE specific concrete thing first, then help with it if asked, then move to the next once they're ready.
- A general question ("what is X for") gets a short answer, a sentence or two. A "guide me through" or "help me write" request gets real depth, not a feature summary.
- If the user seems lost or overwhelmed rather than asking something specific, name the single most useful thing in the data below.`;

function groundingBlock(dash, status, rec) {
  const recLine = rec?.task
    ? `"${rec.task.title}" — ${rec.reasoning}`
    : rec?.reason || '(nothing fits right now)';

  const strategy = dash.strategy || {};
  const missingDomains = (strategy.domains || [])
    .filter((d) => !d.current_state?.trim() || !d.desired_state?.trim())
    .map((d) => d.name);

  const lines = [
    `Current recommendation: ${recLine}`,
    `Tasks: ${status.tasks.due_today} due today (${status.tasks.done_today} done, ${status.tasks.overdue} overdue).`,
    `Inbox: ${status.inbox.open} not yet triaged.`,
    `Commitments: ${status.commitments.open} open` +
      (status.commitments.at_risk ? `, ${status.commitments.at_risk} at risk` : '') + '.',
    `Projects: ${status.projects.active} active` +
      (status.projects.stalled ? `, ${status.projects.stalled} stalled` : '') + '.',
    `Decisions awaiting review: ${status.decisions.to_review}.`,
    `Onboarding: ${dash.profile?.onboarded ? 'done' : 'NOT done yet'}.`,
  ];

  if (dash.questions?.open?.length) {
    lines.push(`Open questions (${dash.questions.open.length}): ` +
      dash.questions.open.map((q) => `"${q.question}"`).join('; ') + '.');
  } else {
    lines.push('Open questions: none logged.');
  }

  lines.push(
    `Knowledge: ${dash.knowledge_count ?? 0} entries` +
      (dash.knowledge_count > 0 ? '.' : ' — nothing captured yet.'),
    `Strategy scaffold: mission ${strategy.mission?.trim() ? 'set' : 'NOT set'}; ` +
      `${status.strategy.filled}/${status.strategy.total} fields filled in overall` +
      (missingDomains.length
        ? `; domains still missing current/desired state: ${missingDomains.join(', ')}.`
        : '; all domains have current and desired state filled in.')
  );

  if (dash.burnout?.band) lines.push(`Burnout signal: ${dash.burnout.band}.`);

  return lines.join('\n');
}

/**
 * The concrete, ordered list a "walk me through it" request actually needs —
 * one specific thing per empty or incomplete section, not a repeat of what
 * each page is *for*. Built from the same data as `groundingBlock()`, kept
 * separate because it's a to-do list, not a status readout.
 */
function incompleteSections(dash, status) {
  const out = [];
  if (!dash.profile?.onboarded) out.push('Onboarding: your profile and background have not been set up yet — /onboarding.');
  const strategy = dash.strategy || {};
  if (!strategy.mission?.trim()) out.push('Strategy: no mission set — /strategy.');
  if (!strategy.identity?.trim()) out.push('Strategy: no identity statement set — /strategy.');
  if (!strategy.long_term_vision?.trim()) out.push('Strategy: no long-term vision set — /strategy.');
  for (const d of strategy.domains || []) {
    if (!d.current_state?.trim() || !d.desired_state?.trim()) {
      out.push(`Strategy: the "${d.name}" domain has no current/desired state — /strategy#${d.key}.`);
    }
  }
  if (!dash.knowledge_count) out.push('Knowledge: nothing captured yet — talk it through on /copilot, or add it directly on /knowledge.');
  if (status.inbox.open > 0) out.push(`Inbox: ${status.inbox.open} item(s) still waiting to be triaged — /inbox.`);
  return out;
}

/**
 * @param history  Recent `{role, text}` turns from the widget's own state.
 *   Deliberately not persisted server-side — this is a quick wayfinding tool,
 *   not a second conversation thread to maintain alongside `chat_messages`
 *   and `briefing_messages`.
 */
export async function askGuide(question, history = []) {
  const dash = dashboardSummary();
  const status = navStatus();
  const rec = await recommendNext().catch(() => null);
  const grounding = groundingBlock(dash, status, rec);
  const todo = incompleteSections(dash, status);
  const todoBlock = todo.length
    ? `\n\nWhat's actually incomplete, in a sensible order to work through:\n${todo.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '\n\nNothing is obviously incomplete right now.';

  // More turns than the six other conversational surfaces keep, on purpose —
  // "walk me through these one by one" only works if the guide can see how
  // far it already got, not just the last exchange.
  const historyText = history.slice(-12)
    .map((h) => `${h.role === 'user' ? 'USER' : 'YOU'}: ${h.text}`)
    .join('\n\n');
  const user = (historyText ? `${historyText}\n\n` : '') + `USER: ${question}`;

  try {
    const result = await oneShot({
      system: `${GUIDE_SYSTEM}\n\nCurrent data:\n${grounding}${todoBlock}`,
      user,
      maxTokens: 650,
      timeoutMs: 60_000,
    });
    return { answer: result.text, model: result.model, source: result.source };
  } catch (err) {
    // No backend answered — every provider is down, unconfigured, or out of
    // quota. The same data that would have grounded the model is still real,
    // so hand it back directly rather than a raw 500: a plain answer beats no
    // answer, the same reasoning behind the rules-only fallback in
    // preClassify() and the stub responder in chat.mjs's respond().
    console.error('[guide] no backend answered, falling back to raw data:', err.message);
    return { answer: grounding, model: null, source: 'degraded' };
  }
}
