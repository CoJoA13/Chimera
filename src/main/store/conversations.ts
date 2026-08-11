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
  persona_name: string | null
  persona_prompt: string | null
  kind: string
  group_id: string | null
  fork_pending: number
  auto_verify: number
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
    personaName: row.persona_name,
    personaPrompt: row.persona_prompt,
    kind: (row.kind as ConversationRecord['kind']) ?? 'single',
    groupId: row.group_id,
    forkPending: row.fork_pending === 1,
    autoVerify: row.auto_verify === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Sidebar listing: group members are hidden (they render inside their group). */
export function listConversations(): ConversationRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM conversations WHERE archived = 0 AND group_id IS NULL ORDER BY updated_at DESC'
    )
    .all() as unknown as Row[]
  return rows.map((row) => {
    const record = toRecord(row)
    if (record.kind === 'group') {
      record.groupMembers = listGroupMembers(record.id).map((m) => ({
        id: m.id,
        title: m.title,
        provider: m.provider,
        permissionMode: m.permissionMode
      }))
    }
    return record
  })
}

/** Every non-archived conversation, including group members (bus directory). */
export function listAllConversationRecords(): ConversationRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM conversations WHERE archived = 0')
    .all() as unknown as Row[]
  return rows.map(toRecord)
}

export function listGroupMembers(groupId: string): ConversationRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM conversations WHERE group_id = ? AND archived = 0 ORDER BY created_at')
    .all(groupId) as unknown as Row[]
  return rows.map(toRecord)
}

export function getConversation(id: string): ConversationRecord | null {
  const row = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | Row
    | undefined
  return row ? toRecord(row) : null
}

export function createConversation(
  provider: ProviderId,
  model: string,
  opts: {
    title?: string
    kind?: 'single' | 'group'
    groupId?: string | null
    personaName?: string | null
    personaPrompt?: string | null
  } = {}
): ConversationRecord {
  const now = Date.now()
  const record: ConversationRecord = {
    id: randomUUID(),
    title: opts.title ?? 'New conversation',
    provider,
    model,
    providerSessionId: null,
    cwd: null,
    permissionMode: 'default',
    personaName: opts.personaName ?? null,
    personaPrompt: opts.personaPrompt ?? null,
    kind: opts.kind ?? 'single',
    groupId: opts.groupId ?? null,
    forkPending: false,
    autoVerify: false,
    createdAt: now,
    updatedAt: now
  }
  getDb()
    .prepare(
      `INSERT INTO conversations (id, title, provider, model, provider_session_id, cwd, permission_mode, persona_name, persona_prompt, kind, group_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.title,
      record.provider,
      record.model,
      null,
      null,
      record.permissionMode,
      record.personaName,
      record.personaPrompt,
      record.kind,
      record.groupId,
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

/** Per-member cursor into the group transcript (shared room history). */
export function getMemberLastSeq(memberId: string): number {
  const row = getDb()
    .prepare('SELECT last_seq FROM group_member_state WHERE member_id = ?')
    .get(memberId) as { last_seq: number } | undefined
  return row?.last_seq ?? 0
}

export function setMemberLastSeq(memberId: string, seq: number): void {
  getDb()
    .prepare(
      `INSERT INTO group_member_state (member_id, last_seq) VALUES (?, ?)
       ON CONFLICT (member_id) DO UPDATE SET last_seq = excluded.last_seq`
    )
    .run(memberId, seq)
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

export function setConversationPersona(
  id: string,
  personaName: string | null,
  personaPrompt: string | null
): void {
  getDb()
    .prepare('UPDATE conversations SET persona_name = ?, persona_prompt = ? WHERE id = ?')
    .run(personaName, personaPrompt, id)
}

/** Create a fork of a Claude conversation: same provider session, new branch on first turn. */
export function createForkOf(sourceId: string): ConversationRecord {
  const source = getConversation(sourceId)
  if (!source) throw new Error('Unknown conversation')
  if (source.provider !== 'claude' || source.kind !== 'single' || !source.providerSessionId) {
    throw new Error('Only started single Claude conversations can be forked')
  }
  const record = createConversation(source.provider, source.model, {
    title: `⑂ ${source.title}`,
    personaName: source.personaName,
    personaPrompt: source.personaPrompt
  })
  getDb()
    .prepare(
      'UPDATE conversations SET provider_session_id = ?, cwd = ?, permission_mode = ?, fork_pending = 1 WHERE id = ?'
    )
    .run(source.providerSessionId, source.cwd, source.permissionMode, record.id)
  return getConversation(record.id)!
}

export function setAutoVerify(id: string, enabled: boolean): void {
  getDb().prepare('UPDATE conversations SET auto_verify = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function clearForkPending(id: string): void {
  getDb().prepare('UPDATE conversations SET fork_pending = 0 WHERE id = ?').run(id)
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
