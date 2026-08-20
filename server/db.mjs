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

export const now = () => new Date().toISOString();
