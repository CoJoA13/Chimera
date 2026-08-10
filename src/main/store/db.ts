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
