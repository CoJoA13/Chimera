// Smoke test: streaming-input query with the same options ClaudeProvider uses.
import { query } from '@anthropic-ai/claude-agent-sdk'

async function* input() {
  yield {
    type: 'user',
    message: { role: 'user', content: 'Reply with exactly: CHIMERA-OK' },
    parent_tool_use_id: null
  }
}

const q = query({
  prompt: input(),
  options: {
    model: 'claude-haiku-4-5-20251001',
    includePartialMessages: true,
    permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    maxTurns: 1
  }
})

let deltas = 0
let sessionId = null
for await (const msg of q) {
  if (msg.type === 'system' && msg.subtype === 'init') {
    sessionId = msg.session_id
    console.log('INIT model=%s session=%s', msg.model, sessionId)
  }
  if (msg.type === 'stream_event' && msg.event.type === 'content_block_delta') deltas++
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
    console.log('ASSISTANT text=%j', text)
  }
  if (msg.type === 'result') {
    console.log(
      'RESULT subtype=%s cost=%s deltas=%d',
      msg.subtype,
      msg.total_cost_usd?.toFixed(5),
      deltas
    )
    break
  }
}
process.exit(0)
