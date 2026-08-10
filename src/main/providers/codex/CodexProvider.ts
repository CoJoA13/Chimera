import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { Codex, type Thread, type ThreadEvent, type ThreadItem } from '@openai/codex-sdk'
import type { ModelInfo } from '../../../shared/models'
import { MODEL_CATALOG } from '../../../shared/models'
import type { AuthStatus } from '../../../shared/ipc'
import type { SessionEvent, Usage } from '../../../shared/events'
import type {
  ChatProvider,
  CreateSessionOptions,
  ProviderSession,
  UserInput
} from '../types'
import { launchInTerminal } from '../../terminal'

type CodexConfig = NonNullable<ConstructorParameters<typeof Codex>[0]>['config']

/** Translate Chimera MCP configs into codex `--config mcp_servers.*` overrides. */
function codexMcpConfig(opts: CreateSessionOptions): CodexConfig {
  const mcpServers: Record<string, unknown> = {}
  for (const server of opts.mcpServers ?? []) {
    const cfg = server.config
    if ('instance' in cfg) continue // in-process servers can't cross into the codex subprocess
    if (cfg.type === 'http' || cfg.type === 'sse') {
      mcpServers[server.name] = { url: cfg.url, ...(cfg.headers ? { http_headers: cfg.headers } : {}) }
    } else {
      mcpServers[server.name] = {
        command: cfg.command,
        ...(cfg.args ? { args: cfg.args } : {}),
        ...(cfg.env ? { env: cfg.env } : {})
      }
    }
  }
  return { mcp_servers: mcpServers } as CodexConfig
}

class CodexSession implements ProviderSession {
  readonly localId: string
  providerSessionId: string | null = null
  status: 'idle' | 'busy' = 'idle'

  private readonly codex: Codex
  private thread: Thread
  private model: string
  private currentTurnId = ''
  private abort: AbortController | null = null
  private preambleSent: boolean

  constructor(localId: string, private readonly opts: CreateSessionOptions, resumeThreadId?: string) {
    this.localId = localId
    this.model = opts.model
    this.codex = new Codex({ config: codexMcpConfig(opts) })
    this.thread = resumeThreadId
      ? this.codex.resumeThread(resumeThreadId, this.threadOptions())
      : this.codex.startThread(this.threadOptions())
    this.providerSessionId = resumeThreadId ?? null
    this.preambleSent = resumeThreadId !== undefined
  }

  private threadOptions() {
    // Codex has no interactive approvals through the SDK; the sandbox is the
    // permission mechanism. Known codex bug: MCP tool calls (incl. chimera-bus
    // replies) are auto-cancelled unless the sandbox is danger-full-access
    // (openai/codex#16685) — so bypassPermissions is what enables bus replies.
    const sandboxMode =
      this.opts.permissionMode === 'bypassPermissions'
        ? ('danger-full-access' as const)
        : this.opts.permissionMode === 'plan'
          ? ('read-only' as const)
          : ('workspace-write' as const)
    return {
      model: this.model,
      workingDirectory: this.opts.cwd ?? homedir(),
      sandboxMode,
      approvalPolicy: 'never' as const,
      skipGitRepoCheck: true
    }
  }

  private emit(ev: SessionEvent): void {
    this.opts.onEvent(ev)
  }

  private sendQueue: UserInput[] = []

  /** Codex cannot run concurrent turns on one thread — queue while busy. */
  async send(input: UserInput): Promise<void> {
    this.sendQueue.push(input)
    this.processQueue()
  }

  private processQueue(): void {
    if (this.status === 'busy') return
    const input = this.sendQueue.shift()
    if (!input) return
    this.currentTurnId = randomUUID()
    this.status = 'busy'
    this.emit({ type: 'turn.started', localId: this.localId, turnId: this.currentTurnId })

    let text = input.text
    // Codex has no system-prompt option: prepend bus/system instructions once.
    if (!this.preambleSent && this.opts.systemPromptAppend) {
      text = `<session-instructions>\n${this.opts.systemPromptAppend}\n</session-instructions>\n\n${text}`
      this.preambleSent = true
    }

    const images: string[] = []
    for (const att of input.attachments ?? []) {
      if (att.mimeType.startsWith('image/')) images.push(att.path)
      else text += `\n\nAttached file: ${att.path}`
    }
    const codexInput =
      images.length > 0
        ? [
            { type: 'text' as const, text },
            ...images.map((path) => ({ type: 'local_image' as const, path }))
          ]
        : text

    this.abort = new AbortController()
    void this.pump(codexInput)
  }

