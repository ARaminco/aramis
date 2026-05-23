// `better-sqlite3` is a CJS module with a native binding. Electron's ESM loader
// has known issues wrapping such modules via `import default`; use createRequire
// instead — works under both plain Node and Electron.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'aramis.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'aramis',
    external_session_id TEXT,
    cwd TEXT,
    pinned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_call_id TEXT,
    name TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

  -- Long-term cross-chat memory the AI can write/read via remember/forget tools.
  -- 'kind' lets the assistant categorize entries (preference | fact | env | secret | note).
  CREATE TABLE IF NOT EXISTS memory (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'note',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind);
`);

// --- runtime migrations: keep existing DBs working ---
function safeAddColumn(table, decl) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`); }
  catch (e) { /* column probably already exists */ }
}
safeAddColumn('chats', "mode TEXT NOT NULL DEFAULT 'aramis'");
safeAddColumn('chats', "external_session_id TEXT");
safeAddColumn('chats', "cwd TEXT");
safeAddColumn('chats', "pinned INTEGER NOT NULL DEFAULT 0");

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, v, Date.now());
}

export function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ---------- memory ----------
const KIND_VALUES = new Set(['preference', 'fact', 'env', 'secret', 'note']);

export function listMemory() {
  return db.prepare('SELECT key, value, kind, created_at, updated_at FROM memory ORDER BY updated_at DESC').all();
}

export function getMemory(key) {
  return db.prepare('SELECT key, value, kind, created_at, updated_at FROM memory WHERE key = ?').get(key) || null;
}

export function setMemory(key, value, kind = 'note') {
  if (!key || typeof key !== 'string') throw new Error('memory key required');
  if (value == null) throw new Error('memory value required');
  const k = KIND_VALUES.has(kind) ? kind : 'note';
  const now = Date.now();
  db.prepare(`
    INSERT INTO memory (key, value, kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, kind = excluded.kind, updated_at = excluded.updated_at
  `).run(key, String(value), k, now, now);
}

export function deleteMemory(key) {
  return db.prepare('DELETE FROM memory WHERE key = ?').run(key).changes;
}

export function clearMemory() {
  return db.prepare('DELETE FROM memory').run().changes;
}

// ---------- stats / housekeeping ----------
export function getDbStats() {
  const chats = db.prepare('SELECT COUNT(*) AS c FROM chats').get().c;
  const messages = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  const memoryCount = db.prepare('SELECT COUNT(*) AS c FROM memory').get().c;
  const settingsCount = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  const pageSize = db.pragma('page_size', { simple: true });
  const pageCount = db.pragma('page_count', { simple: true });
  const sizeBytes = pageSize * pageCount;
  return {
    chats, messages, memory: memoryCount, settings: settingsCount,
    db_size_bytes: sizeBytes,
    db_path: DB_PATH,
  };
}

export function wipeUserData() {
  // Keep settings (password, AI config) but delete conversational data + memory.
  db.transaction(() => {
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM chats').run();
    db.prepare('DELETE FROM memory').run();
    // Also drop pending-ask sentinels.
    db.prepare("DELETE FROM settings WHERE key LIKE 'pending_ask:%'").run();
  })();
}

export const DB_FILE_PATH = DB_PATH;
