import { randomUUID } from 'node:crypto'
import { getDb } from './db'

export interface WatcherRecord {
  id: string
  conversationId: string
  path: string
  kind: 'files' | 'git'
  prompt: string
  enabled: boolean
  lastState: string | null
}

interface Row {
  id: string
  conversation_id: string
  path: string
  kind: string
  prompt: string
  enabled: number
  last_state: string | null
}

function toRecord(r: Row): WatcherRecord {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    path: r.path,
    kind: r.kind as WatcherRecord['kind'],
    prompt: r.prompt,
    enabled: r.enabled === 1,
    lastState: r.last_state
  }
}

export function listWatchers(): WatcherRecord[] {
  const rows = getDb().prepare('SELECT * FROM watchers ORDER BY created_at').all() as unknown as Row[]
  return rows.map(toRecord)
}

export function addWatcher(
  conversationId: string,
  path: string,
  kind: 'files' | 'git',
  prompt: string
): WatcherRecord {
  const record: WatcherRecord = {
    id: randomUUID(),
    conversationId,
    path,
    kind,
    prompt,
    enabled: true,
    lastState: null
  }
  getDb()
    .prepare(
      `INSERT INTO watchers (id, conversation_id, path, kind, prompt, enabled, last_state, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NULL, ?)`
    )
    .run(record.id, conversationId, path, kind, prompt, Date.now())
  return record
}

export function setWatcherState(id: string, state: string): void {
  getDb().prepare('UPDATE watchers SET last_state = ? WHERE id = ?').run(state, id)
}

export function setWatcherEnabled(id: string, enabled: boolean): void {
  getDb().prepare('UPDATE watchers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function removeWatcher(id: string): void {
  getDb().prepare('DELETE FROM watchers WHERE id = ?').run(id)
}

export function removeWatchersFor(conversationId: string): void {
  getDb().prepare('DELETE FROM watchers WHERE conversation_id = ?').run(conversationId)
}
