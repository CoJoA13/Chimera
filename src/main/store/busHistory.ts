import { getDb } from './db'
import type { BusMessage } from '../bus/BusCore'

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
