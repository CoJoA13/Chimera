import { randomUUID } from 'node:crypto'
import { getDb } from './db'

export type Cadence =
  | { type: 'interval'; minutes: number }
  | { type: 'daily'; time: string } // "HH:MM" local

export interface ScheduleRecord {
  id: string
  conversationId: string
  prompt: string
  cadence: Cadence
  enabled: boolean
  nextRunAt: number
  lastRunAt: number | null
}

export function computeNextRun(cadence: Cadence, from = Date.now()): number {
  if (cadence.type === 'interval') {
    return from + Math.max(5, cadence.minutes) * 60_000
  }
  const [h, m] = cadence.time.split(':').map(Number)
  const next = new Date(from)
  next.setHours(h, m, 0, 0)
  if (next.getTime() <= from) next.setDate(next.getDate() + 1)
  return next.getTime()
}

interface Row {
  id: string
  conversation_id: string
  prompt: string
  cadence_json: string
  enabled: number
  next_run_at: number
  last_run_at: number | null
}

function toRecord(r: Row): ScheduleRecord {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    prompt: r.prompt,
    cadence: JSON.parse(r.cadence_json) as Cadence,
    enabled: r.enabled === 1,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at
  }
}

export function listSchedules(): ScheduleRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM schedules ORDER BY next_run_at')
    .all() as unknown as Row[]
  return rows.map(toRecord)
}

export function addSchedule(conversationId: string, prompt: string, cadence: Cadence): ScheduleRecord {
  const record: ScheduleRecord = {
    id: randomUUID(),
    conversationId,
    prompt,
    cadence,
    enabled: true,
    nextRunAt: computeNextRun(cadence),
    lastRunAt: null
  }
  getDb()
    .prepare(
      `INSERT INTO schedules (id, conversation_id, prompt, cadence_json, enabled, next_run_at, last_run_at)
       VALUES (?, ?, ?, ?, 1, ?, NULL)`
    )
    .run(record.id, conversationId, prompt, JSON.stringify(cadence), record.nextRunAt)
  return record
}

export function dueSchedules(now = Date.now()): ScheduleRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ?')
    .all(now) as unknown as Row[]
  return rows.map(toRecord)
}

export function markRan(id: string, cadence: Cadence): void {
  getDb()
    .prepare('UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?')
    .run(Date.now(), computeNextRun(cadence), id)
}

export function postpone(id: string, ms: number): void {
  getDb().prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(Date.now() + ms, id)
}

export function setScheduleEnabled(id: string, enabled: boolean): void {
  getDb().prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function removeSchedule(id: string): void {
  getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id)
}

export function removeSchedulesFor(conversationId: string): void {
  getDb().prepare('DELETE FROM schedules WHERE conversation_id = ?').run(conversationId)
}
