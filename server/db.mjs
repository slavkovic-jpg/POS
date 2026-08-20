import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// POS_DATA_DIR lets tests point at a scratch directory. Without it a test that
// exercises the persistence layer writes into the real database — which is the
// user's actual life, not a fixture.
const DATA_DIR = process.env.POS_DATA_DIR
  ? path.resolve(process.env.POS_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'pos.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// SQLite's default busy timeout is zero: any momentary contention throws
// "database is locked" immediately instead of waiting. That happens routinely
// here — `node --watch` starts the replacement process before the old one has
// released the file, so every restart was a coin flip. Five seconds is far
// longer than any writer in this app holds a lock, so a real deadlock still
// surfaces rather than hanging forever.
db.exec('PRAGMA busy_timeout = 5000');

export const now = () => new Date().toISOString();
