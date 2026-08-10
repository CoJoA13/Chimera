import { query } from '@anthropic-ai/claude-agent-sdk'

/** One-shot Haiku helper used for titles and briefs. */
async function haikuOneShot(prompt: string): Promise<string | null> {
  try {
    const q = query({
      prompt,
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
        text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim()
      }
      if (msg.type === 'result') break
    }
    return text || null
  } catch {
    return null
  }
}

/** Compose the while-you-were-away digest from raw activity lines. */
export async function summarizeBrief(lines: string[]): Promise<string | null> {
  if (lines.length === 0) return null
  return haikuOneShot(
    'Summarize this app activity log as a short "while you were away" brief for the user: ' +
      'max 5 bullet points, most important first, plain language, no preamble.\n\n' +
      lines.slice(0, 60).join('\n')
  )
}

/** Generate a short conversation title from the first message via Haiku. */
export async function generateTitle(firstMessage: string): Promise<string | null> {
  try {
    const q = query({
      prompt:
        'Reply with ONLY a 3-6 word title (no quotes, no punctuation at the end) summarizing this chat message:\n\n' +
        firstMessage.slice(0, 600),
      options: {
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 1,
        allowedTools: [],
        persistSession: false
      }
    })
    let title = ''
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const content = msg.message.content as unknown as { type: string; text?: string }[]
        title = content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ')
          .trim()
      }
      if (msg.type === 'result') break
    }
    if (!title || title.length > 60 || /not logged in/i.test(title)) return null
    return title
  } catch {
    return null
  }
}
