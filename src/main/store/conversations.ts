import { randomUUID } from 'node:crypto'
import type { ConversationRecord } from '../../shared/config-types'
import type { ProviderId } from '../../shared/models'
import { getDb } from './db'

interface Row {
  id: string
  title: string
  provider: string
  model: string
  provider_session_id: string | null
  cwd: string | null
  permission_mode: string
  created_at: number
  updated_at: number
}

function toRecord(row: Row): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider as ProviderId,
    model: row.model,
    providerSessionId: row.provider_session_id,
    cwd: row.cwd,
    permissionMode: row.permission_mode as ConversationRecord['permissionMode'],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listConversations(): ConversationRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM conversations WHERE archived = 0 ORDER BY updated_at DESC')
    .all() as unknown as Row[]
  return rows.map(toRecord)
}

export function getConversation(id: string): ConversationRecord | null {
  const row = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | Row
    | undefined
  return row ? toRecord(row) : null
}

export function createConversation(provider: ProviderId, model: string): ConversationRecord {
  const now = Date.now()
  const record: ConversationRecord = {
    id: randomUUID(),
    title: 'New conversation',
    provider,
    model,
    providerSessionId: null,
    cwd: null,
    permissionMode: 'default',
    createdAt: now,
    updatedAt: now
  }
  getDb()
    .prepare(
      `INSERT INTO conversations (id, title, provider, model, provider_session_id, cwd, permission_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.title,
      record.provider,
      record.model,
      null,
      null,
      record.permissionMode,
      now,
      now
    )
  // Seed per-conversation MCP state from defaults.
  getDb()
    .prepare(
      `INSERT INTO conversation_mcp (conversation_id, mcp_server_id, enabled)
       SELECT ?, id, enabled_by_default FROM mcp_servers`
    )
    .run(record.id)
  return record
}

export function renameConversation(id: string, title: string): void {
  getDb()
    .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, Date.now(), id)
}

export function touchConversation(id: string): void {
  getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function setProviderSessionId(id: string, providerSessionId: string): void {
  getDb()
    .prepare('UPDATE conversations SET provider_session_id = ? WHERE id = ?')
    .run(providerSessionId, id)
}

export function setConversationModel(id: string, model: string): void {
  getDb().prepare('UPDATE conversations SET model = ? WHERE id = ?').run(model, id)
}

export function setConversationCwd(id: string, cwd: string): void {
  getDb().prepare('UPDATE conversations SET cwd = ? WHERE id = ?').run(cwd, id)
}

export function setConversationPermissionMode(
  id: string,
  mode: ConversationRecord['permissionMode']
): void {
  getDb().prepare('UPDATE conversations SET permission_mode = ? WHERE id = ?').run(mode, id)
}

export function deleteConversation(id: string): void {
  getDb().prepare('UPDATE conversations SET archived = 1 WHERE id = ?').run(id)
}
