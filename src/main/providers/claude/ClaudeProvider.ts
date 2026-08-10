import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { launchInTerminal } from '../../terminal'
import {
  query,
  type Options,
  type Query,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { ModelInfo } from '../../../shared/models'
import { MODEL_CATALOG } from '../../../shared/models'
import type { AuthStatus } from '../../../shared/ipc'
import type {
  ChatProvider,
  CreateSessionOptions,
  ProviderSession,
  UserInput
} from '../types'
import { ClaudeNormalizer } from './normalize'

/** Async-iterable push queue: the SDK's streaming-input channel for one session. */
class PushStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiters: ((value: IteratorResult<SDKUserMessage>) => void)[] = []
  private ended = false

  push(msg: SDKUserMessage): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: msg, done: false })
    else this.queue.push(msg)
  }

  end(): void {
    this.ended = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false })
        }
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      }
    }
  }
}

/**
 * Locate the Agent SDK's bundled CLI, translating asar paths to their unpacked
 * location when packaged. Returns undefined to let the SDK use its default in
 * dev (where resolution works normally).
 */
function findBundledClaudeCli(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve('@anthropic-ai/claude-agent-sdk-linux-x64/package.json')
    const bin = join(dirname(pkg), 'claude').replace('app.asar', 'app.asar.unpacked')
    if (existsSync(bin)) return bin
  } catch {
    // fall through
  }
  return undefined
}

class ClaudeSession implements ProviderSession {
  readonly localId: string
  providerSessionId: string | null = null
  status: 'idle' | 'busy' = 'idle'

  private readonly input = new PushStream()
  private readonly q: Query
  private readonly opts: CreateSessionOptions
  private currentTurnId = ''
  private disposed = false

  constructor(localId: string, opts: CreateSessionOptions, resumeSessionId?: string) {
    this.localId = localId
    this.opts = opts

    const mcpServers: NonNullable<Options['mcpServers']> = {}
    for (const server of opts.mcpServers ?? []) {
      if ('instance' in server.config) {
        mcpServers[server.name] = server.config.instance as never
      } else {
        mcpServers[server.name] = server.config as never
      }
    }

    const options: Options = {
      model: opts.model,
      cwd: opts.cwd ?? homedir(),
      // Packaged: the bundled CLI lives outside the asar archive; the SDK's own
      // resolution would point inside it, which cannot be spawned.
      pathToClaudeCodeExecutable: findBundledClaudeCli(),
      includePartialMessages: true,
      permissionMode: opts.permissionMode ?? 'default',
      // Permits switching the live session into bypassPermissions later; the
      // active permission mode still governs behavior.
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.systemPromptAppend },
      mcpServers,
      plugins: opts.plugins,
      resume: resumeSessionId,
      forkSession: opts.forkSession,
      canUseTool: async (toolName, input, { suggestions }) => {
        if (!this.opts.onPermissionRequest) {
          // Phase 1 stub: auto-allow, but log so it is visible during development.
          console.log(`[chimera] auto-allowing tool ${toolName}`)
          return { behavior: 'allow', updatedInput: input }
        }
        const decision = await this.opts.onPermissionRequest({
          requestId: randomUUID(),
          toolName,
          input,
          suggestions
        })
        if (decision.behavior === 'allow') {
          return { behavior: 'allow', updatedInput: decision.updatedInput ?? input }
        }
        return { behavior: 'deny', message: decision.message ?? 'Denied by user' }
      }
    }

