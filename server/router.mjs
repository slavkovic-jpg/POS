/**
 * Capture routing — decide where each fragment of a dump belongs, propose the
 * whole batch, and write nothing until it is accepted.
 *
 * The shape of this module is set by one constraint (AGENTS.md #5): captures
 * are never silently promoted. That is not softened here. What changes is
 * *where* the agreement happens — once per batch, on a screen that shows every
 * value, instead of once per item as data entry after the fact.
 *
 * So: `routeCapture()` is pure proposal and touches no table. `commitRoutes()`
 * is the only thing that writes, and it only ever runs on what came back from
 * the review screen.
 *
 * Two deliberate properties:
 *
 *  1. `preClassify()` needs no model. With every backend down, routing degrades
 *     to deterministic rules plus `unclear` — honest and still useful — rather
 *     than failing. Same reason `scoring.mjs` is pure arithmetic.
 *  2. `unclear` is a first-class destination. A router that always picks
 *     something is a router that fabricates, and the cost of a wrong guess is
 *     not symmetric — see the blast-radius note on commitments below.
 */

import { db, now } from './db.mjs';
import { oneShotJson } from './llm.mjs';
import { parseDateLoose } from './scoring.mjs';
import { routeSchema, DESTINATIONS, unwrapItems, salvageItems } from './schemas.mjs';
import { createEntity, getEntity, updateEntity, logEvent } from './entities.mjs';
import { addTask } from './tasks.mjs';
import { addKnowledge } from './knowledge.mjs';
import { addOpenQuestion } from './open-questions.mjs';
import { addDecision } from './decisions.mjs';

/**
 * How much damage a wrong route does, which is not at all what it feels like.
 *
 * A misfiled task costs three seconds to delete. A misfiled `knowledge` row
 * becomes a premise in every future system prompt. A hallucinated `contracted`
 * commitment with critical slack makes the ranker refuse to suggest anything
 * else and be extremely confident about it — one bad row takes the whole app
 * hostage. The review screen sorts by this, so the dangerous ones are read
 * first while attention is fresh.
 */
export const BLAST_RADIUS = {
  commitment: 3, knowledge: 3,
  decision: 2, project: 2, health_signal: 2,
  task: 1, open_question: 1, idea: 1, dependency: 1,
  unclear: 0,
};

// ---------------------------------------------------------------------------
// Fragmenting
// ---------------------------------------------------------------------------

/**
 * Split a dump into fragments. Newlines and bullets first, because that is how
 * people actually separate thoughts when typing; sentence splitting only for a
 * long unbroken run, which is what dictation produces.
 */
