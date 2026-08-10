import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

let db: DatabaseSync | null = null

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    provider_session_id TEXT,
    cwd TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'default',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport_json TEXT NOT NULL,
    enabled_by_default INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE TABLE IF NOT EXISTS conversation_mcp (
    conversation_id TEXT NOT NULL,
    mcp_server_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (conversation_id, mcp_server_id)
  );
  CREATE TABLE IF NOT EXISTS permission_rules (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    behavior TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS bus_messages (
    message_id TEXT PRIMARY KEY,
    from_conversation_id TEXT NOT NULL,
    to_conversation_id TEXT NOT NULL,
    in_reply_to TEXT,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS transcript_cache (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    event_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_transcript_conv ON transcript_cache (conversation_id, seq);
  `,
  `
  ALTER TABLE conversations ADD COLUMN persona_name TEXT;
  ALTER TABLE conversations ADD COLUMN persona_prompt TEXT;
  `,
  `
  ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'single';
  ALTER TABLE conversations ADD COLUMN group_id TEXT;
  CREATE TABLE IF NOT EXISTS group_member_state (
    member_id TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cadence_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at INTEGER NOT NULL,
    last_run_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS spend (
    day TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (day, conversation_id)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS watchers (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_state TEXT,
    created_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE conversations ADD COLUMN fork_pending INTEGER NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE conversations ADD COLUMN auto_verify INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    schedule_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    progress TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    conversation_id TEXT
  );
  CREATE TABLE IF NOT EXISTS fed_peers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    added_at INTEGER NOT NULL
  );
  `
]

export function getDb(): DatabaseSync {
  if (db) return db
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(join(dir, 'chimera.db'))
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);')
  const row = db.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined
  let version = row?.version ?? 0
  while (version < MIGRATIONS.length) {
    db.exec(MIGRATIONS[version])
    version++
  }
  db.exec('DELETE FROM schema_version;')
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
  return db
}
