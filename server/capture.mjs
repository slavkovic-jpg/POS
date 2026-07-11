import { db } from './db.mjs';
import { oneShotJson } from './llm.mjs';

const CAPTURE_SYSTEM = `Scan the recent conversation between the user and the assistant. Return a JSON object with three arrays of items worth persisting to the user's Personal OS.

Return ONLY this JSON shape (no prose, no markdown):
{
  "open_questions": [
    {"question": "the question in the user's voice, one sentence", "context": "1 sentence why this is unresolved", "importance": 1-5}
  ],
  "decisions": [
    {"decision": "the decision made, one sentence", "reasoning": "what drove it", "confidence": 0.3-0.9}
  ],
  "knowledge": [
    {"category": "identity|values|strengths|weaknesses|motivations|energy|habits|preferences|stress_triggers|decision_style|career|personal_life|learning|finances", "content": "one specific self-contained observation about the user", "confidence": 0.3-0.9}
  ]
}

Rules:
- Only extract items that are genuinely worth remembering — skip small talk, restatements, and generic advice.
- Prefer 0-2 items per array over inventing content. Empty arrays are fine.
- Never invent facts. If the user hasn't clearly said something, don't put it in "knowledge".
- Importance 5 = highest strategic weight. Confidence: 0.3 = low, 0.9 = very confident.
- Every "content" / "question" / "decision" must be self-contained — a future reader with no context should understand it.
- Start with { and end with }.`;

export async function captureFromConversation({ limit = 20 } = {}) {
  const history = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE role IN ('user', 'assistant')
     ORDER BY id DESC LIMIT ?`
  ).all(limit).reverse();

  if (history.length === 0) {
    return { open_questions: [], decisions: [], knowledge: [], source: null };
  }

  const transcript = history
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
    .join('\n\n');

  const result = await oneShotJson({
    system: CAPTURE_SYSTEM,
    user: transcript,
    maxTokens: 1500,
    timeoutMs: 300_000,
  });

  const j = result.json || {};
  return {
    open_questions: sanitizeQuestions(j.open_questions),
    decisions: sanitizeDecisions(j.decisions),
    knowledge: sanitizeKnowledge(j.knowledge),
    source: result.source,
    model: result.model,
  };
}

function sanitizeQuestions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((q) => q?.question?.trim())
    .map((q) => ({
      question: q.question.trim(),
      context: (q.context || '').toString().trim(),
      strategic_importance: clampInt(q.importance, 1, 5, 3),
    }));
}

function sanitizeDecisions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((d) => d?.decision?.trim())
    .map((d) => ({
      decision: d.decision.trim(),
      reasoning: (d.reasoning || '').toString().trim(),
      confidence: clampFloat(d.confidence, 0, 1, 0.6),
    }));
}

const VALID_CATEGORIES = new Set([
  'identity', 'values', 'strengths', 'weaknesses', 'motivations',
  'energy', 'habits', 'preferences', 'stress_triggers', 'decision_style',
  'career', 'personal_life', 'learning', 'finances', 'current_reality',
]);

function sanitizeKnowledge(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((k) => k?.content?.trim())
    .map((k) => ({
      category: VALID_CATEGORIES.has(k.category) ? k.category : 'identity',
      content: k.content.trim(),
      confidence: clampFloat(k.confidence, 0, 1, 0.6),
    }));
}

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
function clampFloat(v, lo, hi, dflt) {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
