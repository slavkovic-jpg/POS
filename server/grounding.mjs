import { db, now } from './db.mjs';
import { GEMINI_MODEL, geminiEnabled } from './gemini.mjs';

/**
 * Web-grounded research for a single task — the "Ground Web" action from the
 * Canvas prototype.
 *
 * Both supported backends can search, but through different mechanisms:
 *   - Anthropic: the `web_search` server tool, results arrive as content blocks
 *   - Gemini:    the `google_search` tool, sources arrive in groundingMetadata
 * Ollama has no web access at all, so this action is simply unavailable there
 * rather than silently returning the model's stale training data as if it were
 * research — which would be worse than an error.
 */

const CLAUDE_MODEL = process.env.POS_MODEL || 'claude-opus-4-8';

export function groundingAvailable() {
  return !!process.env.ANTHROPIC_API_KEY || geminiEnabled();
}

const SYSTEM = `You research a single task and return what would actually help someone doing it.

Search the web, then give:
- Two or three sentences of concrete, current guidance. Specific over general.
- Skip anything the person obviously already knows by virtue of having written the task.
- If the task is personal or has no useful public information (calling a family
  member, tidying a desk), say so plainly in one sentence instead of padding.

No preamble. No markdown headings.`;

// ---------------------------------------------------------------------------

async function groundClaude(query) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: query }],
  });

  const summary = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // Sources live inside web_search_tool_result blocks. An error result has an
  // object for `content` rather than a list — guard before iterating.
  const sources = [];
  for (const block of response.content) {
    if (block.type !== 'web_search_tool_result') continue;
    const items = Array.isArray(block.content) ? block.content : [];
    for (const item of items) {
      if (item.url) sources.push({ url: item.url, title: item.title || item.url });
    }
  }

  return { summary, sources: dedupe(sources), source: 'claude', model: response.model };
}

async function groundGemini(query) {
  if (!geminiEnabled()) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: query }] }],
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: [{ google_search: {} }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gemini grounding timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates');

  const summary = (candidate.content?.parts || []).map((p) => p.text || '').join('').trim();

  // Gemini has shipped two shapes for this over time; read both.
  const meta = candidate.groundingMetadata || {};
  const raw = [...(meta.groundingChunks || []), ...(meta.groundingAttributions || [])];
  const sources = raw
    .map((a) => ({ url: a.web?.uri, title: a.web?.title || a.web?.uri }))
    .filter((s) => s.url);

  return { summary, sources: dedupe(sources), source: 'gemini', model: GEMINI_MODEL };
}

function dedupe(sources) {
  const seen = new Set();
  return sources.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true))).slice(0, 8);
}

// ---------------------------------------------------------------------------

export async function groundTask(taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);

  if (!groundingAvailable()) {
    throw new Error(
      'Web research needs Claude or Gemini. A local model has no web access, and answering ' +
      'from its training data would look like research without being it.'
    );
  }

  const query =
    `Task: ${task.title}` +
    (task.rationale ? `\nWhy it matters: ${task.rationale}` : '') +
    (task.notes ? `\nNotes: ${task.notes}` : '') +
    `\n\nWhat current, practical guidance would genuinely help someone doing this?`;

  const errors = [];
  let result = null;
  try {
    result = await groundClaude(query);
  } catch (err) { errors.push(`claude: ${err.message}`); }

  if (!result) {
    try {
      result = await groundGemini(query);
    } catch (err) { errors.push(`gemini: ${err.message}`); }
  }

  if (!result) throw new Error(errors.join('; ') || 'No grounding backend available');

  db.prepare(
    `UPDATE tasks SET grounding_json = ?, updated_at = ? WHERE id = ?`
  ).run(JSON.stringify({
    summary: result.summary,
    sources: result.sources,
    source: result.source,
    model: result.model,
    fetched_at: now(),
  }), now(), taskId);

  return getGrounding(taskId);
}

export function getGrounding(taskId) {
  const row = db.prepare('SELECT grounding_json FROM tasks WHERE id = ?').get(taskId);
  if (!row?.grounding_json) return null;
  try { return JSON.parse(row.grounding_json); } catch { return null; }
}
