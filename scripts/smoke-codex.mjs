// Smoke test: Codex SDK streamed thread, mirroring CodexProvider's usage.
import { Codex } from '@openai/codex-sdk'

const codex = new Codex()
const thread = codex.startThread({
  workingDirectory: process.cwd(),
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  skipGitRepoCheck: true
})

const { events } = await thread.runStreamed('Reply with exactly: CHIMERA-CODEX-OK')
for await (const ev of events) {
  if (ev.type === 'thread.started') console.log('THREAD', ev.thread_id)
  else if (ev.type === 'item.completed' && ev.item.type === 'agent_message')
    console.log('MESSAGE %j', ev.item.text)
  else if (ev.type === 'turn.completed')
    console.log('COMPLETED tokens_out=%d', ev.usage?.output_tokens)
  else if (ev.type === 'turn.failed') console.log('FAILED', ev.error.message)
  else console.log('event:', ev.type, ev.item?.type ?? '')
}
process.exit(0)
