import { z } from 'zod'
import { BusCore, DEFAULT_AWAIT_SECONDS, MAX_AWAIT_SECONDS } from './BusCore'
import { readMemory, saveMemory } from '../store/memory'
import { storeArtifact } from '../store/artifacts'
import { updateMissionProgress, missionsForConversation } from '../store/missions'
import { saveSkill } from '../store/skills'
import { logActivity } from '../store/activity'
import {
  addSchedule,
  listSchedules,
  removeSchedule,
  type Cadence
} from '../store/schedules'

const MAX_SCHEDULES_PER_SESSION = 10

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
      name: 'send_artifact',
      description:
        'Send a FILE to another session over the bus (max 10MB). The file is copied to a stable path the recipient can read with its own tools.',
      schema: {
        target_id: z.string().describe('session_id of the recipient'),
        path: z.string().describe('Absolute path of the file to send'),
        note: z.string().optional().describe('What this file is / what to do with it')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { target_id: string; path: string; note?: string }
        debug(callerLocalId, 'send_artifact', args)
        try {
          const { storedPath, size } = storeArtifact(args.path)
          const text =
            `[Artifact: ${storedPath} (${size} bytes, original: ${args.path})]` +
            (args.note ? `\n${args.note}` : '\nRead it with your file tools.')
          const messageId = core.send(callerLocalId, args.target_id, text, false)
          return ok({ message_id: messageId, stored_path: storedPath })
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
    },
    {
      name: 'create_schedule',
      description:
        'Schedule a recurring prompt to YOURSELF (this session). Use when the user asks you to check/do something regularly. Provide either daily_time ("HH:MM") or every_hours.',
      schema: {
        prompt: z.string().describe('The prompt that will be sent to you on schedule'),
        daily_time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional()
          .describe('Run daily at this local time, e.g. "08:30"'),
        every_hours: z.number().min(1).max(168).optional().describe('Or: run every N hours')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as {
          prompt: string
          daily_time?: string
          every_hours?: number
        }
        debug(callerLocalId, 'create_schedule', args)
        if (callerLocalId === 'control-room') return fail('The control room cannot hold schedules')
        if (!args.daily_time && !args.every_hours) {
          return fail('Provide daily_time or every_hours')
        }
        const mine = listSchedules().filter((s) => s.conversationId === callerLocalId)
        if (mine.length >= MAX_SCHEDULES_PER_SESSION) {
          return fail(`Schedule limit reached (${MAX_SCHEDULES_PER_SESSION}). Delete one first.`)
        }
        const cadence: Cadence = args.daily_time
          ? { type: 'daily', time: args.daily_time }
          : { type: 'interval', minutes: (args.every_hours as number) * 60 }
        const record = addSchedule(callerLocalId, args.prompt, cadence)
        return ok({
          schedule_id: record.id,
          next_run: new Date(record.nextRunAt).toISOString(),
          note: 'Schedules run while the Chimera app is open.'
        })
      }
    },
    {
      name: 'list_schedules',
      description: 'List the recurring schedules attached to this session.',
      schema: {},
      handler: async (): Promise<BusToolResult> => {
        debug(callerLocalId, 'list_schedules', {})
        const mine = listSchedules().filter((s) => s.conversationId === callerLocalId)
        return ok({
          schedules: mine.map((s) => ({
            schedule_id: s.id,
            prompt: s.prompt,
            cadence: s.cadence,
            enabled: s.enabled,
            next_run: new Date(s.nextRunAt).toISOString()
          }))
        })
      }
    },
    {
      name: 'delete_schedule',
      description: 'Delete one of YOUR schedules by schedule_id.',
      schema: {
        schedule_id: z.string().describe('From list_schedules or create_schedule')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { schedule_id: string }
        debug(callerLocalId, 'delete_schedule', args)
        const mine = listSchedules().find(
          (s) => s.id === args.schedule_id && s.conversationId === callerLocalId
        )
        if (!mine) return fail('No such schedule on this session')
        removeSchedule(args.schedule_id)
        return ok({ status: 'deleted' })
      }
    },
    {
      name: 'update_mission',
      description:
        'Report progress on a mission assigned to this session. Call after each mission check-in increment.',
      schema: {
        mission_id: z.string().describe('The mission id from the check-in prompt'),
        progress: z.string().describe('One-line summary of current progress'),
        status: z
          .enum(['active', 'paused', 'done'])
          .optional()
          .describe('Set "done" only when the goal is fully achieved')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as {
          mission_id: string
          progress: string
          status?: 'active' | 'paused' | 'done'
        }
        debug(callerLocalId, 'update_mission', args)
        const mine = missionsForConversation(callerLocalId)
        if (!mine.some((m) => m.id === args.mission_id)) {
          return fail('No such mission assigned to this session')
        }
        try {
          updateMissionProgress(args.mission_id, args.progress.slice(0, 300), args.status)
          logActivity('mission', `Mission progress: ${args.progress.slice(0, 120)}`, callerLocalId)
          return ok({ status: 'updated' })
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
    },
    {
      name: 'save_skill',
      description:
        'Distill a reusable technique into the shared skill library (loaded into every future Claude session). Use after solving a nontrivial problem whose METHOD would help again: capture the approach, not the specific answer.',
      schema: {
        name: z.string().describe('Short skill name, e.g. "debug-electron-ipc"'),
        description: z
          .string()
          .describe('One line: when should a future agent reach for this skill?'),
        instructions: z
          .string()
          .describe('The distilled method as markdown: steps, pitfalls, verification')
      },
      handler: async (raw): Promise<BusToolResult> => {
        const args = raw as unknown as { name: string; description: string; instructions: string }
        debug(callerLocalId, 'save_skill', { name: args.name })
        try {
          const slug = saveSkill(args.name, args.description, args.instructions)
          logActivity('skill', `New distilled skill: ${slug}`, callerLocalId)
          return ok({ status: 'saved', slug, note: 'Loads into Claude sessions started from now on.' })
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
