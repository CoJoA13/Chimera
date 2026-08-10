import { getDb } from './db'
import type { SessionEvent } from '../../shared/events'

/**
 * App-side transcript cache: the renderable subset of session events, per
 * conversation, in arrival order. This is the primary source for history
 * replay (uniform across providers); the Claude SDK's own session store is
 * the fallback for conversations that predate the cache.
 */
const RENDERABLE = new Set<SessionEvent['type']>([
  'user.message',
  'text.done',
  'thinking.done',
  'tool.started',
  'tool.output',
  'bus.message',
  'turn.completed'
])

export function recordTranscriptEvent(conversationId: string, ev: SessionEvent): void {
  if (!RENDERABLE.has(ev.type)) return
  getDb()
    .prepare('INSERT INTO transcript_cache (conversation_id, event_json) VALUES (?, ?)')
    .run(conversationId, JSON.stringify(ev))
}

export function loadTranscript(conversationId: string): SessionEvent[] {
  const rows = getDb()
    .prepare('SELECT event_json FROM transcript_cache WHERE conversation_id = ? ORDER BY seq')
    .all(conversationId) as unknown as { event_json: string }[]
  return rows.map((r) => JSON.parse(r.event_json) as SessionEvent)
}

export function clearTranscript(conversationId: string): void {
  getDb().prepare('DELETE FROM transcript_cache WHERE conversation_id = ?').run(conversationId)
}

/** Rows after a cursor — used to build per-member group room history. */
export function loadTranscriptSince(
  conversationId: string,
  afterSeq: number
): { seq: number; event: SessionEvent }[] {
  const rows = getDb()
    .prepare(
      'SELECT seq, event_json FROM transcript_cache WHERE conversation_id = ? AND seq > ? ORDER BY seq'
    )
    .all(conversationId, afterSeq) as unknown as { seq: number; event_json: string }[]
  return rows.map((r) => ({ seq: r.seq, event: JSON.parse(r.event_json) as SessionEvent }))
}

export function latestSeq(conversationId: string): number {
  const row = getDb()
    .prepare('SELECT MAX(seq) s FROM transcript_cache WHERE conversation_id = ?')
    .get(conversationId) as { s: number | null } | undefined
  return row?.s ?? 0
}