  private async pump(text: string | { type: 'text' | 'local_image'; [k: string]: unknown }[]): Promise<void> {
    const localId = this.localId
    const turnId = this.currentTurnId
    /** item id -> last emitted text length (for delta computation) */
    const emitted = new Map<string, number>()

    const itemEvents = (item: ThreadItem, completed: boolean): SessionEvent[] => {
      switch (item.type) {
        case 'agent_message':
        case 'reasoning': {
          const isText = item.type === 'agent_message'
          const blockId = `codex:${item.id}`
          const prev = emitted.get(item.id) ?? 0
          const events: SessionEvent[] = []
          if (item.text.length > prev) {
            events.push({
              type: isText ? 'text.delta' : 'thinking.delta',
              localId,
              turnId,
              blockId,
              text: item.text.slice(prev)
            })
            emitted.set(item.id, item.text.length)
          }
          if (completed) {
            events.push({
              type: isText ? 'text.done' : 'thinking.done',
              localId,
              turnId,
              blockId,
              text: item.text
            })
          }
          return events
        }
        case 'command_execution':
          return completed
            ? [
                {
                  type: 'tool.output',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  output: {
                    exit_code: item.exit_code,
                    output: item.aggregated_output?.slice(0, 4000)
                  },
                  isError: item.status === 'failed'
                }
              ]
            : [
                {
                  type: 'tool.started',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  toolName: 'shell',
                  input: { command: item.command }
                }
              ]
        case 'mcp_tool_call':
          return completed
            ? [
                {
                  type: 'tool.output',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  output: item.error ?? item.result,
                  isError: item.status === 'failed'
                }
              ]
            : [
                {
                  type: 'tool.started',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  toolName: `${item.server}.${item.tool}`,
                  input: item.arguments
                }
              ]
        case 'file_change':
          return completed
            ? [
                {
                  type: 'tool.output',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  output: { status: item.status, changes: item.changes },
                  isError: item.status === 'failed'
                }
              ]
            : [
                {
                  type: 'tool.started',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  toolName: 'apply_patch',
                  input: { changes: item.changes }
                }
              ]
        case 'web_search':
          return completed
            ? [
                {
                  type: 'tool.output',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  output: 'done',
                  isError: false
                }
              ]
            : [
                {
                  type: 'tool.started',
                  localId,
                  turnId,
                  toolUseId: item.id,
                  toolName: 'web_search',
                  input: { query: item.query }
                }
              ]
        case 'error':
          return [{ type: 'session.error', localId, message: item.message, fatal: false }]
        default:
          return []
      }
    }

    try {
      const { events } = await this.thread.runStreamed(text as never, {
        signal: this.abort?.signal
      })
      for await (const ev of events as AsyncGenerator<ThreadEvent>) {
        switch (ev.type) {
          case 'thread.started':
            this.providerSessionId = ev.thread_id
            this.emit({
              type: 'session.registered',
              localId,
              providerSessionId: ev.thread_id,
              model: this.model
            })
            break
          case 'item.started':
          case 'item.updated':
            for (const out of itemEvents(ev.item, false)) this.emit(out)
            break
          case 'item.completed':
            for (const out of itemEvents(ev.item, true)) this.emit(out)
            break
          case 'turn.completed': {
            const usage: Usage | undefined = ev.usage
              ? {
                  inputTokens: ev.usage.input_tokens,
                  outputTokens: ev.usage.output_tokens,
                  cacheReadTokens: ev.usage.cached_input_tokens
                }
              : undefined
            this.status = 'idle'
            this.emit({ type: 'turn.completed', localId, turnId, usage, isError: false })
            break
          }
          case 'turn.failed':
            this.status = 'idle'
            this.emit({
              type: 'turn.completed',
              localId,
              turnId,
              isError: true,
              errorMessage: ev.error.message
            })
            break
          case 'error':
            this.emit({ type: 'session.error', localId, message: ev.message, fatal: false })
            break
        }
      }
      if (this.status === 'busy') {
        // Stream ended without an explicit turn.completed (e.g. aborted).
        this.status = 'idle'
        this.emit({ type: 'turn.completed', localId, turnId, isError: false })
      }
      this.processQueue()
    } catch (err) {
      this.status = 'idle'
      const message = err instanceof Error ? err.message : String(err)
      if (this.abort?.signal.aborted) {
        this.emit({ type: 'turn.completed', localId, turnId, isError: false })
      } else {
        this.emit({ type: 'session.error', localId, message, fatal: false })
        this.emit({ type: 'turn.completed', localId, turnId, isError: true, errorMessage: message })
      }
      this.processQueue()
    }
  }

  async interrupt(): Promise<void> {
    this.abort?.abort()
  }

  async setModel(model: string): Promise<void> {
    this.model = model
    // Applies on the next turn: recreate the thread handle with new options.
    if (this.providerSessionId) {
      this.thread = this.codex.resumeThread(this.providerSessionId, this.threadOptions())
      this.preambleSent = true
    } else {
      this.thread = this.codex.startThread(this.threadOptions())
    }
  }

  async setPermissionMode(): Promise<void> {
    // Codex approvals are fixed at thread start (sandboxed, no prompts).
  }

  async dispose(): Promise<void> {
    this.abort?.abort()
  }
}

export class CodexProvider implements ChatProvider {
  readonly id = 'codex' as const

  listModels(): ModelInfo[] {
    return MODEL_CATALOG.codex
  }

  private findCodexCli(): string | null {
    const candidates = [
      join(homedir(), '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/usr/bin/codex'
    ]
    return candidates.find((c) => existsSync(c)) ?? null
  }

  async authStatus(): Promise<AuthStatus> {
    const cli = this.findCodexCli()
    if (!cli) return { state: 'cli-missing', detail: 'codex CLI not found — npm i -g @openai/codex' }
    const loggedIn = await new Promise<boolean>((resolve) => {
      execFile(cli, ['login', 'status'], { timeout: 10_000 }, (err) => resolve(!err))
    })
    if (loggedIn) return { state: 'authenticated', method: 'oauth-cli', detail: 'ChatGPT login' }
    return { state: 'unauthenticated', detail: 'Run codex login' }
  }

  async launchLogin(): Promise<void> {
    const cli = this.findCodexCli() ?? 'codex'
    launchInTerminal(
      `echo 'Chimera: complete the ChatGPT login in this window.'; "${cli}" login; exec bash`
    )
  }

  createSession(localId: string, opts: CreateSessionOptions): ProviderSession {
    return new CodexSession(localId, opts)
  }

  resumeSession(
    localId: string,
    providerSessionId: string,
    opts: CreateSessionOptions
  ): ProviderSession {
    return new CodexSession(localId, opts, providerSessionId)
  }
}
