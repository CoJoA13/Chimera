import { query } from '@anthropic-ai/claude-agent-sdk'
import { Codex } from '@openai/codex-sdk'
import type { ProviderId } from '../shared/models'

export interface Verdict {
  verdict: 'corroborated' | 'disputed' | 'uncertain'
  note: string
  verifier: ProviderId
}

const VERIFY_PROMPT = (claim: string): string =>
  'You are a skeptical fact-checker from a different AI model. Review this assistant answer for factual errors, ' +
  'unsupported claims, or misleading statements. Reply with ONLY a JSON object: ' +
  '{"verdict":"corroborated"|"disputed"|"uncertain","note":"one sentence — if disputed, say exactly what is wrong"}\n\n' +
  `ANSWER TO CHECK:\n${claim.slice(0, 4000)}`

function parseVerdict(raw: string, verifier: ProviderId): Verdict | null {
  const match = /\{[\s\S]*\}/.exec(raw)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { verdict?: string; note?: string }
    if (!['corroborated', 'disputed', 'uncertain'].includes(parsed.verdict ?? '')) return null
    return {
      verdict: parsed.verdict as Verdict['verdict'],
      note: (parsed.note ?? '').slice(0, 300),
      verifier
    }
  } catch {
    return null
  }
}

/** Check a claim with the OTHER provider. Returns null on any failure — verification is best-effort. */
export async function crossVerify(claim: string, answeredBy: ProviderId): Promise<Verdict | null> {
  const verifier: ProviderId = answeredBy === 'claude' ? 'codex' : 'claude'
  try {
    if (verifier === 'claude') {
      const q = query({
        prompt: VERIFY_PROMPT(claim),
        options: {
          model: 'claude-haiku-4-5-20251001',
          maxTurns: 1,
          allowedTools: [],
          persistSession: false
        }
      })
      let text = ''
      for await (const msg of q) {
        if (msg.type === 'assistant') {
          const content = msg.message.content as unknown as { type: string; text?: string }[]
          text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ')
        }
        if (msg.type === 'result') break
      }
      return parseVerdict(text, verifier)
    }
    const codex = new Codex()
    const thread = codex.startThread({
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      skipGitRepoCheck: true
    })
    const turn = await thread.run(VERIFY_PROMPT(claim))
    return parseVerdict(turn.finalResponse, verifier)
  } catch {
    return null
  }
}
