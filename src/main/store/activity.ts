import { getDb } from './db'

export interface ActivityRow {
  id: number
  ts: number
  kind: string
  text: string
  conversationId: string | null
}

/** App activity feed: what happened (schedules, watchers, bus, missions) and when. */
export function logActivity(kind: string, text: string, conversationId?: string): void {
  getDb()
    .prepare('INSERT INTO activity_log (ts, kind, text, conversation_id) VALUES (?, ?, ?, ?)')
    .run(Date.now(), kind, text.slice(0, 500), conversationId ?? null)
}

export function activitySince(ts: number, limit = 100): ActivityRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM activity_log WHERE ts > ? ORDER BY ts DESC LIMIT ?')
    .all(ts, limit) as unknown as {
    id: number
    ts: number
    kind: string
    text: string
    conversation_id: string | null
  }[]
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    text: r.text,
    conversationId: r.conversation_id
  }))
}
