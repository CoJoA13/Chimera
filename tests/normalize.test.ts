import { describe, it, expect } from 'vitest'
import { ClaudeNormalizer } from '../src/main/providers/claude/normalize'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

function makeNormalizer(): ClaudeNormalizer {
  return new ClaudeNormalizer('local-1', () => 'turn-1')
}

function streamEvent(event: unknown): SDKMessage {
  return { type: 'stream_event', event, parent_tool_use_id: null } as unknown as SDKMessage
}

function assistantMessage(id: string, text: string): SDKMessage {
  return {
    type: 'assistant',
    message: { id, role: 'assistant', content: [{ type: 'text', text }] }
  } as unknown as SDKMessage
}

describe('ClaudeNormalizer text finalization', () => {
  it('finalizes streamed text under the streamed blockId even when message ids differ', () => {
    const n = makeNormalizer()
    n.feed(streamEvent({ type: 'message_start', message: { id: 'msg_stream' } }))
    n.feed(streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }))
    const deltas = n.feed(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } })
    )
    expect(deltas).toEqual([
      { type: 'text.delta', localId: 'local-1', turnId: 'turn-1', blockId: 'msg_stream:0', text: 'Hello' }
    ])

    // The complete assistant message arrives with a DIFFERENT id — the done
    // event must still target the streamed block, not create a new one.
    const done = n.feed(assistantMessage('msg_final_DIFFERENT', 'Hello world'))
    expect(done).toEqual([
      {
        type: 'text.done',
        localId: 'local-1',
        turnId: 'turn-1',
        blockId: 'msg_stream:0',
        text: 'Hello world'
      }
    ])
  })

  it('gives non-streamed assistant text a fresh block id', () => {
    const n = makeNormalizer()
    // Synthetic message with no preceding stream events (e.g. login notice).
    const done = n.feed(assistantMessage('msg_synthetic', 'Not logged in'))
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ type: 'text.done', text: 'Not logged in' })
    expect((done[0] as { blockId: string }).blockId).toContain('msg_synthetic')
  })

  it('does not reuse a streamed id across later messages', () => {
    const n = makeNormalizer()
    n.feed(streamEvent({ type: 'message_start', message: { id: 'msg_1' } }))
    n.feed(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } })
    )
    n.feed(assistantMessage('msg_1', 'A'))
    // Second assistant message without stream deltas must NOT claim msg_1:0.
    const done = n.feed(assistantMessage('msg_2', 'B'))
    expect((done[0] as { blockId: string }).blockId).not.toBe('msg_1:0')
  })
})
