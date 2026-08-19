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

-- Six memory layers
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layer TEXT NOT NULL,                -- temporary|operational|strategic|behavioral|personal|decision
  content TEXT NOT NULL,
  tags TEXT,                          -- comma-separated
  expires_at TEXT,                    -- for temporary memory
  created_at TEXT NOT NULL
);

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
`;

// Columns added after the initial schema. SQLite has no "ADD COLUMN IF NOT
// EXISTS", so check the table info first — this must stay idempotent.
const addedColumns = [
  ['tasks', 'rationale', 'TEXT'],   // one-line "why this matters right now"
];

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
  seedLifeDomains();
  seedStrategyRow();
  seedProfileRow();
  console.log('[migrate] schema up to date');
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
