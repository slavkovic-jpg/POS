/**
 * Google Gemini backend.
 *
 * Ported from the Canvas prototype, which called Gemini directly from the
 * browser with the key in localStorage. Here the key stays server-side —
 * the browser never sees it.
 *
 * Gemini's wire format differs from Anthropic's in three ways that matter:
 *   - the assistant role is called "model", not "assistant"
 *   - the system prompt is a separate top-level `systemInstruction`
 *   - message text lives in a `parts` array
 * `toGeminiContents()` handles the translation.
 */

import { RETRYABLE_STATUS, retryAfterMs } from './retry.mjs';

const HOST = 'https://generativelanguage.googleapis.com/v1beta/models';

// The Canvas prototype used gemini-3-flash-preview and the user confirms it
// works for them. Override with GEMINI_MODEL if Google rotates the name —
// a wrong model id surfaces as a 404 with the id echoed back.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

export const geminiEnabled = () =>
  !!process.env.GEMINI_API_KEY && process.env.GEMINI_ENABLED !== 'false';

/** Anthropic-style messages -> Gemini `contents`. */
function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

/**
 * Single call to Gemini. Returns null when Gemini is not configured, so
 * callers can fall through to the next backend.
 */
export async function generateGemini({
  system,
  messages,
  maxTokens = 2048,
  timeoutMs = 120_000,
  retries = 2,
}) {
  if (!geminiEnabled()) return null;

  const url = `${HOST}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const body = {
    contents: toGeminiContents(messages),
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let delay = 1000;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Gemini timeout');
      // Network failure. Retry, then give up and let the caller fall through.
      lastError = err.message;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw new Error(`Gemini network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    // 429 and 5xx are transient — this backoff is the one genuinely useful
    // piece of the prototype's fetch wrapper. Google's Retry-After, when
    // present, is better information than our doubling guess.
    if (RETRYABLE_STATUS(response.status) && attempt < retries) {
      lastError = `Gemini ${response.status}`;
      await new Promise((r) => setTimeout(r, retryAfterMs(response) ?? delay));
      delay *= 2;
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gemini ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];

    // A safety block returns 200 with no content — surface it rather than
    // returning an empty string that looks like a normal reply.
    if (!candidate) {
      const blocked = data?.promptFeedback?.blockReason;
      throw new Error(blocked ? `Gemini blocked the prompt: ${blocked}` : 'Gemini returned no candidates');
    }

    const text = (candidate.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    return {
      text: text || '(no response)',
      source: 'gemini',
      model: GEMINI_MODEL,
      finish_reason: candidate.finishReason,
    };
  }

  throw new Error(`${lastError || 'Gemini'} — exhausted ${retries} retries`);
}
