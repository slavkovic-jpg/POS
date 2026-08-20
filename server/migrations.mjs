import { db, now } from './db.mjs';
import { pathToFileURL } from 'node:url';

const schema = `
-- Single-user profile / identity snapshot
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  bio TEXT,
  cv_raw TEXT,
  linkedin_url TEXT,
  onboarded_at TEXT,
  updated_at TEXT NOT NULL
);

-- Strategy scaffold: mission, values, identity, long-term vision (one row)
CREATE TABLE IF NOT EXISTS strategy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mission TEXT,
  values_json TEXT,      -- JSON array of values
  identity TEXT,
  long_term_vision TEXT,
  updated_at TEXT NOT NULL
);

-- Life domains (career / health / learning / relationships / finances / contribution / enjoyment / personal_dev)
CREATE TABLE IF NOT EXISTS life_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,           -- e.g. 'career'
  name TEXT NOT NULL,                 -- display name
  current_state TEXT,
  desired_state TEXT,
  priority INTEGER DEFAULT 3,         -- 1=highest 5=lowest
  confidence REAL DEFAULT 0.5,        -- 0..1
  constraints TEXT,
  updated_at TEXT NOT NULL
);

-- Personal knowledge model — evolving beliefs about the user w/ confidence
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,             -- identity|values|strengths|weaknesses|motivations|energy|habits|preferences|...
  content TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,        -- 0..1
  source TEXT,                        -- conversation|cv|discovery|inferred
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- (The memory table lived here. Created on day one for the spec's six memory
--  layers, never read or written by anything. Removed; the idea survives as
--  knowledge.layer. See droppedTables below.)

-- Open strategic questions the system must not forget
CREATE TABLE IF NOT EXISTS open_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting',  -- awaiting|exploring|resolved|dropped
  strategic_importance INTEGER DEFAULT 3,   -- 1=highest 5=lowest
  review_date TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Decision journal
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision TEXT NOT NULL,
  reasoning TEXT,
  expected_outcome TEXT,
  confidence REAL,                    -- 0..1 at time of decision
  followup_date TEXT,
  actual_outcome TEXT,                -- filled in later
  lessons TEXT,                       -- filled in later
  decided_at TEXT NOT NULL,
  reviewed_at TEXT
);

-- Tasks — scored, not just checkboxes
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT,
  domain_key TEXT,                            -- FK-ish to life_domains.key
  status TEXT NOT NULL DEFAULT 'open',        -- open|doing|done|deferred|dropped
  difficulty INTEGER,                         -- 1..5
  engagement INTEGER,                         -- 1..5
  satisfaction INTEGER,                       -- 1..5
  strategic_importance INTEGER,               -- 1..5
  energy_required INTEGER,                    -- 1..5
  anxiety_level INTEGER,                      -- 1..5
  time_minutes INTEGER,
  learning_value INTEGER,                     -- 1..5
  deferred_count INTEGER DEFAULT 0,           -- for procrastination analysis
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

-- Morning briefings
CREATE TABLE IF NOT EXISTS briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,                  -- YYYY-MM-DD
  stages_json TEXT,                           -- JSON: urgencies/energy/constraints/priorities/risks/accepted
  confidence REAL DEFAULT 0,                  -- 0..1
  plan TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

-- Weekly + monthly reviews
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                          -- weekly|monthly
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  achievements TEXT,
  failures TEXT,
  lessons TEXT,
  energy_notes TEXT,
  burnout_indicators TEXT,
  next_period_recommendations TEXT,
  created_at TEXT NOT NULL
);

-- Chat messages (conversation is the primary interface)
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,                          -- user|assistant|system
  content TEXT NOT NULL,
  meta TEXT,                                   -- JSON: intent, extracted entities, etc.
  created_at TEXT NOT NULL
);

-- Health signal snapshots (for future wearable integration)
CREATE TABLE IF NOT EXISTS health_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  sleep_hours REAL,
  hrv REAL,
  resting_hr INTEGER,
  activity_minutes INTEGER,
  stress_score REAL,
  recovery_score REAL,
  source TEXT,                                 -- apple_watch|garmin|manual|...
  created_at TEXT NOT NULL
);

-- Micro sub-steps for a task. The anti-procrastination lever: a task that
-- feels immovable gets broken into 5-minute steps you can start without
-- deciding anything.
CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  est_minutes INTEGER,
  done INTEGER NOT NULL DEFAULT 0,             -- 0|1
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

-- Current conditions. Answers "what is realistic right now?" — the input the
-- planner was missing. One row per day; updated as conditions change.
CREATE TABLE IF NOT EXISTS daily_context (
  date TEXT PRIMARY KEY,                       -- YYYY-MM-DD
  energy_state TEXT NOT NULL DEFAULT 'medium', -- peak|medium|low|overwhelmed
  available_minutes INTEGER NOT NULL DEFAULT 30,
  note TEXT,
  updated_at TEXT NOT NULL
);

-- ===========================================================================
-- Adopted from ExecAgent (Apps Script + Sheets), which this app absorbs.
--
-- These keep ExecAgent's TEXT ids (inb_…, prj_…, cmt_…) rather than the
-- INTEGER ids the original POS tables use. That is deliberate: the id IS the
-- idempotency key for the migration, so importing the same export twice can
-- never duplicate a row. Mixed id types across tables is a small ugliness
-- worth paying for a re-runnable import.
-- ===========================================================================

-- Where async capture lands before a human decides what it is. The voice
-- channel writes here; nothing becomes a task without being promoted.
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,                         -- inb_YYYYMMDD-HHMMSS-xxxx
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',          -- web|voice|email|import|manual
  raw_content TEXT NOT NULL,                   -- immutable: the original words
  context_note TEXT,                           -- edits go here, never to raw_content
  processing_status TEXT NOT NULL DEFAULT 'new',        -- new|in_progress|parked|done|error
  classification_status TEXT NOT NULL DEFAULT 'unclassified',
  error_state TEXT,
  attachment_url TEXT,
  external_ref TEXT,                           -- gtask_<googleTaskId>; dedupe key
  promoted_to_type TEXT,
  promoted_to_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_external ON inbox(external_ref)
  WHERE external_ref IS NOT NULL AND external_ref <> '';
CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(processing_status);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                         -- prj_…
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT,
  desired_outcome TEXT,
  current_state TEXT,
  status TEXT NOT NULL DEFAULT 'active',       -- active|paused|waiting|blocked|archived|completed
  importance TEXT DEFAULT 'medium',            -- low|medium|high
  urgency TEXT DEFAULT 'medium',
  energy_profile TEXT,                         -- deep|finishing|routine|communication|exploration|small
  next_outcome TEXT,
  last_activity_at TEXT,
  next_review_date TEXT,
  deadline TEXT,
  domain_key TEXT,                             -- POS addition: ties a project to a life domain
  income_impact INTEGER DEFAULT 0,             -- POS addition: 0-5
  source_links TEXT,
  latest_context TEXT,
  pause_reason TEXT,
  inbox_id TEXT
);

-- Promises to other people. The layer the whole weighting engine hangs off:
-- an income commitment you cannot deliver is the one thing that outranks
-- everything else, including rest.
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,                         -- cmt_…
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  description TEXT NOT NULL,
  project_id TEXT,
  waiting_party TEXT,
  promised_result TEXT,
  external_deadline TEXT,                      -- what they expect
  internal_target TEXT,                        -- what you set, so prep starts before the warning
  status TEXT NOT NULL DEFAULT 'open',         -- open|in_progress|delivered|renegotiated|at_risk|dropped
  consequence TEXT,
  commitment_type TEXT DEFAULT 'contracted',   -- POS: contracted|speculative|personal|restorative
  income_impact INTEGER DEFAULT 0,             -- POS: 0-5
  effort_remaining_minutes INTEGER,            -- POS: what makes slack computable
  source_link TEXT,
  latest_update TEXT,
  postpone_count INTEGER NOT NULL DEFAULT 0,
  inbox_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,                         -- idea_…
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_capture TEXT NOT NULL,                   -- immutable
  expanded_context TEXT,
  trigger_origin TEXT,
  project_id TEXT,
  possible_value TEXT,
  suggested_experiment TEXT,
  status TEXT NOT NULL DEFAULT 'captured',     -- captured|expanded|linked|acting|parked|realised|ruled_out
  capture_source TEXT,
  attachments TEXT,
  inbox_id TEXT
);

-- Why work stalls. Invisible in the old POS, and therefore never accounted for.
CREATE TABLE IF NOT EXISTS dependencies (
  id TEXT PRIMARY KEY,                         -- dep_…
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dependency TEXT NOT NULL,
  project_id TEXT,
  owner TEXT,
  decision_authority TEXT,
  expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',      -- waiting|chasing|resolved|abandoned
  downstream_effects TEXT,
  follow_up_action TEXT,
  risk_level TEXT DEFAULT 'medium'             -- low|medium|high
);

-- Resume points. Restarting is the expensive part, so a session that recorded
-- a way back in makes its task cheaper to pick up — and the scorer knows it.
CREATE TABLE IF NOT EXISTS work_sessions (
  id TEXT PRIMARY KEY,                         -- ses_…
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  project_id TEXT,
  task_id INTEGER,                             -- POS tasks.id (was action_id)
  action_ref TEXT,                             -- original ExecAgent act_… if imported
  started_at TEXT,
  stopped_at TEXT,                             -- empty means "current"; no status column to drift
  latest_progress TEXT,
  current_state TEXT,
  resume_point TEXT,
  unresolved_thought TEXT,
  pause_reason TEXT,
  next_capacity TEXT,
  title TEXT,
  end_reason TEXT,                             -- paused|switched|done|day_end|interrupted
  return_to_session_id TEXT,
  switch_trigger TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON work_sessions(task_id);

-- Append-only. Also the substrate for burnout detection (when things happen,
-- not just what happened).
CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,                         -- evt_…
  at TEXT NOT NULL,
  actor TEXT,
  entity_type TEXT,
  entity_id TEXT,
  event TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_at ON event_log(at);

-- Tunable scoring weights. Defaults are a starting point, not a claim —
-- weights that cannot be tuned will be wrong for one specific person.
CREATE TABLE IF NOT EXISTS weights (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// Tables that existed and earned their removal.
const droppedTables = [
  // Created day one for the spec's "six memory layers", never read or written
  // by any module, endpoint or query. The idea survives as knowledge.layer —
  // one store with a facet beats two stores where one is permanently empty.
  'memory',
];

// Columns added after the initial schema. SQLite has no "ADD COLUMN IF NOT
// EXISTS", so check the table info first — this must stay idempotent.
const addedColumns = [
  ['tasks', 'rationale', 'TEXT'],       // one-line "why this matters right now"
  ['tasks', 'grounding_json', 'TEXT'],  // cached web research: summary + sources

  // --- Merged in from ExecAgent's Actions -----------------------------------
  ['tasks', 'project_id', 'TEXT'],
  ['tasks', 'action_type', 'TEXT'],           // deep_work|finishing|routine|communication|exploration|small
  ['tasks', 'definition_of_done', 'TEXT'],
  ['tasks', 'blocked_by', 'TEXT'],            // dependencies.id
  ['tasks', 'source_ref', 'TEXT'],            // original act_… — the import's idempotency key

  // --- The four dimensions the weighting engine was missing -----------------
  ['tasks', 'income_impact', 'INTEGER DEFAULT 0'],       // 0-5: generates or protects income
  ['tasks', 'commitment_type', "TEXT DEFAULT 'personal'"], // contracted|speculative|personal|restorative
  ['tasks', 'effort_remaining_minutes', 'INTEGER'],      // work left across sessions, vs time_minutes = one sitting
  ['tasks', 'restorative', 'INTEGER DEFAULT 0'],         // 0-5: does doing this put energy back

  // Six memory layers, folded into the store that is actually used.
  ['knowledge', 'layer', "TEXT DEFAULT 'personal'"],     // temporary|operational|strategic|behavioral|personal|decision
];

// `satisfaction` already exists on tasks and has never been read by anything.
// From here it means FULFILMENT — how much doing this feeds you, which the
// occupational-therapy rule depends on. Reused rather than added.

/** Default scoring weights, inserted once. Editable afterwards via the UI. */
const DEFAULT_WEIGHTS = {
  // Ported from ExecAgent's WEIGHTS — proven in use, keep the calibration.
  commitmentOverdue: 100, commitmentDue3: 70, commitmentDue7: 45, commitmentDue14: 25,
  deadlineOverdue: 80, deadlineDue3: 55, deadlineDue7: 35, deadlineDue14: 18,
  importanceHigh: 15, importanceMedium: 7,
  urgencyHigh: 12, urgencyMedium: 5,
  staleProject: 12,
  capacityMatch: 30, capacityMismatch: -15,
  quickWin: 8, quickWinWhenSmall: 25,
  dependencyRisk: 10, repeatedlyCarried: 10,
  inProgress: 14, resumeAvailable: 22,

  // New: the dimensions ExecAgent had no concept of.
  income: 14,            // per point of income_impact
  restorative: 8,        // per point of restorative, scaled by burnout
  fulfilment: 5,         // per point of satisfaction, scaled by therapy gain
  therapyBonus: 35,      // small fulfilling work when depleted and income is safe
  slackCritical: 150,    // cannot be delivered even working flat out
  slackAtRisk: 60,
  slackTight: 25,
  nonIncomeSuppression: 0.25,  // multiplier when income is at risk
};

function applyColumnAdditions() {
  for (const [table, column, type] of addedColumns) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[migrate] added ${table}.${column}`);
  }
}

