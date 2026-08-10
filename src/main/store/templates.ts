import { randomUUID } from 'node:crypto'
import type { GroupMemberSpec } from '../../shared/config-types'
import { getDb } from './db'
import { getConversation, listGroupMembers } from './conversations'

export interface TemplateRecord {
  id: string
  name: string
  spec: TemplateSpec
  createdAt: number
}

export interface TemplateSpec {
  kind: 'single' | 'group'
  members: GroupMemberSpec[]
}

export function listTemplates(): TemplateRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM templates ORDER BY name')
    .all() as unknown as { id: string; name: string; spec_json: string; created_at: number }[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    spec: JSON.parse(r.spec_json) as TemplateSpec,
    createdAt: r.created_at
  }))
}

/** Capture a conversation (single or group) as a reusable template. */
export function saveTemplateFromConversation(conversationId: string, name: string): TemplateRecord {
  const conv = getConversation(conversationId)
  if (!conv) throw new Error(`Unknown conversation: ${conversationId}`)
  const members: GroupMemberSpec[] =
    conv.kind === 'group'
      ? listGroupMembers(conversationId).map((m) => ({
          provider: m.provider,
          model: m.model,
          title: m.title,
          personaName: m.personaName,
          personaPrompt: m.personaPrompt
        }))
      : [
          {
            provider: conv.provider,
            model: conv.model,
            title: conv.personaName ?? conv.provider,
            personaName: conv.personaName,
            personaPrompt: conv.personaPrompt
          }
        ]
  const record: TemplateRecord = {
    id: randomUUID(),
    name,
    spec: { kind: conv.kind, members },
    createdAt: Date.now()
  }
  getDb()
    .prepare('INSERT INTO templates (id, name, spec_json, created_at) VALUES (?, ?, ?, ?)')
    .run(record.id, record.name, JSON.stringify(record.spec), record.createdAt)
  return record
}

export function getTemplate(id: string): TemplateRecord | null {
  const row = getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id) as
    | { id: string; name: string; spec_json: string; created_at: number }
    | undefined
  return row
    ? {
        id: row.id,
        name: row.name,
        spec: JSON.parse(row.spec_json) as TemplateSpec,
        createdAt: row.created_at
      }
    : null
}

export function deleteTemplate(id: string): void {
  getDb().prepare('DELETE FROM templates WHERE id = ?').run(id)
}
