/**
 * Shared one-shot LLM helper. Used by any server code that needs a single
 * structured generation (CV analysis, review generation, etc.).
 *
 * Chat conversation lives in chat.mjs and has its own history handling.
 * Everything else calls oneShot() here.
 *
 * Fallback order matches chat: Claude -> Gemini -> Ollama -> throw.
 */

import { generateGemini, geminiEnabled } from './gemini.mjs';

const CLAUDE_MODEL = process.env.POS_MODEL || 'claude-opus-4-8';
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'hermes3:latest';
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED !== 'false';

let anthropicClient = null;
async function getClaude() {
  if (anthropicClient) return anthropicClient;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  anthropicClient = new Anthropic();
  return anthropicClient;
}

async function generateClaude({ system, user, maxTokens }) {
  const client = await getClaude();
  if (!client) return null;
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { text, source: 'claude', model: response.model };
}

async function generateOllama({ system, user, maxTokens, timeoutMs = 300_000, retries = 2 }) {
  if (!OLLAMA_ENABLED) return null;

  let delay = 1000;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: false,
          options: { num_predict: maxTokens },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      // A timeout is not worth retrying — the next attempt would just burn
      // another full timeout window. Connection refused means Ollama is not
      // running at all, which is a "not available", not a failure.
      if (err.name === 'AbortError') throw new Error('Ollama timeout');
      return null;
    } finally {
      clearTimeout(timeout);
    }

    // 5xx during model load is transient; back off and retry.
    if (response.status >= 500 && attempt < retries) {
      lastError = `Ollama ${response.status}`;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = (data?.message?.content || '').trim();
    return { text, source: 'ollama', model: data?.model || OLLAMA_MODEL };
  }

  throw new Error(`${lastError || 'Ollama'} — exhausted ${retries} retries`);
}

export async function oneShot({ system, user, maxTokens = 2048, timeoutMs }) {
  const errors = [];
  try {
    const c = await generateClaude({ system, user, maxTokens });
    if (c) return c;
  } catch (err) {
    errors.push(`claude: ${err.message}`);
  }
  try {
    const g = await generateGemini({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens,
    });
    if (g) return g;
  } catch (err) {
    errors.push(`gemini: ${err.message}`);
  }
  try {
    const o = await generateOllama({ system, user, maxTokens, timeoutMs });
    if (o) return o;
  } catch (err) {
    errors.push(`ollama: ${err.message}`);
  }
  const suffix = errors.length ? ` (${errors.join('; ')})` : '';
  throw new Error(
    `No LLM backend available. Set ANTHROPIC_API_KEY or GEMINI_API_KEY, or run Ollama.${suffix}`
  );
}

/**
 * Which backends are usable right now, fastest-first among the configured
 * ones. The UI reads this to warn that voice mode on a local model will be
 * too slow to hold a conversation.
 */
export function backendStatus() {
  return {
    claude: { configured: !!process.env.ANTHROPIC_API_KEY, model: CLAUDE_MODEL, fast: true },
    gemini: { configured: geminiEnabled(), model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview', fast: true },
    ollama: { configured: OLLAMA_ENABLED, model: OLLAMA_MODEL, fast: false },
  };
}

/**
 * Ask oneShot() and parse the response as JSON. Strips markdown code fences
 * if present. Throws if parsing fails.
 */
export async function oneShotJson(params) {
  const result = await oneShot(params);
  const parsed = tryParseJson(result.text);
  if (parsed === null) {
    const preview = result.text.slice(0, 300);
    throw new Error(`LLM did not return parseable JSON. First 300 chars: ${preview}`);
  }
  return { ...result, json: parsed };
}

function tryParseJson(text) {
  const t = text.trim();
  // 1. code-fenced ```json ... ```
  const fence = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ }
  }
  // 2. straight parse
  try { return JSON.parse(t); } catch { /* fall through */ }
  // 3. extract the first balanced JSON array or object
  const arr = extractBalanced(t, '[', ']');
  if (arr) { try { return JSON.parse(arr); } catch { /* fall through */ } }
  const obj = extractBalanced(t, '{', '}');
  if (obj) { try { return JSON.parse(obj); } catch { /* fall through */ } }
  return null;
}

function extractBalanced(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
