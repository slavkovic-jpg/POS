import { db, now } from './db.mjs';
import { oneShotJson } from './llm.mjs';
import { CV_SCHEMA } from './schemas.mjs';
import { addKnowledge } from './knowledge.mjs';

// ---- Profile CRUD ---------------------------------------------------------
export function getProfile() {
  const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
  return row || null;
}

export function updateProfile({ name, bio, cv_raw, linkedin_url }) {
  db.prepare(
    `UPDATE user_profile SET
       name = COALESCE(?, name),
       bio = COALESCE(?, bio),
       cv_raw = COALESCE(?, cv_raw),
       linkedin_url = COALESCE(?, linkedin_url),
       updated_at = ?
     WHERE id = 1`
  ).run(name ?? null, bio ?? null, cv_raw ?? null, linkedin_url ?? null, now());
  return getProfile();
}

export function completeOnboarding() {
  db.prepare('UPDATE user_profile SET onboarded_at = ?, updated_at = ? WHERE id = 1')
    .run(now(), now());
  return getProfile();
}

// ---- CV analysis ---------------------------------------------------------
const CV_SYSTEM = `Analyze the CV below. Return ONLY a JSON array (no prose, no markdown, no code fences).

Each item: {"category":"<c>","content":"<one sentence>","confidence":<0.4-0.8>}

Category must be one of: career, skills, leadership, achievements, industries, expertise, opportunities.

Return 8-15 items covering multiple categories. Each content must stand alone — someone who never saw the CV must understand it. "opportunities" items are your inferences about where this person could go next. Keep each content under 25 words. Never exceed confidence 0.8 (these are hypotheses).

Start your response with [ and end with ].`;

export async function analyzeCv(cvText) {
  if (!cvText?.trim()) throw new Error('cv_text required');

  const result = await oneShotJson({
    system: CV_SYSTEM,
    user: cvText,
    maxTokens: 1500,
    timeoutMs: 300_000,
    schema: CV_SCHEMA,
  });

  if (!Array.isArray(result.json)) {
    throw new Error('LLM returned JSON but not an array. Try again or edit the CV text.');
  }

  const validCategories = new Set([
    'career', 'skills', 'leadership', 'achievements',
    'industries', 'expertise', 'opportunities',
  ]);

  const hypotheses = result.json
    .filter((h) => h && typeof h.content === 'string' && h.content.trim())
    .map((h) => ({
      category: validCategories.has(h.category) ? h.category : 'career',
      content: h.content.trim(),
      confidence: Math.min(0.8, Math.max(0.3, Number(h.confidence) || 0.6)),
    }));

  return { hypotheses, source: result.source, model: result.model };
}

/**
 * Accept an array of {category, content, confidence} and write each to the
 * knowledge table with source='cv'.
 */
export function acceptHypotheses(items) {
  const saved = [];
  for (const item of items) {
    if (!item?.content?.trim()) continue;
    saved.push(addKnowledge({
      category: item.category || 'career',
      content: item.content.trim(),
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.6)),
      source: 'cv',
    }));
  }
  return saved;
}
