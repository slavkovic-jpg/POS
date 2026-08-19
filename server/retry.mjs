/**
 * Exponential backoff for transient upstream failures.
 *
 * Centralised because the same loop had been written three times (Gemini
 * chat, Ollama chat, and nearly a fourth in grounding) and they had already
 * drifted — one retried 429, another only 5xx.
 *
 * What is and isn't retryable matters more than the backoff curve:
 *   - 429 and 5xx are transient. Retry.
 *   - 4xx other than 429 means the request is wrong. Retrying sends the same
 *     wrong request again and just delays the error.
 *   - A timeout is not retried either: the next attempt would burn another
 *     full timeout window, so a 5-minute local-model call becomes 15.
 */

export const RETRYABLE_STATUS = (status) => status === 429 || status >= 500;

/**
 * @param {() => Promise<{retry?: boolean, reason?: string, value?: any}>} attempt
 *   Resolve `{retry: true, reason}` to trigger a backoff, or `{value}` to finish.
 */
export async function withRetry(attempt, { retries = 2, baseMs = 1000, label = 'request' } = {}) {
  let delay = baseMs;
  let lastReason = null;

  for (let i = 0; i <= retries; i++) {
    const result = await attempt(i);
    if (!result?.retry) return result?.value;

    lastReason = result.reason || 'transient failure';
    if (i === retries) break;

    // Jitter avoids a thundering herd when several calls fail together —
    // the dashboard can fire recommend, unpack and grounding at once.
    const jitter = Math.random() * 250;
    await new Promise((r) => setTimeout(r, delay + jitter));
    delay *= 2;
  }

  throw new Error(`${label}: ${lastReason} — gave up after ${retries} retries`);
}

/** Read a Retry-After header when the server offers one; it beats guessing. */
export function retryAfterMs(response) {
  const header = response?.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), 30_000);
}