    this.q = query({ prompt: this.input, options })
    void this.pump()
  }

  private async pump(): Promise<void> {
    const normalizer = new ClaudeNormalizer(this.localId, () => this.currentTurnId)
    try {
      for await (const msg of this.q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.providerSessionId = msg.session_id
        }
        for (const ev of normalizer.feed(msg)) {
          if (ev.type === 'turn.completed') this.status = 'idle'
          this.opts.onEvent(ev)
        }
      }
    } catch (err) {
      if (!this.disposed) {
        this.status = 'idle'
        this.opts.onEvent({
          type: 'session.error',
          localId: this.localId,
          message: err instanceof Error ? err.message : String(err),
          fatal: true
        })
      }
    }
  }

  async send(input: UserInput): Promise<void> {
    this.currentTurnId = randomUUID()
    this.status = 'busy'
    this.opts.onEvent({ type: 'turn.started', localId: this.localId, turnId: this.currentTurnId })

    let text = input.text
    const imageBlocks: Record<string, unknown>[] = []
    for (const att of input.attachments ?? []) {
      const isImage = att.mimeType.startsWith('image/')
      const isSmallEnough = ((): boolean => {
        try {
          return statSync(att.path).size < 5 * 1024 * 1024
        } catch {
          return false
        }
      })()
      if (isImage && isSmallEnough) {
        imageBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.mimeType,
            data: readFileSync(att.path).toString('base64')
          }
        })
      } else {
        // Non-image (or oversized) files: reference by path; the agent reads
        // them with its own tools.
        text += `\n\nAttached file: ${att.path}`
      }
    }

    const content =
      imageBlocks.length > 0 ? ([{ type: 'text', text }, ...imageBlocks] as never) : text
    this.input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null
    })
  }

  async interrupt(): Promise<void> {
    await this.q.interrupt()
    this.status = 'idle'
  }

  async setModel(model: string): Promise<void> {
    await this.q.setModel(model)
  }

  async setPermissionMode(
    mode: NonNullable<CreateSessionOptions['permissionMode']>
  ): Promise<void> {
    await this.q.setPermissionMode(mode)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.input.end()
    try {
      await this.q.interrupt()
    } catch {
      // session may already be finished
    }
  }
}

export class ClaudeProvider implements ChatProvider {
  readonly id = 'claude' as const

  listModels(): ModelInfo[] {
    return MODEL_CATALOG.claude
  }

  async authStatus(): Promise<AuthStatus> {
    if (process.env.ANTHROPIC_API_KEY) {
      return { state: 'authenticated', method: 'api-key' }
    }
    // CLI OAuth login writes a claudeAiOauth entry into ~/.claude/.credentials.json.
    // The file also holds unrelated MCP tokens, so key presence is the signal.
    const credPath = join(homedir(), '.claude', '.credentials.json')
    if (existsSync(credPath)) {
      try {
        const creds = JSON.parse(readFileSync(credPath, 'utf8')) as Record<string, unknown>
        if ('claudeAiOauth' in creds) {
          return { state: 'authenticated', method: 'oauth-cli', detail: 'Claude account login' }
        }
      } catch {
        // fall through to unauthenticated
      }
    }
    return {
      state: 'unauthenticated',
      detail: 'No Claude account login and no ANTHROPIC_API_KEY — use Log in'
    }
  }

  /** Bundled CLI shipped inside the Agent SDK's platform package. */
  private findClaudeCli(): string {
    try {
      const require = createRequire(import.meta.url)
      const pkg = require.resolve('@anthropic-ai/claude-agent-sdk-linux-x64/package.json')
      const bin = join(dirname(pkg), 'claude')
      if (existsSync(bin)) return bin
    } catch {
      // platform package not present; fall back to PATH
    }
    return 'claude'
  }

  async launchLogin(): Promise<void> {
    const cli = this.findClaudeCli()
    launchInTerminal(
      `echo 'Chimera: complete the Claude login in this window.'; "${cli}" /login; exec bash`
    )
  }

  createSession(localId: string, opts: CreateSessionOptions): ProviderSession {
    return new ClaudeSession(localId, opts)
  }

  resumeSession(
    localId: string,
    providerSessionId: string,
    opts: CreateSessionOptions
  ): ProviderSession {
    return new ClaudeSession(localId, opts, providerSessionId)
  }
}
