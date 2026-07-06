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
`;

export function migrate() {
  db.exec(schema);
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
