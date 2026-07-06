import { db, now } from './db.mjs';

/**
 * Stub responder. Later this becomes an Anthropic API call with the
 * user's memory + strategy scaffold injected as system context.
 * Keep the interface stable so the swap is a one-line change.
 */
export function respond(userText) {
  const lower = userText.toLowerCase().trim();

  if (/^(hi|hello|hey|good\s*(morning|afternoon|evening))/.test(lower)) {
    return {
      text:
        "Good to see you. Before we plan the day, what's currently on your mind? " +
        "You can share anything — an idea, a concern, an opportunity, a question you've been sitting with.",
      intent: 'greeting',
    };
  }
  if (/(overwhelm|burn|tired|exhaust|stressed)/.test(lower)) {
    return {
      text:
        "Noted — this matters more than the task list right now. Two questions:\n" +
        "  1. What's draining you most (workload, ambiguity, a specific relationship, sleep)?\n" +
        "  2. What would count as \"recovered\" by end of week?",
      intent: 'wellbeing_check',
    };
  }
  if (/\?\s*$/.test(userText)) {
    return {
      text:
        "That reads like an open strategic question. Want me to log it to Open Questions so " +
        "we revisit it Sunday? I won't decide anything on your behalf — I'll just make sure we don't lose it.",
      intent: 'capture_open_question',
    };
  }
  if (/(goal|plan|strategy|vision|mission)/.test(lower)) {
    return {
      text:
        "Before I touch your strategy scaffold, I need to understand the shift. Can you tell me:\n" +
        "  • What's changed in your thinking?\n" +
        "  • What are you optimizing for now that you weren't before?\n" +
        "  • What's the cost if we're wrong?",
      intent: 'strategy_change_probe',
    };
  }

  return {
    text:
      "Got it — I've captured that. To make it useful later, one clarifying question: " +
      "is this about who you are, what you want, what's currently happening, or a decision you're weighing?",
    intent: 'clarify_domain',
  };
}

export function saveMessage(role, content, meta = null) {
  const info = db.prepare(
    'INSERT INTO chat_messages (role, content, meta, created_at) VALUES (?, ?, ?, ?)'
  ).run(role, content, meta ? JSON.stringify(meta) : null, now());
  return db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
}

export function recentMessages(limit = 50) {
  return db.prepare(
    'SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?'
  ).all(limit).reverse();
}
