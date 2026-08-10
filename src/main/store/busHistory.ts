import { getDb } from './db'
import type { BusMessage } from '../bus/BusCore'

export interface BusHistoryRow {
  messageId: string
  fromId: string
  toId: string
  inReplyTo: string | null
  kind: string
  text: string
  createdAt: number
}

export function listBusMessages(limit = 300): BusHistoryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT message_id, from_conversation_id, to_conversation_id, in_reply_to, kind, text, created_at
       FROM bus_messages ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as unknown as {
    message_id: string
    from_conversation_id: string
    to_conversation_id: string
    in_reply_to: string | null
    kind: string
    text: string
    created_at: number
  }[]
  return rows
    .map((r) => ({
      messageId: r.message_id,
      fromId: r.from_conversation_id,
      toId: r.to_conversation_id,
      inReplyTo: r.in_reply_to,
      kind: r.kind,
      text: r.text,
      createdAt: r.created_at
    }))
    .reverse()
}

/** Persist every bus exchange for inspection and future history UI. */
export function recordBusMessage(msg: BusMessage, kind: 'sent' | 'replied'): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO bus_messages
       (message_id, from_conversation_id, to_conversation_id, in_reply_to, kind, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(msg.messageId, msg.from, msg.to, msg.inReplyTo ?? null, kind, msg.text, Date.now())
}
