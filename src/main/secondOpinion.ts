import { query } from '@anthropic-ai/claude-agent-sdk'
import { Codex } from '@openai/codex-sdk'
import { loadTranscript } from './store/transcript'

/**
 * Counterfactual "what would X have said": replay the last user question with
 * a different model/provider, giving it recent conversation context, no tools.
 */
export async function secondOpinion(
  conversationId: string,
  provider: 'claude' | 'codex',
  model: string
): Promise<string> {
  const events = loadTranscript(conversationId)
  const texts = events.filter(
    (e): e is typeof e & { text: string } =>
      (e.type === 'user.message' || e.type === 'text.done') && 'text' in e && !!e.text
  )
  const lastUserIdx = texts.map((e) => e.type).lastIndexOf('user.message')
  if (lastUserIdx === -1) throw new Error('No user message to replay')
  const question = texts[lastUserIdx].text
  const context = texts
    .slice(Math.max(0, lastUserIdx - 8), lastUserIdx)
    .map((e) => `${e.type === 'user.message' ? 'User' : 'Assistant'}: ${e.text.slice(0, 800)}`)
    .join('\n\n')

  const prompt =
    (context ? `Conversation so far:\n${context}\n\n` : '') +
    `Answer the user's latest message yourself, directly and completely:\n${question}`

  if (provider === 'claude') {
    const q = query({
      prompt,
      options: { model, maxTurns: 1, allowedTools: [], persistSession: false }
    })
    let text = ''
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const content = msg.message.content as unknown as { type: string; text?: string }[]
        text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
      }
      if (msg.type === 'result') break
    }
    return text || '(no answer)'
  }
  const codex = new Codex()
  const thread = codex.startThread({
    model,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    skipGitRepoCheck: true
  })
  const turn = await thread.run(prompt)
  return turn.finalResponse || '(no answer)'
}
