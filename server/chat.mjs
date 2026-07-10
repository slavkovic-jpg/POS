import { db, now } from './db.mjs';
import { buildSystemPrompt } from './context.mjs';

const MODEL = process.env.POS_MODEL || 'claude-opus-4-8';
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'hermes3:latest';
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED !== 'false';
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

function buildMessageHistory(userText) {
  const history = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE role IN ('user', 'assistant')
     ORDER BY id DESC LIMIT ?`
  ).all(HISTORY_TURNS).reverse();
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userText });
  return messages;
}

// ---- Ollama-backed responder (local fallback) ----------------------------
async function respondOllama(userText) {
  if (!OLLAMA_ENABLED) return null;

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...buildMessageHistory(userText),
  ];

  const controller = new AbortController();
  // First call after model load can be slow (cold start of an 8B model on CPU
  // takes ~30–90s); subsequent calls are much faster.
  const timeout = setTimeout(() => controller.abort(), 180_000);
  let response;
  try {
    response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Ollama timeout');
    // Connection refused / DNS / network — treat as "not available"
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 404 typically means the model isn't pulled yet — surface it clearly
    throw new Error(`Ollama ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = (data?.message?.content || '').trim();
  return {
    text: text || '(no response)',
    intent: 'ollama',
    model: data?.model || OLLAMA_MODEL,
    usage: data?.eval_count ? {
      prompt_tokens: data.prompt_eval_count,
      completion_tokens: data.eval_count,
    } : undefined,
  };
}

// ---- Claude-backed responder ----------------------------------------------
async function respondClaude(userText) {
  const client = await getClient();
  if (!client) return null;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: buildSystemPrompt(),
    messages: buildMessageHistory(userText),
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
  const errors = [];

  // 1. Try Claude (preferred, if API key set)
  try {
    const claude = await respondClaude(userText);
    if (claude) return claude;
  } catch (err) {
    console.error('[chat] Claude call failed, trying Ollama:', err.message);
    errors.push(`claude: ${err.message}`);
  }

  // 2. Fall back to local Ollama
  try {
    const ollama = await respondOllama(userText);
    if (ollama) {
      if (errors.length) ollama.fallback_from = errors.join('; ');
      return ollama;
    }
  } catch (err) {
    console.error('[chat] Ollama call failed, falling back to stub:', err.message);
    errors.push(`ollama: ${err.message}`);
  }

  // 3. Last resort — scripted stub
  const stub = respondStub(userText);
  if (errors.length) {
    return { ...stub, intent: 'stub_after_error', error: errors.join('; ') };
  }
  return stub;
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
