import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BusCore, BUS_INSTRUCTIONS, formatBusPrompt } from '../src/main/bus/BusCore'
import { createClaudeBusServer } from '../src/main/bus/claudeServer'
import { BusHttpServer } from '../src/main/bus/httpServer'
import { ClaudeProvider } from '../src/main/providers/claude/ClaudeProvider'
import { CodexProvider } from '../src/main/providers/codex/CodexProvider'
import type { SessionEvent } from '../src/shared/events'
import type { ProviderSession } from '../src/main/providers/types'

/**
 * The acid test: a Claude session asks a Codex session to review a file over
 * the chimera-bus (in-process MCP for Claude, localhost HTTP MCP for Codex),
 * and gets the review back via await_reply. Uses real provider sessions —
 * requires both `claude` login and `codex login` to be present.
 */
describe.skipIf(!process.env.CHIMERA_ACID)('chimera-bus cross-provider acid test', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chimera-acid-'))
  const buggyFile = join(dir, 'buggy.py')
  writeFileSync(
    buggyFile,
    [
      'def average(numbers):',
      '    total = 0',
      '    for n in numbers:',
      '        total += n',
      '    return total / len(numbers) + 1  # off-by-one: spurious +1',
      ''
    ].join('\n')
  )

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it(
    'claude asks codex for a review and receives the reply',
    async () => {
      const core = new BusCore()
      const busHttp = new BusHttpServer(core)
      await busHttp.start()

      const exchanges: { kind: string; from: string; to: string; text: string }[] = []
      core.onExchange = (msg, kind) => {
        exchanges.push({ kind, from: msg.from, to: msg.to, text: msg.text })
        console.log(`[bus:${kind}] ${msg.from.slice(0, 8)} -> ${msg.to.slice(0, 8)}:`,
          msg.text.slice(0, 120).replaceAll('\n', ' '))
      }

      const sessions = new Map<string, { session: ProviderSession; status: 'idle' | 'busy' }>()
      const track =
        (localId: string, log: SessionEvent[]) =>
        (ev: SessionEvent): void => {
          log.push(ev)
          const live = sessions.get(localId)
          if (live) {
            if (ev.type === 'turn.started') live.status = 'busy'
            if (ev.type === 'turn.completed') live.status = 'idle'
          }
          if (ev.type === 'tool.started') {
            console.log(`[${localId.slice(0, 8)}] tool: ${ev.toolName}`)
          }
          if (ev.type === 'tool.output') {
            console.log(
              `[${localId.slice(0, 8)}] tool done err=${ev.isError}:`,
              JSON.stringify(ev.output)?.slice(0, 160)
            )
          }
          if (ev.type === 'session.error') {
            console.log(`[${localId.slice(0, 8)}] SESSION ERROR: ${ev.message}`)
          }
          if (ev.type === 'turn.completed' && core.hasQueued(localId)) {
            inject(localId, core.drainInbox(localId))
          }
        }

      const inject = (localId: string, msgs: Parameters<typeof formatBusPrompt>[0][]): void => {
        const live = sessions.get(localId)
        if (!live || msgs.length === 0) return
        const text = msgs.map((m) => formatBusPrompt(m, 'peer session')).join('\n\n')
        void live.session.send({ text })
      }

      const claudeEvents: SessionEvent[] = []
      const codexEvents: SessionEvent[] = []
      const claudeId = 'claude-acid-a'
      const codexId = 'codex-acid-b'

      const claude = new ClaudeProvider().createSession(claudeId, {
        model: 'claude-sonnet-5',
        cwd: dir,
        systemPromptAppend: BUS_INSTRUCTIONS,
        mcpServers: [
          {
            name: 'chimera-bus',
            config: { type: 'sdk', instance: createClaudeBusServer(core, claudeId) }
          }
        ],
        onEvent: track(claudeId, claudeEvents)
      })
      sessions.set(claudeId, { session: claude, status: 'idle' })

      const codex = new CodexProvider().createSession(codexId, {
        model: 'gpt-5.6-sol',
        cwd: dir,
        // Required for bus replies: codex auto-cancels MCP calls in sandboxed
        // non-interactive mode (openai/codex#16685).
        permissionMode: 'bypassPermissions',
        systemPromptAppend: BUS_INSTRUCTIONS,
        mcpServers: [
          { name: 'chimera-bus', config: { type: 'http', url: busHttp.issueEndpoint(codexId) } }
        ],
        onEvent: track(codexId, codexEvents)
      })
      sessions.set(codexId, { session: codex, status: 'idle' })

      core.register(
        claudeId,
        () => ({
          localId: claudeId,
          conversationId: 'conv-a',
          title: 'Claude session',
          provider: 'claude',
          status: sessions.get(claudeId)!.status
        }),
        (msg) => inject(claudeId, [msg])
      )
      core.register(
        codexId,
        () => ({
          localId: codexId,
          conversationId: 'conv-b',
          title: 'Codex reviewer',
          provider: 'codex',
          status: sessions.get(codexId)!.status
        }),
        (msg) => inject(codexId, [msg])
      )

      // Kick off: Claude must delegate the review over the bus, not do it itself.
      const done = new Promise<void>((resolve) => {
        const orig = track(claudeId, claudeEvents)
        void orig // (tracker already installed; watch the log array instead)
        const check = setInterval(() => {
          const completions = claudeEvents.filter((e) => e.type === 'turn.completed')
          if (completions.length > 0 && sessions.get(claudeId)!.status === 'idle') {
            clearInterval(check)
            resolve()
          }
        }, 500)
      })

      await claude.send({
        text:
          `Follow these steps exactly, using the chimera-bus MCP tools:\n` +
          `1. Call list_sessions and note the session_id of the Codex reviewer.\n` +
          `2. Call send_to_session with that target_id, expects_reply: true, and text asking it to ` +
          `review the file ${buggyFile} for bugs and reply with its findings via reply_to_message.\n` +
          `3. Call await_reply with the message_id you got back and timeout_seconds: 180.\n` +
          `4. Summarize the reviewer's findings in one short paragraph.\n` +
          `Do NOT read or review the file yourself — the point is to delegate over the bus.`
      })

      await done
      // Let Codex's turn close out and any trailing events land.
      await new Promise((r) => setTimeout(r, 20_000))

      const histogram = (events: SessionEvent[]): Record<string, number> =>
        events.reduce<Record<string, number>>((acc, e) => {
          acc[e.type] = (acc[e.type] ?? 0) + 1
          return acc
        }, {})
      console.log('claude events:', JSON.stringify(histogram(claudeEvents)))
      console.log('codex events:', JSON.stringify(histogram(codexEvents)))

      const finalText = claudeEvents
        .filter((e): e is SessionEvent & { type: 'text.done' } => e.type === 'text.done')
        .map((e) => e.text)
        .join('\n')
      console.log('\n=== Claude final summary ===\n' + finalText)

      // The bus saw the outbound request and the reply.
      expect(exchanges.some((e) => e.kind === 'sent' && e.from === claudeId)).toBe(true)
      expect(exchanges.some((e) => e.kind === 'replied' && e.from === codexId)).toBe(true)
      // Codex actually processed a turn.
      expect(codexEvents.some((e) => e.type === 'turn.completed')).toBe(true)
      // Claude's summary reflects a real review of THAT file.
      expect(finalText.toLowerCase()).toMatch(/\+ ?1|off.by.one|average|len\(/)

      await claude.dispose()
      await codex.dispose()
      busHttp.stop()
    },
    300_000
  )
})
