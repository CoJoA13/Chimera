import { getDb } from './db'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export type SpendKind = 'actual' | 'estimated'

export function recordSpend(conversationId: string, cost: number, kind: SpendKind = 'actual'): void {
  if (!cost || cost <= 0) return
  const reportedCost = kind === 'actual' ? cost : 0
  const estimatedCost = kind === 'estimated' ? cost : 0
  getDb()
    .prepare(
      `INSERT INTO spend (day, conversation_id, cost, estimated_cost) VALUES (?, ?, ?, ?)
       ON CONFLICT (day, conversation_id) DO UPDATE SET
         cost = cost + excluded.cost,
         estimated_cost = estimated_cost + excluded.estimated_cost`
    )
    .run(today(), conversationId, reportedCost, estimatedCost)
}

export function todaySpend(): number {
  const row = getDb()
    .prepare('SELECT SUM(cost + estimated_cost) total FROM spend WHERE day = ?')
    .get(today()) as
    | { total: number | null }
    | undefined
  return row?.total ?? 0
}

export function todaySpendBreakdown(): { reportedCost: number; estimatedCost: number; total: number } {
  const row = getDb()
    .prepare(
      `SELECT SUM(cost) actual, SUM(estimated_cost) estimated
       FROM spend WHERE day = ?`
    )
    .get(today()) as { actual: number | null; estimated: number | null } | undefined
  const reportedCost = row?.actual ?? 0
  const estimatedCost = row?.estimated ?? 0
  return { reportedCost, estimatedCost, total: reportedCost + estimatedCost }
}

export function spendByConversation(
  days = 7
): {
  conversationId: string
  /** Backward-compatible total used by older callers. */
  cost: number
  reportedCost: number
  estimatedCost: number
  total: number
}[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const rows = getDb()
    .prepare(
      `SELECT conversation_id, SUM(cost) actual_cost, SUM(estimated_cost) estimated_cost
       FROM spend WHERE day >= ? GROUP BY conversation_id
       ORDER BY actual_cost + estimated_cost DESC LIMIT 20`
    )
    .all(since) as unknown as {
    conversation_id: string
    actual_cost: number
    estimated_cost: number
  }[]
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    cost: row.actual_cost + row.estimated_cost,
    reportedCost: row.actual_cost,
    estimatedCost: row.estimated_cost,
    total: row.actual_cost + row.estimated_cost
  }))
}
