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

/** Where a captured fragment belongs. `unclear` is a real answer, not a failure. */
export const DESTINATIONS = [
  'task', 'commitment', 'project', 'idea', 'dependency',
  'knowledge', 'open_question', 'decision', 'health_signal', 'unclear',
];

/**
 * One pass that both classifies a fragment and enriches it.
 *
 * Deliberately a flat superset rather than a per-destination `oneOf`: small
 * models handle a flat object far more reliably, and two passes would double an
 * already 45-second local round trip.
 *
 * Only the four routing fields are `required`. The enrichment fields are
 * optional, which normally violates the "require what you rely on" rule above —
 * it is safe here *only* because nothing writes until the batch review screen
 * has shown every value to the user. If auto-write is ever added, these must
 * become required, or a defaulted `commitment_type` will quietly create a
 * contracted obligation that hijacks Tier 0.
 */
function routeItem(projectRefs, commitmentRefs) {
  return {
  type: 'object',
  properties: {
      text: { type: 'string' },
      destination: { type: 'string', enum: DESTINATIONS },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      why: { type: 'string' },

      // Linking. A conversation usually produces ONE thing with parts — a
      // project, its next action, and what it is waiting on — not several
      // unrelated fragments. `group` ties those together before any of them
      // has an id: every item sharing a group attaches to the project in that
      // group, which is resolved at commit time. `project_id` links to a
      // project that already exists.
      group: { type: 'string' },

      // Links to records that ALREADY EXIST, filled with the short reference
      // the prompt hands out ("P2", "C1") and never a raw row id: a
      // 24-character id is a dozen tokens a small model has to copy perfectly,
      // and a mistyped one is indistinguishable from a deliberate non-answer.
      //
      // Enums over the references that actually exist, for the same reason
      // `unpackSchema` enumerates domain keys: told about a project in the
      // prompt and given a free-text field, a model writes about the project in
      // its `why` and leaves the field empty — measured, repeatedly. A field it
      // must choose a value for gets chosen. `none` is what keeps that from
      // becoming forced linking, and it is why these stay optional.
      //
      // `router.mjs` resolves the reference and drops anything that resolves to
      // nothing, so neither `none` nor an invented value can reach a table.
      //
      // No `description` on either, and that is not an oversight. A schema
      // description travels inside a JSON string, so its quotes arrive as
      // escaped ones — and the model imitates that escaping in its own output,
      // the same format contagion that puts markdown into spoken replies.
      // Measured on identical input: with descriptions the response broke into
      // escaped quotes partway through the second item, every time. Sometimes
      // it still parsed, with the remaining items swallowed into one enormous
      // key — a fragment the user typed vanishing with no error anywhere,
      // which is worse than the parse failure. Without them: clean, every
      // time. The enum carries the meaning; the prompt carries the wording.
      ...(projectRefs.length ? {
        project_id: { type: 'string', enum: [...projectRefs, 'none'] },
      } : {}),

      // One field over both pools: which pool it means is decided by where the
      // item landed, so a commitment reference cannot update a project. Without
      // the project references here, a fragment the model reads as a project it
      // already has has no way to say so, and creates a second copy of it —
      // observed doing exactly that.
      ...(projectRefs.length || commitmentRefs.length ? {
        existing_id: {
          type: 'string',
          enum: [...commitmentRefs, ...projectRefs, 'none'],
        },
      } : {}),

      // Enrichment — shown for editing, never trusted unreviewed.
      title: { type: 'string' },
      due_date: { type: 'string' },
      waiting_party: { type: 'string' },
      owner: { type: 'string' },
      source_link: { type: 'string' },
      time_minutes: { type: 'integer', minimum: 5, maximum: 480 },
      effort_remaining_minutes: { type: 'integer', minimum: 5, maximum: 4800 },
      importance: { type: 'string', enum: IMPORTANCE },
      commitment_type: {
        type: 'string',
        enum: ['contracted', 'speculative', 'personal', 'restorative'],
      },
      income_impact: ZERO_TO_FIVE,
      restorative: ZERO_TO_FIVE,
      energy_required: ONE_TO_FIVE,
      domain_key: { type: 'string' },
      category: { type: 'string' },
  },
  required: ['text', 'destination', 'confidence', 'why'],
  };
}

/**
 * Object root, not a bare array — this is load-bearing.
 *
 * Strict `json_schema` mode does not support a top-level array: the root must
 * be an object. Providers do not agree on how to fail that. Mistral does not
 * error, it returns an **empty result**, which reads as "the model found
 * nothing to extract" and is indistinguishable from a genuinely empty answer.
 * Measured: identical prompt and input returned 0 items with the array-rooted
 * schema and 3 correct items with no schema at all. The array root happened to
 * work for some inputs, which is worse than failing outright — it made the bug
 * look like prompt quality.
 *
 * Callers read `.items`; `unwrapItems()` tolerates either shape.
 */
export function routeSchema({ projects = [], commitments = [] } = {}) {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: routeItem(projects.map((p) => p.ref), commitments.map((c) => c.ref)),
      },
    },
    required: ['items'],
  };
}

/** The shape with nothing to link to. Kept for callers that have no context. */
export const ROUTE_SCHEMA = routeSchema();

/**
 * The complete objects at the start of a response that stopped being JSON.
 *
 * Observed from a hosted provider on an HTTP 200: two valid records, then the
 * model starts escaping its own quotes mid-object and never recovers. Strict
 * parsing yields nothing, the batch falls back to rules, and every fragment the
 * user typed comes back "unclear" — which reads as the router being useless
 * when it actually got most of it right.
 *
 * Scans the first array and keeps whole objects only. A half-written record is
 * discarded rather than repaired: guessing at a truncated field is how a
 * commitment ends up with a deadline nobody said.
 */
export function salvageItems(text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  if (start === -1) return [];

  const out = [];
  let depth = 0, inStr = false, esc = false, objStart = -1;

  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;

    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try { out.push(JSON.parse(s.slice(objStart, i + 1))); }
        catch { return out; }   // the first unreadable object ends the salvage
        objStart = -1;
      }
      if (depth < 0) break;
    }
  }
  return out;
}

/** Accept `{items:[…]}` or a bare array, and never throw on junk. */
export function unwrapItems(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.items)) return json.items;
  return null;
}

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
