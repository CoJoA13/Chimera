import { randomUUID } from 'node:crypto'
import { getDb } from './db'

export function isAlwaysAllowed(toolName: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM permission_rules WHERE tool_name = ? AND behavior = 'allow'")
    .get(toolName)
  return row !== undefined
}

export function addAlwaysAllowRule(toolName: string): void {
  if (isAlwaysAllowed(toolName)) return
  getDb()
    .prepare("INSERT INTO permission_rules (id, tool_name, behavior) VALUES (?, ?, 'allow')")
    .run(randomUUID(), toolName)
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
