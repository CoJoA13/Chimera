import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/** A rule matches when global (conversation_id NULL) or scoped to this conversation. */
export function isAlwaysAllowed(toolName: string, conversationId?: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM permission_rules WHERE tool_name = ? AND behavior = 'allow'
       AND (conversation_id IS NULL OR conversation_id = ?)`
    )
    .get(toolName, conversationId ?? null)
  return row !== undefined
}

export function addAlwaysAllowRule(toolName: string, conversationId?: string): void {
  if (isAlwaysAllowed(toolName, conversationId)) return
  getDb()
    .prepare(
      "INSERT INTO permission_rules (id, tool_name, behavior, conversation_id) VALUES (?, ?, 'allow', ?)"
    )
    .run(randomUUID(), toolName, conversationId ?? null)
}

export function listRules(): { id: string; toolName: string; behavior: string }[] {
  const rows = getDb().prepare('SELECT * FROM permission_rules').all() as unknown as {
    id: string
    tool_name: string
    behavior: string
  }[]
  return rows.map((r) => ({ id: r.id, toolName: r.tool_name, behavior: r.behavior }))
}

export function removeRule(id: string): void {
  getDb().prepare('DELETE FROM permission_rules WHERE id = ?').run(id)
}
