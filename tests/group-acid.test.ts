import { describe, it, expect } from 'vitest'
import { SessionManager } from '../src/main/ipc/sessions'
import { createConversation } from '../src/main/store/conversations'
import { loadTranscript } from '../src/main/store/transcript'
import type { SessionEvent } from '../src/shared/events'

/**
 * Group-chat acid test — runs the REAL SessionManager (electron stubbed):
 * two Claude members answer a shared question, then an @-mention verifies the
 * targeted member received room history (it must know what the other said).
 * Requires Claude login; spends a few cents. Gate: CHIMERA_ACID=1.
 */
describe.skipIf(!process.env.CHIMERA_ACID)('group chat acid test', () => {
  it(
    'members share room history and @-mentions target correctly',
    async () => {
      const manager = new SessionManager(() => null)

      const group = createConversation('claude', 'claude-haiku-4-5-20251001', {
        title: 'Test Panel',
        kind: 'group'
      })
      const alpha = createConversation('claude', 'claude-haiku-4-5-20251001', {
        title: 'Alpha',
        groupId: group.id
      })
      const bravo = createConversation('claude', 'claude-haiku-4-5-20251001', {
        title: 'Bravo',
        groupId: group.id
      })
      manager.registerConversation(alpha.id)
      manager.registerConversation(bravo.id)

      const transcript = (): SessionEvent[] => loadTranscript(group.id)
      const waitFor = async (pred: () => boolean, ms: number): Promise<void> => {
        const deadline = Date.now() + ms
        while (Date.now() < deadline) {
          if (pred()) return
          await new Promise((r) => setTimeout(r, 1000))
        }
        throw new Error('timeout waiting for condition')
      }
      const doneTurns = (): number =>
        transcript().filter((e) => e.type === 'turn.completed').length
      const textsFrom = (name: string): string[] =>
        transcript()
          .filter(
            (e): e is SessionEvent & { type: 'text.done' } =>
              e.type === 'text.done' && (e as { memberName?: string }).memberName === name
          )
          .map((e) => e.text)

      // Round 1: plain message — both members must answer.
      await manager.groupSend(
        group.id,
        'Introduce yourselves in one sentence each. Alpha: your favorite color is crimson. ' +
          'Bravo: your favorite color is turquoise. State your own name and color only.'
      )
      await waitFor(() => doneTurns() >= 2, 120_000)

      expect(textsFrom('Alpha').join(' ').toLowerCase()).toContain('crimson')
      expect(textsFrom('Bravo').join(' ').toLowerCase()).toContain('turquoise')
      console.log('round 1 OK — both members answered with attribution')

      // Round 2: @-mention Bravo with a question only room history can answer.
      const turnsBefore = doneTurns()
      const alphaTextsBefore = textsFrom('Alpha').length
      await manager.groupSend(
        group.id,
        '@Bravo without guessing: what favorite color did Alpha state earlier? Answer with just the color.'
      )
      await waitFor(() => doneTurns() >= turnsBefore + 1, 120_000)
      // Give any stray second responder a moment to appear (it must not).
      await new Promise((r) => setTimeout(r, 5000))

      // Only Bravo responded...
      expect(textsFrom('Alpha').length).toBe(alphaTextsBefore)
      // ...and it knew Alpha's color from room history.
      const bravoAnswer = textsFrom('Bravo').at(-1) ?? ''
      console.log('Bravo answered:', bravoAnswer)
      expect(bravoAnswer.toLowerCase()).toContain('crimson')

      await manager.disposeAll()
    },
    300_000
  )
})
