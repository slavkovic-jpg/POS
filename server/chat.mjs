import { db, now } from './db.mjs';
import { buildSystemPrompt } from './context.mjs';
import { generateGemini } from './gemini.mjs';
import { generateOpenAICompat } from './openai-compat.mjs';

const MODEL = process.env.POS_MODEL || 'claude-opus-4-8';
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED !== 'false';
// Single source of truth for how long we wait on a local model. Prompt
// processing dominates on CPU and the system prompt grows as the user's
// strategy, tasks and knowledge fill in, so this needs headroom.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 300_000;
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX) || 8192;
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

/**
 * Strip markdown so a past reply reads as speech.
 *
 * Needed because of format contagion: a model imitates the shape of the
 * assistant turns already in the conversation far more strongly than it obeys
 * a formatting instruction in the system prompt. One markdown-formatted reply
 * in the history — typically from a typed turn, since the same thread carries
 * both — and every following spoken turn comes back in bullet points no matter
 * what the prompt says. Observed directly: identical bulleted output before and
 * after moving the spoken rules to the end of the prompt, because the example
 * in the history was doing the deciding.
 */
function speechify(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildMessageHistory(userText, { spoken = false } = {}) {
  const history = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE role IN ('user', 'assistant')
     ORDER BY id DESC LIMIT ?`
  ).all(HISTORY_TURNS).reverse();

  const messages = history.map((m) => ({
    role: m.role,
    // Only assistant turns matter here — those are the ones being imitated.
    content: spoken && m.role === 'assistant' ? speechify(m.content) : m.content,
  }));
  messages.push({ role: 'user', content: userText });
  return messages;
}

// ---- Hosted OpenAI-compatible responder (free tiers; fast) ---------------
async function respondHosted(userText, opts) {
  const result = await generateOpenAICompat({
    system: buildSystemPrompt(opts),
    messages: buildMessageHistory(userText, { spoken: opts?.spoken }),
    maxTokens: opts?.spoken ? 700 : 2048,
  });
  if (!result) return null;
  return { text: result.text, intent: 'hosted', model: result.model, usage: result.usage };
}

// ---- Ollama-backed responder (local fallback) ----------------------------
async function respondOllama(userText, opts) {
  if (!OLLAMA_ENABLED) return null;

  const messages = [
    { role: 'system', content: buildSystemPrompt(opts) },
    ...buildMessageHistory(userText, { spoken: opts?.spoken }),
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        options: {
          // Without this, Ollama uses a context far smaller than the model
          // supports and silently drops the OLDEST tokens on overflow — which
          // is the system prompt. That looks exactly like "the model ignored
          // its instructions", and it is why spoken replies kept arriving in
          // markdown however the prompt was worded.
          num_ctx: OLLAMA_NUM_CTX,
          num_predict: opts?.spoken ? 700 : 2048,
        },
      }),
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

// ---- Gemini-backed responder (fast; good for voice) ----------------------
async function respondGemini(userText, opts) {
  const result = await generateGemini({
    system: buildSystemPrompt(opts),
    messages: buildMessageHistory(userText, { spoken: opts?.spoken }),
    maxTokens: opts?.spoken ? 700 : 2048,
  });
  if (!result) return null;
  return { text: result.text, intent: 'gemini', model: result.model };
}

// ---- Claude-backed responder ----------------------------------------------
async function respondClaude(userText, opts) {
  const client = await getClient();
  if (!client) return null;

  const response = await client.messages.create({
    model: MODEL,
    // Spoken replies are capped shorter: a wall of text is fine to skim but
    // punishing to listen to.
    max_tokens: opts?.spoken ? 700 : 2048,
    thinking: { type: 'adaptive' },
    system: buildSystemPrompt(opts),
    messages: buildMessageHistory(userText, { spoken: opts?.spoken }),
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

export async function respond(userText, opts = {}) {
  const errors = [];

  // 1. Claude (preferred, if API key set)
  try {
    const claude = await respondClaude(userText, opts);
    if (claude) return claude;
  } catch (err) {
    console.error('[chat] Claude call failed, trying Gemini:', err.message);
    errors.push(`claude: ${err.message}`);
  }

  // 2. Gemini (fast; the practical choice for voice)
  try {
    const gemini = await respondGemini(userText, opts);
    if (gemini) {
      if (errors.length) gemini.fallback_from = errors.join('; ');
      return gemini;
    }
  } catch (err) {
    console.error('[chat] Gemini call failed, trying Ollama:', err.message);
    errors.push(`gemini: ${err.message}`);
  }

  // 3. A hosted OpenAI-compatible provider. Several are free and all are far
  //    faster than CPU inference on this hardware.
  try {
    const hosted = await respondHosted(userText, opts);
    if (hosted) {
      if (errors.length) hosted.fallback_from = errors.join('; ');
      return hosted;
    }
  } catch (err) {
    console.error('[chat] Hosted provider failed, trying Ollama:', err.message);
    errors.push(`hosted: ${err.message}`);
  }

  // 4. Local Ollama (private, but too slow to hold a spoken conversation)
  try {
    const ollama = await respondOllama(userText, opts);
    if (ollama) {
      if (errors.length) ollama.fallback_from = errors.join('; ');
      return ollama;
    }
  } catch (err) {
    console.error('[chat] Ollama call failed, falling back to stub:', err.message);
    errors.push(`ollama: ${err.message}`);
  }

  // 4. Last resort — scripted stub
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

/**
 * Start a fresh conversation. Captured records (open questions, decisions,
 * knowledge) are unaffected — those live in their own tables, so clearing the
 * transcript loses nothing you chose to keep.
 */
export function clearMessages() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get();
  db.prepare('DELETE FROM chat_messages').run();
  return { cleared: n };
}

export function recentMessages(limit = 50) {
  return db.prepare(
    'SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?'
  ).all(limit).reverse();
}
