import { db, now } from './db.mjs';
import { buildSystemPrompt } from './context.mjs';

const MODEL = process.env.POS_MODEL || 'claude-opus-4-8';
const HISTORY_TURNS = 20;

let anthropicClient = null;
async function getClient() {
  if (anthropicClient) return anthropicClient;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  anthropicClient = new Anthropic();
  return anthropicClient;
}

// ---- Stub responder (fallback when no API key is set) ---------------------
function respondStub(userText) {
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

// ---- Claude-backed responder ----------------------------------------------
async function respondClaude(userText) {
  const client = await getClient();
  if (!client) return null;

  const history = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE role IN ('user', 'assistant')
     ORDER BY id DESC LIMIT ?`
  ).all(HISTORY_TURNS).reverse();

  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userText });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: buildSystemPrompt(),
    messages,
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return {
    text: text || '(no response)',
    intent: 'claude',
    model: response.model,
    usage: response.usage,
    stop_reason: response.stop_reason,
  };
}

export async function respond(userText) {
  try {
    const claude = await respondClaude(userText);
    if (claude) return claude;
  } catch (err) {
    console.error('[chat] Claude call failed, falling back to stub:', err.message);
    return { ...respondStub(userText), intent: 'stub_after_error', error: err.message };
  }
  return respondStub(userText);
}

// ---- Persistence -----------------------------------------------------------
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
