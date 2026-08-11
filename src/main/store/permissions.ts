import { randomUUID } from 'node:crypto'
import { getDb } from './db'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)])
    )
  }
  return value
}

/** Exact, stable input fingerprint for a user-approved invocation. */
export function permissionInputPattern(input: Record<string, unknown>): string {
  return JSON.stringify(stableValue(input))
}

/** A rule matches when global (conversation_id NULL) or scoped to this conversation. */
export function isAlwaysAllowed(
  toolName: string,
  conversationId?: string,
  input?: Record<string, unknown>
): boolean {
  const pattern = input ? permissionInputPattern(input) : null
  const row = getDb()
    .prepare(
      `SELECT id FROM permission_rules WHERE tool_name = ? AND behavior = 'allow'
       AND (conversation_id IS NULL OR conversation_id = ?)
       AND (input_pattern IS NULL OR input_pattern = ?)`
    )
    .get(toolName, conversationId ?? null, pattern)
  return row !== undefined
}

export function addAlwaysAllowRule(
  toolName: string,
  conversationId?: string,
  input?: Record<string, unknown>
): void {
  if (isAlwaysAllowed(toolName, conversationId, input)) return
  getDb()
    .prepare(
      "INSERT INTO permission_rules (id, tool_name, behavior, conversation_id, input_pattern) VALUES (?, ?, 'allow', ?, ?)"
    )
    .run(
      randomUUID(),
      toolName,
      conversationId ?? null,
      input ? permissionInputPattern(input) : null
    )
}

export function listRules(): {
  id: string
  toolName: string
  behavior: string
  inputPattern: string | null
}[] {
  const rows = getDb().prepare('SELECT * FROM permission_rules').all() as unknown as {
    id: string
    tool_name: string
    behavior: string
    input_pattern: string | null
  }[]
  return rows.map((r) => ({
    id: r.id,
    toolName: r.tool_name,
    behavior: r.behavior,
    inputPattern: r.input_pattern
  }))
}

export function removeRule(id: string): void {
  getDb().prepare('DELETE FROM permission_rules WHERE id = ?').run(id)
}