export function migrate() {
  db.exec(schema);
  applyColumnAdditions();
  dropRetiredTables();
  seedLifeDomains();
  seedStrategyRow();
  seedProfileRow();
  seedWeights();
  console.log('[migrate] schema up to date');
}

function dropRetiredTables() {
  for (const table of droppedTables) {
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table);
    if (!exists) continue;
    // Refuse to drop anything holding data. If a table earned rows since it
    // was written off, that is new information and a human should look.
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    if (n > 0) {
      console.warn(`[migrate] keeping '${table}': marked for removal but holds ${n} row(s)`);
      continue;
    }
    db.exec(`DROP TABLE ${table}`);
    console.log(`[migrate] dropped unused table '${table}'`);
  }
}

function seedWeights() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO weights (key, value, updated_at) VALUES (?, ?, ?)'
  );
  const t = now();
  for (const [key, value] of Object.entries(DEFAULT_WEIGHTS)) insert.run(key, value, t);
}

function seedLifeDomains() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM life_domains').get().n;
  if (existing > 0) return;
  const seed = [
    ['career', 'Career'],
    ['health', 'Health'],
    ['learning', 'Learning'],
    ['relationships', 'Relationships'],
    ['finances', 'Finances'],
    ['contribution', 'Contribution'],
    ['enjoyment', 'Enjoyment'],
    ['personal_dev', 'Personal Development'],
  ];
  const insert = db.prepare(
    'INSERT INTO life_domains (key, name, updated_at) VALUES (?, ?, ?)'
  );
  const t = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const r of seed) insert.run(r[0], r[1], t);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedStrategyRow() {
  const exists = db.prepare('SELECT id FROM strategy WHERE id = 1').get();
  if (!exists) {
    db.prepare(
      'INSERT INTO strategy (id, values_json, updated_at) VALUES (1, ?, ?)'
    ).run('[]', now());
  }
}

function seedProfileRow() {
  const exists = db.prepare('SELECT id FROM user_profile WHERE id = 1').get();
  if (!exists) {
    db.prepare('INSERT INTO user_profile (id, updated_at) VALUES (1, ?)').run(now());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate();
}
