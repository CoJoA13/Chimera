import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent, Usage } from '../../../shared/events'

/**
 * Convert stored session history (getSessionMessages) into replayable events.
 * Only the main chain is replayed — subagent and sidechain messages are skipped.
 */
export function normalizeStoredHistory(localId: string, messages: SessionMessage[]): SessionEvent[] {
  const events: SessionEvent[] = []
  const turnId = 'replay'
  let counter = 0

  for (const msg of messages) {
    if (msg.parent_tool_use_id !== null) continue
    const message = msg.message as {
      role?: string
      content?: unknown
      id?: string
    } | null
    if (!message || typeof message !== 'object') continue

    if (msg.type === 'user') {
      const content = message.content
      if (typeof content === 'string') {
        if (content.trim()) events.push({ type: 'user.message', localId, turnId, text: content })
      } else if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            events.push({ type: 'user.message', localId, turnId, text: block.text })
          } else if (block.type === 'tool_result') {
            events.push({
              type: 'tool.output',
              localId,
              turnId,
              toolUseId: block.tool_use_id as string,
              output: block.content,
              isError: block.is_error === true
            })
          }
        }
      }
    } else if (msg.type === 'assistant') {
      const content = message.content
      if (!Array.isArray(content)) continue
      ;(content as Record<string, unknown>[]).forEach((block, index) => {
        const blockId = `${message.id ?? msg.uuid}:${index}:${counter++}`
        if (block.type === 'text' && typeof block.text === 'string') {
          events.push({ type: 'text.done', localId, turnId, blockId, text: block.text })
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          events.push({ type: 'thinking.done', localId, turnId, blockId, text: block.thinking })
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool.started',
            localId,
            turnId,
            toolUseId: block.id as string,
            toolName: block.name as string,
            input: block.input
          })
        }
      })
    }
  }
  return events
}

/**
 * Stateful normalizer: maps the Agent SDK message stream to Chimera SessionEvents.
 * One instance per session; feed() returns zero or more events per SDK message.
 *
 * Text/thinking stream token-by-token via `stream_event` partial messages
 * (includePartialMessages: true); the complete `assistant` message then
 * finalizes those blocks and carries tool_use blocks.
 */
export class ClaudeNormalizer {
  private currentMessageId = 'm0'
  /** stream index -> block kind, set by content_block_start */
  private blockKinds = new Map<number, 'text' | 'thinking' | 'other'>()
  /**
   * Block ids that streamed via partial events. The complete assistant message
   * can carry a DIFFERENT message id than the stream did — finalize streamed
   * blocks under their streamed id, or the UI renders the text twice.
   */
  private streamedBlocks = new Set<string>()

  constructor(
    private readonly localId: string,
    private readonly getTurnId: () => string
  ) {}

  feed(msg: SDKMessage): SessionEvent[] {
    const localId = this.localId
    const turnId = this.getTurnId()

    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          return [
            {
              type: 'session.registered',
              localId,
              providerSessionId: msg.session_id,
              model: msg.model
            }
          ]
        }
        return []
      }

      case 'stream_event': {
        const ev = msg.event as Record<string, unknown> & { type: string }
        if (ev.type === 'message_start') {
          const message = ev.message as { id?: string } | undefined
          this.currentMessageId = message?.id ?? `m-${Date.now()}`
          this.blockKinds.clear()
          return []
        }
        if (ev.type === 'content_block_start') {
          const index = ev.index as number
          const block = ev.content_block as { type: string } | undefined
          const kind =
            block?.type === 'text' ? 'text' : block?.type === 'thinking' ? 'thinking' : 'other'
          this.blockKinds.set(index, kind)
          return []
        }
        if (ev.type === 'content_block_delta') {
          const index = ev.index as number
          const delta = ev.delta as { type: string; text?: string; thinking?: string }
          const blockId = `${this.currentMessageId}:${index}`
          if (delta.type === 'text_delta' && delta.text) {
            this.streamedBlocks.add(blockId)
            return [{ type: 'text.delta', localId, turnId, blockId, text: delta.text }]
          }
          if (delta.type === 'thinking_delta' && delta.thinking) {
            this.streamedBlocks.add(blockId)
            return [{ type: 'thinking.delta', localId, turnId, blockId, text: delta.thinking }]
          }
          return []
        }
        return []
      }

      case 'assistant': {
        // Complete message: finalize streamed text/thinking blocks, surface tool calls.
        const events: SessionEvent[] = []
        const content = msg.message.content as unknown as Record<string, unknown>[]
        if (Array.isArray(content)) {
          content.forEach((block, index) => {
            // Prefer the streamed id for this position so the done event
            // finalizes the streamed block instead of appending a duplicate.
            const streamedId = `${this.currentMessageId}:${index}`
            const blockId = this.streamedBlocks.delete(streamedId)
              ? streamedId
              : `${msg.message.id ?? this.currentMessageId}:${index}:done`
            if (block.type === 'text') {
              events.push({
                type: 'text.done',
                localId,
                turnId,
                blockId,
                text: block.text as string
              })
            } else if (block.type === 'thinking') {
              events.push({
                type: 'thinking.done',
                localId,
                turnId,
                blockId,
                text: block.thinking as string
              })
            } else if (block.type === 'tool_use') {
              events.push({
                type: 'tool.started',
                localId,
                turnId,
                toolUseId: block.id as string,
                toolName: block.name as string,
                input: block.input
              })
            }
          })
        }
        return events
      }

      case 'user': {
        // Tool results come back as user messages containing tool_result blocks.
        const events: SessionEvent[] = []
        const content = msg.message.content as unknown as Record<string, unknown>[]
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              events.push({
                type: 'tool.output',
                localId,
                turnId,
                toolUseId: block.tool_use_id as string,
                output: block.content,
                isError: block.is_error === true
              })
            }
          }
        }
        return events
      }

      case 'result': {
        const usage: Usage | undefined = msg.usage
          ? {
              inputTokens: msg.usage.input_tokens ?? 0,
              outputTokens: msg.usage.output_tokens ?? 0,
              cacheReadTokens: msg.usage.cache_read_input_tokens ?? undefined,
              cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? undefined
            }
          : undefined
        const isError = msg.is_error || msg.subtype !== 'success'
        return [
          {
            type: 'turn.completed',
            localId,
            turnId,
            usage,
            costUsd: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
            durationMs: msg.duration_ms,
            isError,
            errorMessage: isError
              ? 'result' in msg
                ? String(msg.result)
                : `Turn failed (${msg.subtype})`
              : undefined
          }
        ]
      }

      default:
        return []
    }
  }
}
