import { getDb } from './db'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function recordSpend(conversationId: string, cost: number): void {
  if (!cost || cost <= 0) return
  getDb()
    .prepare(
      `INSERT INTO spend (day, conversation_id, cost) VALUES (?, ?, ?)
       ON CONFLICT (day, conversation_id) DO UPDATE SET cost = cost + excluded.cost`
    )
    .run(today(), conversationId, cost)
}

export function todaySpend(): number {
  const row = getDb().prepare('SELECT SUM(cost) total FROM spend WHERE day = ?').get(today()) as
    | { total: number | null }
    | undefined
  return row?.total ?? 0
}

export function spendByConversation(days = 7): { conversationId: string; cost: number }[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const rows = getDb()
    .prepare(
      `SELECT conversation_id, SUM(cost) cost FROM spend WHERE day >= ?
       GROUP BY conversation_id ORDER BY cost DESC LIMIT 20`
    )
    .all(since) as unknown as { conversation_id: string; cost: number }[]
  return rows.map((r) => ({ conversationId: r.conversation_id, cost: r.cost }))
}