export function splitFragments(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const byLine = raw
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  const out = [];
  for (const line of byLine) {
    if (line.length <= 220) { out.push(line); continue; }
    // Long dictated run — split on sentence ends, keeping the terminator.
    const parts = line.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [line];
    for (const p of parts) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic pre-classification — no model required
// ---------------------------------------------------------------------------

const RULES = [
  {
    destination: 'open_question',
    // A real question, not a rhetorical opener to a task ("can you book...").
    test: (s) => /\?\s*$/.test(s) && !/^\s*(can you|could you|please|would you)\b/i.test(s),
    why: 'Phrased as an open question.',
  },
  {
    destination: 'idea',
    test: (s) => /^\s*(idea\s*:|what if\b|maybe (i|we) could\b|wouldn'?t it be\b|thought\s*:)/i.test(s),
    why: 'Opens like a speculative idea rather than an action.',
  },
  {
    destination: 'decision',
    test: (s) => /\b(i(?:'ve| have)? decided|decided (?:to|against|on)|going with|settled on|we'?ll go with)\b/i.test(s),
    why: 'States a decision already made.',
  },
  {
    destination: 'health_signal',
    test: (s) => /\b(slept|sleep|hours of sleep|resting hr|hrv|energy (?:was|is) (?:low|high)|exhausted|wiped out)\b/i.test(s),
    why: 'Reports a physical or energy state.',
  },
  {
    destination: 'commitment',
    // Someone else + a date + a deliverable verb. All three, or it is a task.
    test: (s) =>
      /\b(?:for|to|with)\s+[A-Z][a-z]+\b/.test(s) &&
      DATE_HINT.test(s) &&
      /\b(send|deliver|submit|finish|hand over|get back to|report|invoice|present|ship)\b/i.test(s),
    why: 'Names another person, a date, and something to be delivered.',
  },
];

const DATE_HINT =
  /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|end of (?:the )?(?:week|month)|\d{1,2}[.\/-]\d{1,2}|\d{4}-\d{2}-\d{2}|by \w+)\b/i;

/**
 * A destination from rules alone, or null when no rule fires with confidence.
 * Never overrides the model silently — disagreement is surfaced at review.
 */
export function preClassify(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  for (const r of RULES) {
    if (r.test(s)) {
      return { destination: r.destination, confidence: 'medium', why: r.why, by: 'rule' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Learned corrections
// ---------------------------------------------------------------------------

export function recordCorrection(text, proposed, chosen) {
  if (!text || !chosen || proposed === chosen) return;
  db.prepare(
    'INSERT INTO routing_examples (text, proposed, chosen, created_at) VALUES (?, ?, ?, ?)'
  ).run(String(text).slice(0, 400), proposed || null, chosen, now());
}

export function learnedExamples(limit = 12) {
  return db.prepare(
    'SELECT text, chosen FROM routing_examples ORDER BY id DESC LIMIT ?'
  ).all(limit);
}

export function correctionStats() {
  return db.prepare(
    `SELECT chosen, COUNT(*) AS n FROM routing_examples
     GROUP BY chosen ORDER BY n DESC`
  ).all();
}

// ---------------------------------------------------------------------------
// What already exists
// ---------------------------------------------------------------------------

/**
 * The open projects and commitments, so a fragment can attach to one instead of
 * becoming an orphan or a duplicate.
 *
 * Ids are handed to the model as short references — `P2`, `C1` — and never raw.
 * A real id is `prj_20260820-143011-a3f2`: a dozen tokens a small model has to
 * copy exactly, and one wrong character produces a link that resolves to
 * nothing while looking deliberate. A reference is one token, and an invented
 * one fails to resolve loudly rather than pointing at a random row.
 *
 * Name only, no purpose or status: this is the one place a little context buys
 * a lot, and prompt size is a latency problem on a CPU-only local model.
 */
export function routingContext({ projects = 30, commitments = 30 } = {}) {
  const ps = db.prepare(
    `SELECT id, name FROM projects
     WHERE status NOT IN ('archived', 'completed')
     ORDER BY COALESCE(NULLIF(last_activity_at, ''), created_at) DESC LIMIT ?`
  ).all(projects);

  const cs = db.prepare(
    `SELECT id, description FROM commitments
     WHERE status IN ('open', 'in_progress', 'at_risk', 'renegotiated')
     ORDER BY created_at DESC LIMIT ?`
  ).all(commitments);

  return {
    projects: ps.map((r, i) => ({ ref: `P${i + 1}`, id: r.id, name: r.name })),
    commitments: cs.map((r, i) => ({ ref: `C${i + 1}`, id: r.id, name: r.description })),
  };
}

const EMPTY_CONTEXT = { projects: [], commitments: [] };

function contextBlock(ctx) {
  const parts = [];
  if (ctx.projects.length) {
    parts.push('Projects that already exist:\n' +
      ctx.projects.map((p) => `- ${p.ref} ${p.name}`).join('\n'));
  }
  if (ctx.commitments.length) {
    parts.push('Commitments already recorded:\n' +
      ctx.commitments.map((c) => `- ${c.ref} ${c.name}`).join('\n'));
  }
  if (!parts.length) return '';

  return '\n\nThe system is not empty.\n\n' + parts.join('\n\n') + `

Linking. This does not change where a fragment goes, only what it attaches to. Work on a project that already exists is still a task — it is a task belonging to that project. Only call something a project when it is a new container that is not listed above.
- "project_id": the reference of the project above this fragment is part of the work for, written exactly as listed ("P2"). Same subject matter is enough — the fragment will not usually name the project. "finish the model" is work on "Q3 reporting" when that is the reporting job in flight.
- "existing_id": the reference of the commitment above this fragment is about ("C1") — the same promise, said again or updated. That updates the one already recorded instead of promising it twice.
- Leave both out when nothing listed above is actually the same work or the same promise, and never invent a reference that is not listed.`;
}

/** The context entry a model reference points at, or null. Tolerates a raw id. */
export function resolveRef(pool, value) {
  if (!pool || !pool.length || !value) return null;
  const s = String(value).trim();
  if (!s) return null;
  return pool.find((r) => r.ref.toLowerCase() === s.toLowerCase())
      || pool.find((r) => r.id === s)
      || null;
}

// Function words only. Verbs like "send" and "invoice" are exactly what makes
// two promises the same promise, so they stay in.
const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'and', 'by', 'on',
  'in', 'with', 'my', 'me', 'it', 'that', 'this', 'is', 'are', 'be', 'was',
  'need', 'needs', 'needed', 'have', 'has', 'about', 'from', 'his', 'her',
  'their', 'our', 'over', 'into', 'out', 'up']);

function contentWords(s) {
  return [...new Set(
    String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  )];
}

/** 0..1 overlap of content words. Deliberately crude — it only has to notice. */
export function similarity(a, b) {
  const A = contentWords(a);
  const B = new Set(contentWords(b));
  if (!A.length || !B.size) return 0;
  const shared = A.filter((w) => B.has(w));
  // One word in common is a coincidence, not a duplicate.
  if (shared.length < 2) return 0;
  return shared.length / Math.max(A.length, B.size);
}

const DUPLICATE_THRESHOLD = 0.6;

/**
 * The existing record this text is probably a second copy of, or null.
 *
 * Runs whether or not the model linked anything, because the two fail in
 * different directions: the model misses a duplicate when the wording moved,
 * and this misses one when the wording changed entirely but the promise did
 * not. Neither decides anything — the review screen offers the match and the
 * user picks.
 */
export function nearestMatch(pool, text, threshold = DUPLICATE_THRESHOLD) {
  let best = null;
  for (const row of pool || []) {
    const score = similarity(text, row.name);
    if (score >= threshold && (!best || score > best.score)) best = { ...row, score };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

const ROUTER_SYSTEM = `You sort fragments of a personal brain dump into the part of a Personal OS where each belongs. You do not act on them and you do not write anything — you only say where each one goes.

Destinations:
- task            something to DO. Has an action.
- commitment      a promise to a NAMED OTHER PERSON, with a date. Not a note-to-self.
- project         a container for several actions towards one outcome.
- dependency      something BLOCKED ON SOMEONE ELSE — an approval, a reply, a delivery you cannot start without.
- idea            a possibility with no action yet. Worth keeping, not worth doing.
- knowledge       a durable fact about the user themselves (how they work, what they value, their history).
- open_question   something unresolved they are still chewing on.
- decision        something they have already decided, worth recording with its reasoning.
- health_signal   sleep, energy, physical state.
- unclear         you genuinely cannot tell.

Rules:
- "unclear" is a correct and useful answer. Use it whenever you are guessing. Guessing wrong is worse than saying you don't know.
- commitment requires all three: another person, a date, something delivered to them. "Call Mum" is a task, not a commitment. If any of the three is missing, it is a task.
- knowledge is about who the user IS, not what they need to do. "I focus best before 11am" is knowledge. "Book the flight" is not.
- Keep "text" as the fragment's own words, unedited.
- Confidence "high" only when the destination is unambiguous.
- Fill enrichment fields only when the fragment actually states them. Do not invent a deadline, a person, or a duration that was not said.
- Effort is in WORKING time. "A day of work" is about 6 hours (360 minutes), not 24. "Three days of work" is about 1080 minutes. Treating a working day as 24 hours overstates the effort roughly fourfold and makes deliverable work look impossible.
- time_minutes is one sitting; effort_remaining_minutes is the total left across all sittings. For anything spanning days, set effort_remaining_minutes — it is what makes a long job legible as a long job.`;

function examplesBlock() {
  const ex = learnedExamples();
  if (!ex.length) return '';
  const lines = ex
    .map((e) => `- "${String(e.text).replace(/"/g, "'").slice(0, 140)}" -> ${e.chosen}`)
    .join('\n');
  return `\n\nThe user has previously corrected these routings. Follow the same pattern:\n${lines}`;
}

const CONVERSATION_SYSTEM = `You read a conversation between a user and their assistant, and extract the concrete records that were AGREED or ESTABLISHED in it, so they can be filed into the user's Personal OS.

This is not sentence-by-sentence sorting. A conversation usually produces ONE thing with parts — a project, its next action, and what it is waiting on — rather than several unrelated fragments. Group those with the same "group" value so they end up linked.

Destinations:
- task            something to DO. Has an action.
- commitment      a promise to a NAMED OTHER PERSON, with a date.
- project         a container for several actions towards one outcome.
- dependency      something BLOCKED ON SOMEONE ELSE — an approval, a reply, a delivery.
- idea            a possibility with no action yet.
- knowledge       a durable fact about the user themselves.
- open_question   something unresolved they are still chewing on.
- decision        something already decided, worth recording with its reasoning.
- health_signal   sleep, energy, physical state.
- unclear         you genuinely cannot tell.

Your main job: when the assistant laid out where something should go — a project with a domain, a deadline, a next action, something it is waiting on — turn that plan into records. The assistant cannot file anything itself; you are the step that makes its plan real. Extract EVERY part of it, all sharing one "group". Do this even if the assistant said it had no way to file, or asked a follow-up question afterwards — the plan still stands.

Worked example.

  ASSISTANT: Where it goes — Project: Website rebuild. Domain: Career.
  Deadline: 60 days. Waiting on: the client's brand assets.
  Next action: draft the sitemap, due in 3 days. Repo: https://example.com/x

  You return:
  [
    {"text":"Website rebuild","destination":"project","confidence":"high","why":"The assistant scoped this as a project.","group":"website_rebuild","title":"Website rebuild","domain_key":"career","due_date":"in 60 days","source_link":"https://example.com/x"},
    {"text":"Waiting on the client's brand assets","destination":"dependency","confidence":"high","why":"Blocked on someone outside.","group":"website_rebuild","owner":"the client"},
    {"text":"Draft the sitemap","destination":"task","confidence":"high","why":"Named as the next action.","group":"website_rebuild","due_date":"in 3 days","time_minutes":60}
  ]

Other rules:
- Do not turn the assistant's own questions back to the user into tasks, and do not file options that were only floated.
- "text" is a short self-contained statement of the item, never a quote of the whole exchange. Strip markdown asterisks and label prefixes like "Project:" or "Next action:".
- Labels the assistant used for the project as a whole — its domain, status, energy, repo link — are FIELDS on the project item, never separate records, and never "knowledge". Knowledge is a durable fact about the person, not a property of a job.
- A repository or document URL goes in "source_link" on the project.
- Relative dates are fine — write "in 5 days" or "in 102 days" and they are resolved later.
- Effort is in WORKING time: "a day of work" is about 6 hours (360 minutes), not 24.
- Return an empty array only when the conversation genuinely produced nothing to record.`;

/**
 * Extract what a conversation actually agreed on. **Writes nothing.**
 *
 * Exists because the chat backend has no tools and never will — it can describe
 * a perfectly good filing plan and then do nothing with it, which is exactly
 * what it did. Rather than giving the conversation write access (constraint 8),
 * the conversation hands its conclusions to the same review screen everything
 * else goes through.
 */
export async function routeConversation({ limit = 16 } = {}) {
  const history = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE role IN ('user', 'assistant')
     ORDER BY id DESC LIMIT ?`
  ).all(limit).reverse();

  if (!history.length) {
    return { items: [], degraded: false, source: null, fragments: 0, from: 'conversation' };
  }

  const transcript = history
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
    .join('\n\n');

  return classify(CONVERSATION_SYSTEM, transcript, {
    from: 'conversation',
    ctx: routingContext(),
  });
}

/**
 * Classify a dump. **Writes nothing.** Returns a proposal for review.
 */
export async function routeCapture(text) {
  const fragments = splitFragments(text);
  if (!fragments.length) {
    return { items: [], degraded: false, source: null, fragments: 0 };
  }

  return classify(ROUTER_SYSTEM, fragments.map((f, i) => `${i + 1}. ${f}`).join('\n'), {
    from: 'dump',
    ctx: routingContext(),
    anchors: fragments.map((f) => ({ text: f, rule: preClassify(f) })),
  });
}

/**
 * Shared classification. Two modes:
 *
 *  - `anchors` given (a dump): every fragment produces exactly one item, so
 *    nothing the user typed can be dropped by a model that decided to merge
 *    two lines.
 *  - no anchors (a conversation): the model decides how many records the
 *    exchange actually produced, because a twenty-turn conversation is not
 *    twenty items.
 */
async function classify(system, user, { from, anchors = null, ctx = EMPTY_CONTEXT }) {
  let modelItems = null;
  let source = null;
  let model = null;
  let partial = false;

  try {
    const result = await oneShotJson({
      system: system + contextBlock(ctx) + examplesBlock(),
      user,
      maxTokens: 2000,
      timeoutMs: 300_000,
      schema: routeSchema(ctx),
    });
    const unwrapped = unwrapItems(result.json)?.map(cleanKeys);
    // The raw rows, because the failure mode worth catching here is a response
    // that parses and is still wrong — an item silently absorbed into a
    // malformed key looks, from every other vantage point, like the model
    // simply not returning it.
    if (process.env.POS_DEBUG_ROUTER) console.error('[router] raw:', JSON.stringify(unwrapped));
    if (unwrapped) {
      modelItems = unwrapped;
      source = result.source;
      model = result.model;
    }
  } catch (err) {
    // A response that stopped being JSON halfway is usually most of a good
    // answer. Keeping the complete records beats sending the whole batch to
    // rules, where every fragment the user typed comes back "unclear".
    const rescued = salvageItems(err.rawText);
    if (rescued.length) {
      modelItems = rescued.map(cleanKeys);
      partial = true;
      console.error(`[router] response broke mid-way, kept ${rescued.length} complete item(s):`, err.message);
    } else {
      console.error('[router] classification failed, falling back to rules:', err.message);
    }
  }

  const items = anchors
    ? anchors.map(({ text, rule }, i) =>
        buildItem(text, rule, pickModelItem(modelItems, text, i), ctx))
    : (modelItems || [])
        .map((m) => buildItem(String(m?.text || '').trim(), preClassify(m?.text || ''), m, ctx))
        .filter((it) => it.text);

  return {
    items: items.sort((a, b) => BLAST_RADIUS[b.destination] - BLAST_RADIUS[a.destination]),
    degraded: !modelItems,
    // Some of the answer was unreadable. Not the same as degraded: what is here
    // is real, and what is missing fell back to rules item by item.
    partial,
    source, model,
    fragments: items.length,
    from,
    // The review screen needs these to offer a link the router did not make,
    // and to name the one it did.
    context: {
      projects: ctx.projects.map(({ id, name }) => ({ id, name })),
      commitments: ctx.commitments.map(({ id, name }) => ({ id, name })),
    },
  };
}

/**
 * Trim the punctuation a model sometimes leaves on its own keys.
 *
 * Observed: `"due_date:"` and `"due_date "` instead of `"due_date"`, on a
 * response that is otherwise perfect and parses cleanly. The field is then
 * simply not there — and on a commitment that means no deadline, which means
 * no slack, which means the one thing Tier 0 exists for never fires. Nothing
 * anywhere reports a problem. Cheap to defend against, expensive to notice.
 */
export function cleanKeys(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[String(k).trim().replace(/:+$/, '')] = v;
  return out;
}

/**
 * Match a model row to its fragment. Positional first, because the prompt is
 * numbered, but fall back to text match — a small model will occasionally drop
 * or merge a line, and a positional-only match would then attach every
 * subsequent classification to the wrong fragment. Silently.
 */
function pickModelItem(modelItems, fragment, i) {
  if (!Array.isArray(modelItems)) return null;
  const byText = modelItems.find(
    (m) => m?.text && norm(m.text) === norm(fragment));
  if (byText) return byText;
  const at = modelItems[i];
  if (at && (!at.text || norm(at.text) === norm(fragment))) return at;
  return null;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function buildItem(fragment, rule, m, ctx = EMPTY_CONTEXT) {
  const modelDest = m && DESTINATIONS.includes(m.destination) ? m.destination : null;

  // No model opinion → the rule, or an honest "unclear".
  let destination = modelDest || rule?.destination || 'unclear';
  let confidence = modelDest ? (m.confidence || 'medium') : (rule ? 'medium' : 'low');
  let why = modelDest ? (m.why || '') : (rule?.why || 'Could not tell where this belongs.');

  // Rule and model disagree — keep the model's pick but drop confidence and say
  // so. This is the case most worth a human eye, so it must not look settled.
  const disagreement = modelDest && rule && rule.destination !== modelDest
    ? `A rule read this as ${rule.destination}.`
    : null;
  if (disagreement) confidence = 'low';

  const fields = enrichment(m, ctx);

  // Linking to something that already exists. `existing_id` is resolved against
  // the pool for the destination the item actually landed on, so a commitment
  // reference cannot end up updating a project.
  const pool = destination === 'commitment' ? ctx.commitments
             : destination === 'project' ? ctx.projects
             : null;
  const linked = resolveRef(pool, m?.existing_id);

  // The model missing a duplicate and the word-overlap check missing one are
  // different failures, so both run. Neither decides: a match the model did not
  // make is offered on the review screen and left unset.
  let duplicate = null;
  if (linked) {
    duplicate = { id: linked.id, name: linked.name, by: 'model' };
    fields.existing_id = linked.id;
  } else {
    delete fields.existing_id;
    // Projects as well as commitments: a fragment the model reads as a project
    // that already exists otherwise becomes a second copy of it, and the work
    // then splits across two containers that never appear together.
    const near = nearestMatch(pool, fields.title || fragment);
    if (near) duplicate = { id: near.id, name: near.name, score: near.score, by: 'match' };
  }

  // A date the scorer cannot read is worse than no date: it looks set, and it
  // silently contributes nothing to slack. Say so rather than storing it quietly.
  const dateWarning = fields.due_date && !parseDateLoose(fields.due_date)
    ? `"${fields.due_date}" is not a date the scorer can read — deadline pressure will not be calculated.`
    : null;

  return {
    text: fragment,
    destination,
    proposed: destination,          // remembered so a change at review is a correction
    confidence,
    why,
    disagreement,
    dateWarning,
    duplicate,
    blast: BLAST_RADIUS[destination] ?? 0,
    fields,
  };
}

function enrichment(m, ctx = EMPTY_CONTEXT) {
  if (!m) return {};
  const out = {};
  for (const k of ['title', 'due_date', 'waiting_party', 'owner', 'source_link',
                   'group', 'project_id', 'existing_id', 'time_minutes',
                   'effort_remaining_minutes', 'importance', 'commitment_type',
                   'income_impact', 'restorative', 'energy_required',
                   'domain_key', 'category']) {
    if (m[k] !== undefined && m[k] !== null && m[k] !== '') out[k] = m[k];
  }
  if (out.due_date) out.due_date = normalizeDate(out.due_date) ?? out.due_date;

  // A reference the prompt handed out, turned back into a real id. An invented
  // one resolves to nothing and is dropped — same reasoning as `validDomain`:
  // a link that points nowhere makes the item look filed when it is orphaned.
  const project = resolveRef(ctx.projects, out.project_id);
  if (project) out.project_id = project.id; else delete out.project_id;

  out.domain_key = validDomain(out.domain_key);
  if (!out.domain_key) delete out.domain_key;
  return out;
}

/**
 * A domain key the app actually has, or nothing.
 *
 * A model asked for a domain will happily answer `"career/contribution"` when
 * the conversation mentioned both. That is not a key — it matches no row in
 * `life_domains`, so the item shows no badge, is missing from every domain
 * rollup, and looks simply *absent* rather than wrong. Storing a near-miss is
 * worse than storing nothing, because nothing is visibly nothing.
 *
 * Accepts an exact key, or the first known key in a compound answer.
 */
function validDomain(value) {
  if (!value) return null;
  const keys = domainKeys();
  const s = String(value).trim().toLowerCase();
  if (keys.includes(s)) return s;
  for (const part of s.split(/[^a-z_]+/).filter(Boolean)) {
    if (keys.includes(part)) return part;
  }
  return null;
}

let domainKeyCache = null;
function domainKeys() {
  if (!domainKeyCache) {
    domainKeyCache = db.prepare('SELECT key FROM life_domains').all().map((d) => d.key);
  }
  return domainKeyCache;
}

// ---------------------------------------------------------------------------
// Relative dates
// ---------------------------------------------------------------------------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday',
                  'thursday', 'friday', 'saturday'];

/**
 * Turn what a person actually says into a date the scorer can use.
 *
 * This is not cosmetic. A model echoes the user's own words, so "by Friday"
 * arrives as the literal string "Friday" — which `parseDateLoose` cannot read,
 * so `slackFor` returns null, so a three-day job due Friday carries **no
 * deadline pressure at all**. No error, no warning, and the one scenario Tier 0
 * exists for silently never fires. Normalising here is what keeps that from
 * happening.
 *
 * Returns YYYY-MM-DD, or null when the text genuinely isn't a date.
 */
export function normalizeDate(value, now = new Date()) {
  if (!value) return null;
  const s = String(value).trim().toLowerCase().replace(/^(by|before|on|due)\s+/, '');
  if (!s) return null;

  // Already a real date — let the existing tolerant parser own it.
  const direct = parseDateLoose(s);
  if (direct) return iso(direct);

  const at = (days) => iso(addDays(now, days));

  if (/^(today|tonight|end of (the )?day|eod)$/.test(s)) return at(0);
  if (/^tomorrow$/.test(s)) return at(1);
  if (/^(day after tomorrow)$/.test(s)) return at(2);
  if (/^yesterday$/.test(s)) return at(-1);

  let m = s.match(/^in (\d+) (day|week)s?$/);
  if (m) return at(+m[1] * (m[2] === 'week' ? 7 : 1));

  if (/^next week$/.test(s)) return at(7);
  if (/^this week$/.test(s)) return iso(nextWeekday(now, 5, true));   // Friday
  if (/^end of (the )?week$/.test(s)) return iso(nextWeekday(now, 5, true));
  if (/^end of (the )?month$/.test(s)) {
    return iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }
  if (/^next month$/.test(s)) return at(30);

  // "friday", "next friday", "this friday"
  m = s.match(/^(next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    // "by Friday" said on a Friday means today, not a week away. "next Friday"
    // always means the following week.
    const d = nextWeekday(now, target, m[1]?.trim() !== 'next');
    return iso(m[1]?.trim() === 'next' && sameDay(d, now) ? addDays(d, 7) : d);
  }

  return null;
}

function nextWeekday(now, target, includeToday) {
  const cur = now.getDay();
  let delta = (target - cur + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(now, delta);
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ---------------------------------------------------------------------------
// Commit — the only thing here that writes
// ---------------------------------------------------------------------------

const IMPORTANCE_RANK = { critical: 1, high: 2, medium: 3, low: 4, someday: 5 };

/**
 * Write an accepted batch. Every row is logged to `event_log`, so what entered
 * the system is inspectable afterwards even though it was confirmed up front.
 *
 * Items with `skip: true` are dropped. Anything whose destination was changed
 * at review is recorded as a routing correction.
 */
export function commitRoutes(items = []) {
  const written = [];
  const errors = [];

  const live = items.filter((i) => i && !i.skip)
    .map((i) => ({ ...i, destination: DESTINATIONS.includes(i.destination) ? i.destination : 'unclear' }));

  // Projects go first so the things that belong to them have an id to point at.
  // Without this a conversation that produced "a project, its next action, and
  // what it is waiting on" files three orphans that never appear together
  // again — which is most of the value of having routed it as one thing.
  const ordered = [
    ...live.filter((i) => i.destination === 'project'),
    ...live.filter((i) => i.destination !== 'project'),
  ];

  const projectByGroup = {};

  db.exec('BEGIN');
  try {
    for (const item of ordered) {
      recordCorrection(item.text, item.proposed, item.destination);
      try {
        const row = writeOne(item.destination, item, projectByGroup);
        if (item.destination === 'project' && item.fields?.group) {
          projectByGroup[item.fields.group] = row.id;
        }
        written.push(row);
      } catch (err) {
        errors.push({ text: item.text, destination: item.destination, error: err.message });
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { written, errors, count: written.length };
}

function writeOne(dest, item, projectByGroup = {}) {
  const f = item.fields || {};
  const text = item.text;
  const title = (f.title || text).toString().slice(0, 300);
  // An explicit existing project wins; otherwise fall back to one created
  // earlier in this same batch under the same group. Checked against the table
  // here and not only at classification time, for the same reason as the domain
  // key below: the review screen can edit this field, and this is the last gate.
  // A project_id that matches no row leaves the item looking filed while it is
  // orphaned — worse than no link, because nothing looks wrong.
  const projectId = existingId('projects', f.project_id) || projectByGroup[f.group] || '';
  // Validated here and not only at classification time: the review screen lets
  // fields be edited, and this function is the only thing that writes.
  const domainKey = validDomain(f.domain_key) || '';

  switch (dest) {
    case 'task': {
      const row = addTask({
        title,
        notes: title === text ? '' : text,
        project_id: projectId || null,
        domain_key: domainKey || null,
        strategic_importance: IMPORTANCE_RANK[f.importance] ?? 3,
        time_minutes: f.time_minutes ?? null,
        effort_remaining_minutes: f.effort_remaining_minutes ?? null,
        due_date: f.due_date || null,
        income_impact: f.income_impact ?? 0,
        restorative: f.restorative ?? 0,
        energy_required: f.energy_required ?? 3,
        commitment_type: f.commitment_type || 'personal',
        rationale: item.why || '',
      });
      logEvent('task', String(row.id), 'routed_from_capture', text.slice(0, 200));
      return { destination: dest, id: row.id, title: row.title };
    }

    case 'commitment': {
      // The same promise captured twice must not become two obligations. Two
      // rows for one deadline is not a cosmetic duplicate: Tier 0 reads both,
      // so one delivery clears half the pressure and the ranker keeps insisting.
      const prior = existingId('commitments', f.existing_id);
      if (prior) {
        const patch = { latest_update: text };
        if (f.due_date) patch.external_deadline = f.due_date;
        if (f.waiting_party) patch.waiting_party = f.waiting_party;
        if (f.effort_remaining_minutes != null) patch.effort_remaining_minutes = f.effort_remaining_minutes;
        if (f.commitment_type) patch.commitment_type = f.commitment_type;
        if (projectId) patch.project_id = projectId;
        const updated = updateEntity('commitments', prior, patch);
        logEvent('commitments', prior, 'updated_from_capture', text.slice(0, 200));
        return { destination: dest, id: updated.id, title: updated.description, updated: true };
      }

      const row = createEntity('commitments', {
        description: title,
        project_id: projectId || '',
        waiting_party: f.waiting_party || '',
        external_deadline: f.due_date || '',
        commitment_type: f.commitment_type || 'contracted',
        income_impact: f.income_impact ?? 3,
        effort_remaining_minutes: f.effort_remaining_minutes ?? null,
        latest_update: text,
      });
      return { destination: dest, id: row.id, title: row.description };
    }

    case 'project': {
      const prior = existingId('projects', f.existing_id);
      if (prior) {
        const patch = { latest_context: text };
        if (f.due_date) patch.deadline = f.due_date;
        if (domainKey) patch.domain_key = domainKey;
        if (f.source_link) patch.source_links = f.source_link;
        const updated = updateEntity('projects', prior, patch);
        logEvent('projects', prior, 'updated_from_capture', text.slice(0, 200));
        return { destination: dest, id: updated.id, title: updated.name, updated: true };
      }

      const row = createEntity('projects', {
        name: title,
        purpose: text,
        domain_key: domainKey,
        income_impact: f.income_impact ?? 0,
        deadline: f.due_date || '',
        source_links: f.source_link || '',
      });
      return { destination: dest, id: row.id, title: row.name };
    }

    case 'dependency': {
      const row = createEntity('dependencies', {
        dependency: title,
        project_id: projectId || '',
        owner: f.owner || f.waiting_party || '',
        expected_date: f.due_date || '',
        status: 'waiting',
      });
      return { destination: dest, id: row.id, title: row.dependency };
    }

    case 'idea': {
      const row = createEntity('ideas', {
        raw_capture: text,
        project_id: projectId || '',
        capture_source: 'router',
      });
      return { destination: dest, id: row.id, title: row.raw_capture };
    }

    case 'knowledge': {
      const row = addKnowledge({
        category: f.category || 'identity',
        content: text,
        confidence: item.confidence === 'high' ? 0.8 : item.confidence === 'low' ? 0.4 : 0.6,
        source: 'conversation',
      });
      logEvent('knowledge', String(row.id), 'routed_from_capture', text.slice(0, 200));
      return { destination: dest, id: row.id, title: row.content };
    }

    case 'open_question': {
      const row = addOpenQuestion({
        question: title,
        context: item.why || '',
        strategic_importance: IMPORTANCE_RANK[f.importance] ?? 3,
      });
      return { destination: dest, id: row.id, title: row.question };
    }

    case 'decision': {
      const row = addDecision({
        decision: title,
        reasoning: item.why || '',
        confidence: item.confidence === 'high' ? 0.8 : 0.6,
      });
      return { destination: dest, id: row.id, title: row.decision };
    }

    case 'health_signal': {
      const hours = parseSleepHours(text);
      const info = db.prepare(
        `INSERT INTO health_signals (date, sleep_hours, source, created_at)
         VALUES (?, ?, 'manual', ?)`
      ).run(new Date().toISOString().slice(0, 10), hours, now());
      return { destination: dest, id: info.lastInsertRowid, title: text };
    }

    default: {
      // Unclear stays unclear. This is the original behaviour, kept on purpose
      // for exactly the fragments that deserve it.
      const row = createEntity('inbox', {
        raw_content: text,
        source: 'web',
        classification_status: 'needs_review',
        context_note: item.why || '',
      });
      return { destination: 'unclear', id: row.id, title: row.raw_content };
    }
  }
}

/** The id, if a row with it actually exists. Never a value the model made up. */
function existingId(kind, id) {
  if (!id) return '';
  return getEntity(kind, String(id)) ? String(id) : '';
}

function parseSleepHours(text) {
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*(?:h\b|hrs?\b|hours?\b)/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}
