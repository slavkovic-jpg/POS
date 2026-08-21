import { RETRYABLE_STATUS, retryAfterMs } from './retry.mjs';

/**
 * One adapter for every provider that speaks the OpenAI chat-completions API.
 *
 * That is most of them, and critically it includes the ones with genuinely free
 * tiers — Groq, Cerebras, OpenRouter, GitHub Models, Together. Rather than
 * writing five integrations, this is a base URL, a key, and a model name.
 *
 * The point for this machine specifically: local inference here is CPU-only on
 * a 15W laptop chip, which measures at roughly one token per second. Any hosted
 * provider is two orders of magnitude faster, and several cost nothing.
 *
 * Configure with:
 *   OPENAI_COMPAT_BASE_URL   e.g. https://api.groq.com/openai/v1
 *   OPENAI_COMPAT_API_KEY
 *   OPENAI_COMPAT_MODEL      e.g. llama-3.3-70b-versatile
 *   OPENAI_COMPAT_LABEL      optional, for the Settings page
 */

const BASE = () => (process.env.OPENAI_COMPAT_BASE_URL || '').replace(/\/+$/, '');
const KEY = () => process.env.OPENAI_COMPAT_API_KEY || '';
export const OPENAI_COMPAT_MODEL = process.env.OPENAI_COMPAT_MODEL || '';
export const OPENAI_COMPAT_LABEL = process.env.OPENAI_COMPAT_LABEL || 'Hosted (OpenAI-compatible)';

export const openaiCompatEnabled = () =>
  !!BASE() && !!KEY() && !!OPENAI_COMPAT_MODEL &&
  process.env.OPENAI_COMPAT_ENABLED !== 'false';

/**
 * Known free-tier providers, surfaced in Settings so the setup is a copy-paste
 * rather than a research project. Availability and limits change; these are
 * starting points, not guarantees.
 */
export const FREE_PROVIDERS = [
  {
    id: 'groq',
    name: 'Groq',
    base_url: 'https://api.groq.com/openai/v1',
    example_model: 'llama-3.3-70b-versatile',
    signup: 'https://console.groq.com',
    note: 'Free tier with daily limits. Extremely fast — usually under a second.',
    supports_json_schema: true,
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    base_url: 'https://api.cerebras.ai/v1',
    example_model: 'llama-3.3-70b',
    signup: 'https://cloud.cerebras.ai',
    note: 'Free tier with daily token limits. The fastest inference available anywhere.',
    supports_json_schema: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1',
    example_model: 'meta-llama/llama-3.3-70b-instruct:free',
    signup: 'https://openrouter.ai/keys',
    note: 'Models with a :free suffix cost nothing. Rate-limited but generous, and one key reaches many models.',
    supports_json_schema: true,
  },
  {
    id: 'github',
    name: 'GitHub Models',
    base_url: 'https://models.github.ai/inference',
    example_model: 'openai/gpt-4o-mini',
    signup: 'https://github.com/settings/tokens',
    note: 'Free with any GitHub account, using a personal access token. Low rate limits, fine for personal use.',
    supports_json_schema: true,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    base_url: 'https://api.mistral.ai/v1',
    example_model: 'mistral-small-latest',
    signup: 'https://console.mistral.ai',
    note: 'Free experiment tier. Good at structured extraction.',
    supports_json_schema: true,
  },
];

/**
 * @param schema  JSON Schema. Sent as response_format json_schema, which most
 *                of these providers honour. Providers that do not simply return
 *                JSON-ish text, which the caller's parser already tolerates.
 */
export async function generateOpenAICompat({
  system, messages, user, maxTokens = 2048, timeoutMs = 60_000,
  retries = 2, schema = null, temperature = null,
}) {
  if (!openaiCompatEnabled()) return null;

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  if (messages) msgs.push(...messages);
  else if (user) msgs.push({ role: 'user', content: user });

  const body = {
    model: OPENAI_COMPAT_MODEL,
    messages: msgs,
    max_tokens: maxTokens,
    temperature: temperature ?? (schema ? 0 : 0.7),
  };
  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'result', strict: true, schema },
    };
  }

  let delay = 1000;
  let lastError = null;
  let errorRetried = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${BASE()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${KEY()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Hosted provider timeout');
      lastError = err.message;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delay)); delay *= 2; continue;
      }
      throw new Error(`Hosted provider network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (RETRYABLE_STATUS(response.status) && attempt < retries) {
      lastError = `HTTP ${response.status}`;
      await new Promise((r) => setTimeout(r, retryAfterMs(response) ?? delay));
      delay *= 2;
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // A schema-unsupported error is worth retrying without the schema rather
      // than failing: the parser downstream copes with plain JSON text.
      if (schema && /response_format|json_schema|not supported/i.test(text)) {
        return generateOpenAICompat({
          system, messages, user, maxTokens, timeoutMs, retries: 0,
          schema: null, temperature,
        });
      }
      throw new Error(`Hosted provider ${response.status}: ${text.slice(0, 250)}`);
    }

    const data = await response.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();

    // HTTP 200 with finish_reason "error" is the provider failing mid-stream,
    // not the model answering. What comes back is a valid object followed by
    // the start of a second one, which parses as nothing — and without this
    // retry the whole batch degrades to rules and every item reads "unclear",
    // which looks like the model being useless rather than one bad response.
    // Once only: the failure is mostly input-shaped rather than transient, so
    // a third and fourth identical request mostly buys latency. What survives
    // it is the caller salvaging whatever parsed.
    if (data?.choices?.[0]?.finish_reason === 'error' && !errorRetried && attempt < retries) {
      errorRetried = true;
      lastError = 'provider finish_reason=error';
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
      continue;
    }

    return {
      text: text || '(no response)',
      source: 'hosted',
      model: data?.model || OPENAI_COMPAT_MODEL,
      usage: data?.usage,
      // Carried so a parse failure downstream can say whether the JSON was
      // malformed or simply cut off at the token limit. Those need opposite
      // fixes and look identical in a 300-character preview.
      finishReason: data?.choices?.[0]?.finish_reason || null,
    };
  }

  throw new Error(`${lastError || 'Hosted provider'} — exhausted ${retries} retries`);
}
