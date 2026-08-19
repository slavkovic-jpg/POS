import { generateGemini, geminiEnabled, GEMINI_MODEL } from './gemini.mjs';

/**
 * Live backend tests. Every check makes a real (tiny) request and reports
 * exactly what came back, because "configured" and "working" are different
 * things — a key can be present and still be revoked, out of quota, or scoped
 * to the wrong model.
 */

const CLAUDE_MODEL = process.env.POS_MODEL || 'claude-opus-4-8';
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'hermes3:latest';

const PING = 'Reply with exactly the word: pong';

async function timed(fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - t0, ...detail };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: err.message };
  }
}

async function testClaude() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { configured: false, ok: false, reason: 'ANTHROPIC_API_KEY not set' };
  }
  const r = await timed(async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: PING }],
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { model: res.model, reply: text.slice(0, 60) };
  });
  return { configured: true, model: CLAUDE_MODEL, ...r };
}

async function testGemini() {
  if (!geminiEnabled()) {
    return {
      configured: false,
      ok: false,
      reason: process.env.GEMINI_API_KEY ? 'GEMINI_ENABLED=false' : 'GEMINI_API_KEY not set',
    };
  }
  const r = await timed(async () => {
    const res = await generateGemini({
      messages: [{ role: 'user', content: PING }],
      maxTokens: 16,
      timeoutMs: 30_000,
      retries: 0,        // a connection test should fail fast, not retry
    });
    return { model: res.model, reply: (res.text || '').slice(0, 60) };
  });
  return { configured: true, model: GEMINI_MODEL, ...r };
}

async function testOllama() {
  if (process.env.OLLAMA_ENABLED === 'false') {
    return { configured: false, ok: false, reason: 'OLLAMA_ENABLED=false' };
  }
  const r = await timed(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const data = await res.json();
      const names = (data.models || []).map((m) => m.name);
      if (!names.length) throw new Error('Ollama is running but no models are pulled');
      // Reachability is what we test here. A generation ping would take
      // minutes on CPU and is not what this button is for.
      const has = names.includes(OLLAMA_MODEL);
      return {
        models: names,
        reply: has ? `reachable, ${OLLAMA_MODEL} present` : `reachable, but ${OLLAMA_MODEL} NOT pulled`,
        warning: has ? undefined : `Configured model "${OLLAMA_MODEL}" is not pulled. Available: ${names.join(', ')}`,
      };
    } finally { clearTimeout(timer); }
  });
  return { configured: true, model: OLLAMA_MODEL, ...r };
}

export async function testBackends() {
  const [claude, gemini, ollama] = await Promise.all([testClaude(), testGemini(), testOllama()]);
  return {
    claude, gemini, ollama,
    checked_at: new Date().toISOString(),
    any_working: [claude, gemini, ollama].some((b) => b.ok),
    fast_working: [claude, gemini].some((b) => b.ok),
  };
}
