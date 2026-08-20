/**
 * JSON Schemas for every structured extraction.
 *
 * These are not documentation. Ollama uses them to constrain decoding, so a
 * small model *cannot* emit malformed JSON, a wrong enum value, or a missing
 * field — the sampler will not let it. That converts the most common local-model
 * failure ("returned an apology instead of an array") from a runtime error into
 * an impossibility.
 *
 * Two rules learned the hard way:
 *   - Enums, not numeric scales. A model asked for "1-5 where 1 is highest"
 *     will invert it and produce a perfectly plausible, exactly backwards list.
 *     A constrained enum cannot be inverted.
 *   - Set `required` on everything you actually rely on. An omitted field is
 *     silently filled with a default, which is how a task ends up scored 3 when
 *     the model meant 1.
 */

const IMPORTANCE = ['critical', 'high', 'medium', 'low', 'someday'];
const ONE_TO_FIVE = { type: 'integer', minimum: 1, maximum: 5 };
const ZERO_TO_FIVE = { type: 'integer', minimum: 0, maximum: 5 };

export function unpackSchema(domainKeys) {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        domain_key: { type: 'string', enum: [...domainKeys, 'none'] },
        time_minutes: { type: 'integer', minimum: 5, maximum: 480 },
        importance: { type: 'string', enum: IMPORTANCE },
        energy_required: ONE_TO_FIVE,
        anxiety_level: ONE_TO_FIVE,
        income_impact: ZERO_TO_FIVE,
        restorative: ZERO_TO_FIVE,
        commitment_type: {
          type: 'string',
          enum: ['contracted', 'speculative', 'personal', 'restorative'],
        },
        rationale: { type: 'string' },
      },
      required: [
        'title', 'domain_key', 'time_minutes', 'importance',
        'energy_required', 'anxiety_level', 'income_impact', 'restorative',
        'commitment_type', 'rationale',
      ],
    },
  };
}

export const BREAKDOWN_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      est_minutes: { type: 'integer', minimum: 1, maximum: 60 },
    },
    required: ['text', 'est_minutes'],
  },
};

export const CAPTURE_SCHEMA = {
  type: 'object',
  properties: {
    open_questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          context: { type: 'string' },
          importance: ONE_TO_FIVE,
        },
        required: ['question', 'context', 'importance'],
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          decision: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['decision', 'reasoning', 'confidence'],
      },
    },
    knowledge: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['identity', 'values', 'strengths', 'weaknesses', 'motivations',
                   'energy', 'habits', 'preferences', 'stress_triggers',
                   'decision_style', 'career', 'personal_life', 'learning',
                   'finances', 'current_reality'],
          },
          content: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['category', 'content', 'confidence'],
      },
    },
  },
  required: ['open_questions', 'decisions', 'knowledge'],
};

export const CV_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['career', 'skills', 'leadership', 'achievements', 'industries',
               'expertise', 'opportunities'],
      },
      content: { type: 'string' },
      confidence: { type: 'number', minimum: 0.3, maximum: 0.8 },
    },
    required: ['category', 'content', 'confidence'],
  },
};

export const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    mindset_primer: { type: 'string' },
    deferred_note: { type: 'string' },
  },
  required: ['reasoning', 'mindset_primer', 'deferred_note'],
};

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    achievements: { type: 'string' },
    failures: { type: 'string' },
    lessons: { type: 'string' },
    energy_notes: { type: 'string' },
    burnout_indicators: { type: 'string' },
    next_period_recommendations: { type: 'string' },
  },
  required: ['achievements', 'failures', 'lessons', 'energy_notes',
             'burnout_indicators', 'next_period_recommendations'],
};
