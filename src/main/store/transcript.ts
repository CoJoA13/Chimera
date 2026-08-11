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
  'turn.completed',
  'verification'
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
  let malformed = 0
  const events = rows.flatMap((row) => {
    try {
      return [JSON.parse(row.event_json) as SessionEvent]
    } catch {
      // One damaged cache row should not make the entire conversation unreadable.
      malformed++
      return []
    }
  })
  if (malformed > 0) {
    console.warn(`[transcript] skipped ${malformed} malformed row(s) for ${conversationId}`)
  }
  return events
}

/**
 * Legacy cached Codex events reused item ids across turns, which made replays
 * merge distinct messages and orphan tool outputs. Rewrite repeats to unique
 * ids (later occurrences suffixed), bind outputs to the LATEST variant of
 * their tool id, and close out calls that never recorded a result.
 */
export function dedupeReplayIds(events: SessionEvent[]): SessionEvent[] {
  const counts = new Map<string, number>()
  const currentTool = new Map<string, string>()
  const openTools = new Map<string, SessionEvent>()
  const result: SessionEvent[] = events.map((ev) => {
    if (ev.type === 'text.done' || ev.type === 'thinking.done') {
      const n = (counts.get(ev.blockId) ?? 0) + 1
      counts.set(ev.blockId, n)
      return n === 1 ? ev : { ...ev, blockId: `${ev.blockId}#${n}` }
    }
    if (ev.type === 'tool.started') {
      const n = (counts.get(ev.toolUseId) ?? 0) + 1
      counts.set(ev.toolUseId, n)
      const id = n === 1 ? ev.toolUseId : `${ev.toolUseId}#${n}`
      currentTool.set(ev.toolUseId, id)
      const out = n === 1 ? ev : { ...ev, toolUseId: id }
      openTools.set(id, out)
      return out
    }
    if (ev.type === 'tool.output') {
      const id = currentTool.get(ev.toolUseId) ?? ev.toolUseId
      openTools.delete(id)
      return id === ev.toolUseId ? ev : { ...ev, toolUseId: id }
    }
    return ev
  })
  // Calls with no recorded result would spin forever in the UI.
  for (const [id, started] of openTools) {
    if (started.type !== 'tool.started') continue
    result.push({
      type: 'tool.output',
      localId: started.localId,
      turnId: started.turnId,
      toolUseId: id,
      output: '(no result recorded — the call did not complete)',
      isError: true
    })
  }
  return result
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
  let malformed = 0
  const events = rows.flatMap((row) => {
    try {
      return [{ seq: row.seq, event: JSON.parse(row.event_json) as SessionEvent }]
    } catch {
      malformed++
      return []
    }
  })
  if (malformed > 0) {
    console.warn(`[transcript] skipped ${malformed} malformed row(s) for ${conversationId}`)
  }
  return events
}

/** Duplicate a transcript (fork history) preserving order. */
export function copyTranscript(sourceId: string, destId: string): void {
  getDb()
    .prepare(
      `INSERT INTO transcript_cache (conversation_id, event_json)
       SELECT ?, event_json FROM transcript_cache WHERE conversation_id = ? ORDER BY seq`
    )
    .run(destId, sourceId)
}

/** Case-insensitive text search over cached transcripts (user + assistant text). */
export function searchTranscripts(
  queryText: string,
  limit = 20
): { conversationId: string; snippet: string }[] {
  const needle = queryText.toLowerCase()
  const rows = getDb()
    .prepare(
      `SELECT conversation_id, event_json FROM transcript_cache
       WHERE json_valid(event_json)
         AND json_extract(event_json, '$.type') IN ('user.message', 'text.done')
         AND json_extract(event_json, '$.text') LIKE ? ESCAPE '\\'
       ORDER BY seq DESC LIMIT 5000`
    )
    .all(`%${needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`) as unknown as {
    conversation_id: string
    event_json: string
  }[]
  const best = new Map<string, string>()
  for (const row of rows) {
    if (best.size >= limit) break
    if (best.has(row.conversation_id)) continue
    try {
      const ev = JSON.parse(row.event_json) as { type: string; text?: string }
      if ((ev.type !== 'user.message' && ev.type !== 'text.done') || !ev.text) continue
      const idx = ev.text.toLowerCase().indexOf(needle)
      if (idx === -1) continue
      const start = Math.max(0, idx - 40)
      best.set(
        row.conversation_id,
        (start > 0 ? '…' : '') + ev.text.slice(start, idx + needle.length + 60).replaceAll('\n', ' ')
      )
    } catch {
      // skip unparseable rows
    }
  }
  return [...best.entries()].map(([conversationId, snippet]) => ({ conversationId, snippet }))
}

export function latestSeq(conversationId: string): number {
  const row = getDb()
    .prepare('SELECT MAX(seq) s FROM transcript_cache WHERE conversation_id = ?')
    .get(conversationId) as { s: number | null } | undefined
  return row?.s ?? 0
}
