import { z } from 'zod'
import { BusCore, DEFAULT_AWAIT_SECONDS, MAX_AWAIT_SECONDS } from './BusCore'
import { readMemory, saveMemory } from '../store/memory'

export interface BusToolResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function ok(payload: unknown): BusToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function debug(caller: string, tool: string, detail: unknown): void {
  if (process.env.CHIMERA_BUS_DEBUG) {
    console.log(`[bus-tool] ${caller.slice(0, 12)} ${tool}`, JSON.stringify(detail)?.slice(0, 200))
  }
}

function fail(message: string): BusToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export interface BusToolDef {
  name: string
  description: string
  schema: Record<string, z.ZodType>
  handler: (args: Record<string, never>) => Promise<BusToolResult>
}

/**
 * Transport-agnostic definitions of the five bus tools, bound to a caller
 * session. Both the in-process (Claude) and HTTP (Codex) servers map these
 * 1:1 into their tool registries.
 */
export function busToolDefs(core: BusCore, callerLocalId: string): BusToolDef[] {
  return [
    {
      name: 'list_sessions',
      description:
        'List the other live agent sessions in this app that you can message via the bus.',
      schema: {},
      handler: async (): Promise<BusToolResult> => {
        debug(callerLocalId, 'list_sessions', {})
        const sessions = core.listSessions(callerLocalId)
        if (sessions.length === 0) return ok({ sessions: [], note: 'No other sessions are live.' })
        return ok({
          sessions: sessions.map((s) => ({
            session_id: s.localId,
            title: s.title,
            provider: s.provider,
            status: s.status,
            persona: s.persona
          }))
        })
      }
    },
    {
      name: 'send_to_session',
      description:
        'Send a message to another live session. Returns a message_id immediately; use await_reply to wait for an answer.',
      schema: {
        target_id: z.string().describe('session_id of the target session (from list_sessions)'),
        text: z.string().describe('The message to send'),
        expects_reply: z
          .boolean()
          .optional()
          .describe('Whether you intend to wait for a reply (default false)')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { target_id: string; text: string; expects_reply?: boolean }
        debug(callerLocalId, 'send_to_session', args)
        try {
          const messageId = core.send(
            callerLocalId,
            args.target_id,
            args.text,
            args.expects_reply ?? false
          )
          return ok({ message_id: messageId, status: 'sent' })
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
    },
    {
      name: 'broadcast',
      description:
        'Send the same message to EVERY other live session at once. Returns a message_id per recipient; use await_replies to collect their answers.',
      schema: {
        text: z.string().describe('The message to send to all peers'),
        expects_reply: z
          .boolean()
          .optional()
          .describe('Whether you intend to collect replies (default false)')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { text: string; expects_reply?: boolean }
        debug(callerLocalId, 'broadcast', args)
        const results = core.broadcast(callerLocalId, args.text, args.expects_reply ?? false)
        if (results.length === 0) {
          return ok({ recipients: [], note: 'No other sessions are live.' })
        }
        return ok({
          recipients: results.map((r) => ({
            session_id: r.sessionId,
            message_id: r.messageId,
            error: r.error
          }))
        })
      }
    },
    {
      name: 'await_replies',
      description: `Collect replies to several messages you sent (e.g. after broadcast). Blocks until all reply or the shared timeout fires (default ${DEFAULT_AWAIT_SECONDS}s, max ${MAX_AWAIT_SECONDS}s); timed-out entries return status "timeout" while received replies are kept.`,
      schema: {
        message_ids: z.array(z.string()).describe('message_ids returned by send_to_session/broadcast'),
        timeout_seconds: z.number().optional()
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { message_ids: string[]; timeout_seconds?: number }
        debug(callerLocalId, 'await_replies:begin', args)
        const results = await core.awaitReplies(
          callerLocalId,
          args.message_ids,
          args.timeout_seconds ?? DEFAULT_AWAIT_SECONDS
        )
        debug(callerLocalId, 'await_replies:end', { count: results.length })
        return ok({
          replies: results.map((r) => ({ message_id: r.messageId, ...r.result }))
        })
      }
    },
    {
      name: 'await_reply',
      description: `Block until the target session replies to a message you sent (default ${DEFAULT_AWAIT_SECONDS}s, max ${MAX_AWAIT_SECONDS}s). Returns status "timeout" if no reply arrives.`,
      schema: {
        message_id: z.string().describe('The message_id returned by send_to_session'),
        timeout_seconds: z.number().optional()
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { message_id: string; timeout_seconds?: number }
        debug(callerLocalId, 'await_reply:begin', args)
        const result = await core.awaitReply(
          callerLocalId,
          args.message_id,
          args.timeout_seconds ?? DEFAULT_AWAIT_SECONDS
        )
        debug(callerLocalId, 'await_reply:end', result)
        return ok(result)
      }
    },
    {
      name: 'reply_to_message',
      description: 'Reply to a bus message you received from another session.',
      schema: {
        message_id: z.string().describe('The message_id of the message you are replying to'),
        text: z.string().describe('Your reply')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { message_id: string; text: string }
        debug(callerLocalId, 'reply_to_message', args)
        try {
          core.reply(callerLocalId, args.message_id, args.text)
          return ok({ status: 'replied' })
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
    },
    {
      name: 'read_memory',
      description:
        'Read your persistent memory file — durable notes that survive across sessions.',
      schema: {},
      handler: async (): Promise<BusToolResult> => {
        debug(callerLocalId, 'read_memory', {})
        const content = readMemory(callerLocalId)
        return ok({ memory: content || '(empty — you have not saved anything yet)' })
      }
    },
    {
      name: 'save_memory',
      description:
        'REPLACE your persistent memory file (max 8KB). Read it first and write the merged result — this overwrites, not appends.',
      schema: {
        content: z.string().describe('The complete new memory content (markdown)')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { content: string }
        debug(callerLocalId, 'save_memory', { length: args.content.length })
        try {
          saveMemory(callerLocalId, args.content)
          return ok({ status: 'saved', length: args.content.length })
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
    },
    {
      name: 'check_inbox',
      description:
        'Check for queued bus messages that arrived while you were busy. Non-blocking.',
      schema: {},
      handler: async (): Promise<BusToolResult> => {
        debug(callerLocalId, 'check_inbox', {})
        const messages = core.checkInbox(callerLocalId)
        return ok({
          messages: messages.map((m) => ({
            message_id: m.messageId,
            from_session_id: m.from,
            text: m.text,
            expects_reply: m.expectsReply
          }))
        })
      }
    }
  ]
}
