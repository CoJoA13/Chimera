import type { WebContents } from 'electron'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../../shared/events'
import type { PermissionDecision, ProviderSession, McpServerRuntimeConfig } from '../providers/types'
import { getProvider } from '../providers/registry'
import { normalizeStoredHistory } from '../providers/claude/normalize'
import {
  getConversation,
  listConversations as listAllConversations,
  setProviderSessionId,
  touchConversation,
  setConversationModel,
  setConversationPermissionMode
} from '../store/conversations'
import { enabledMcpForConversation } from '../store/mcp'
import { isAlwaysAllowed, addAlwaysAllowRule } from '../store/permissions'
import { enabledPluginPaths } from '../store/plugins'
import { recordBusMessage } from '../store/busHistory'
import { BusCore, BUS_INSTRUCTIONS, formatBusPrompt, type BusMessage } from '../bus/BusCore'
import { createClaudeBusServer } from '../bus/claudeServer'
import { BusHttpServer } from '../bus/httpServer'

/**
 * Coalesces text/thinking deltas per block on a ~16ms tick so token-level
 * streaming doesn't flood IPC. Any non-delta event flushes buffers first to
 * preserve ordering.
 */
class EventSender {
  private buffers = new Map<string, SessionEvent & { type: 'text.delta' | 'thinking.delta' }>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly getTarget: () => WebContents | null) {}

  push(ev: SessionEvent): void {
    if (ev.type === 'text.delta' || ev.type === 'thinking.delta') {
      const key = `${ev.type}:${ev.blockId}`
      const existing = this.buffers.get(key)
      if (existing) existing.text += ev.text
      else this.buffers.set(key, { ...ev })
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null
          this.flush()
        }, 16)
      }
      return
    }
    this.flush()
    this.sendRaw(ev)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const ev of this.buffers.values()) this.sendRaw(ev)
    this.buffers.clear()
  }

  private sendRaw(ev: SessionEvent): void {
    const target = this.getTarget()
    if (target && !target.isDestroyed()) target.send('session:event', ev)
  }
}

interface LiveSession {
  session: ProviderSession
  sender: EventSender
  conversationId: string
  status: 'idle' | 'busy'
}

interface PendingPermission {
  resolve: (d: PermissionDecision) => void
  toolName: string
}

export class SessionManager {
  /** Live sessions, keyed by conversationId (session localId === conversationId). */
  private sessions = new Map<string, LiveSession>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private readonly bus = new BusCore()
  private readonly busHttp = new BusHttpServer(this.bus)

  constructor(private readonly getTarget: () => WebContents | null) {
    // Bus cards: 'sent' renders the out-card now and the in-card at delivery
    // (the target session may need to be auto-started first); 'replied'
    // resolves a live await, so both sides are up — render both.
    this.bus.onExchange = (msg, kind) => {
      recordBusMessage(msg, kind)
      const card = {
        type: 'bus.message' as const,
        from: msg.from,
        to: msg.to,
        messageId: msg.messageId,
        inReplyTo: msg.inReplyTo,
        text: msg.text
      }
      this.sessions.get(msg.from)?.sender.push({ ...card, localId: msg.from, direction: 'out' })
      if (kind === 'replied') {
        this.sessions.get(msg.to)?.sender.push({ ...card, localId: msg.to, direction: 'in' })
      }
    }
    // Live await-reply indicator for the UI.
    this.bus.onAwaitChange = (localId, peerLocalId) => {
      this.sessions.get(localId)?.sender.push({
        type: 'bus.status',
        localId,
        status: peerLocalId ? 'awaiting' : 'idle',
        peerLocalId: peerLocalId ?? undefined
      })
    }
  }

  /**
   * Put every conversation on the bus directory so peers can discover and
   * message it even when its session isn't running — delivery auto-starts it.
   * Call at app startup and whenever a conversation is created.
   */
  registerConversation(conversationId: string): void {
    const conversation = getConversation(conversationId)
    if (!conversation) return
    this.bus.register(
      conversationId,
      () => ({
        localId: conversationId,
        conversationId,
        title: getConversation(conversationId)?.title ?? 'Untitled',
        provider: conversation.provider,
        status: this.sessions.get(conversationId)?.status ?? 'idle'
      }),
      (msg) => {
        void (async () => {
          await this.startForConversation(conversationId)
          this.injectBusMessages(conversationId, [msg])
        })()
      }
    )
  }

  initBusDirectory(): void {
    for (const conversation of listAllConversations()) {
      this.registerConversation(conversation.id)
    }
  }

  unregisterConversation(conversationId: string): void {
    this.bus.unregister(conversationId)
  }

  /** Inject queued/incoming bus messages as a synthetic user turn. */
  private injectBusMessages(conversationId: string, messages: BusMessage[]): void {
    const live = this.sessions.get(conversationId)
    if (!live || messages.length === 0) return
    for (const msg of messages) {
      live.sender.push({
        type: 'bus.message',
        localId: conversationId,
        direction: 'in',
        from: msg.from,
        to: msg.to,
        messageId: msg.messageId,
        inReplyTo: msg.inReplyTo,
        text: msg.text
      })
    }
    const text = messages
      .map((msg) => formatBusPrompt(msg, getConversation(msg.from)?.title ?? 'peer session'))
      .join('\n\n')
    void live.session.send({ text })
  }

  /** Start (or return the already-live) session for a conversation. */
  async startForConversation(
    conversationId: string
  ): Promise<{ localId: string; resumed: boolean }> {
    if (this.sessions.has(conversationId)) {
      return { localId: conversationId, resumed: false }
    }

    const conversation = getConversation(conversationId)
    if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`)

    const provider = getProvider(conversation.provider)
    // Stable identity: the session's localId IS the conversation id, so bus
    // registrations and renderer routing survive restarts.
    const localId = conversationId
    const sender = new EventSender(this.getTarget)

    const mcpServers: McpServerRuntimeConfig[] = enabledMcpForConversation(conversationId).map(
      (record) => ({ name: record.name, config: record.transport })
    )

    // Every session gets the chimera-bus: in-process for Claude, HTTP for Codex.
    if (conversation.provider === 'claude') {
      mcpServers.push({
        name: 'chimera-bus',
        config: { type: 'sdk', instance: createClaudeBusServer(this.bus, localId) }
      })
    } else {
      await this.busHttp.start()
      mcpServers.push({
        name: 'chimera-bus',
        config: { type: 'http', url: this.busHttp.issueEndpoint(localId) }
      })
    }

    const opts = {
      model: conversation.model,
      cwd: conversation.cwd ?? undefined,
      permissionMode: conversation.permissionMode,
      systemPromptAppend: BUS_INSTRUCTIONS,
      mcpServers,
      plugins: conversation.provider === 'claude' ? enabledPluginPaths() : undefined,
      onEvent: (ev: SessionEvent) => {
        if (ev.type === 'session.registered') {
          setProviderSessionId(conversationId, ev.providerSessionId)
        }
        const live = this.sessions.get(localId)
        if (live) {
          if (ev.type === 'turn.started') live.status = 'busy'
          if (ev.type === 'turn.completed' || (ev.type === 'session.error' && ev.fatal)) {
            live.status = 'idle'
          }
        }
        sender.push(ev)
        // A completed turn may unblock queued bus messages.
        if (ev.type === 'turn.completed' && this.bus.hasQueued(localId)) {
          this.injectBusMessages(localId, this.bus.drainInbox(localId))
        }
      },
      onPermissionRequest: async (permReq: {
        requestId: string
        toolName: string
        input: Record<string, unknown>
        suggestions?: unknown
      }): Promise<PermissionDecision> => {
        if (isAlwaysAllowed(permReq.toolName)) {
          return { behavior: 'allow' }
        }
        return new Promise<PermissionDecision>((resolve) => {
          this.pendingPermissions.set(permReq.requestId, { resolve, toolName: permReq.toolName })
          sender.push({
            type: 'permission.request',
            localId,
            requestId: permReq.requestId,
            toolName: permReq.toolName,
            input: permReq.input,
            suggestions: permReq.suggestions
          })
        })
      }
    }

    const session = conversation.providerSessionId
      ? provider.resumeSession(localId, conversation.providerSessionId, opts)
      : provider.createSession(localId, opts)

    this.sessions.set(localId, { session, sender, conversationId, status: 'idle' })
    // Ensure the directory entry exists (idempotent — covers conversations
    // created before initBusDirectory learned about them).
    this.registerConversation(conversationId)

    return { localId, resumed: conversation.providerSessionId !== null }
  }

  /** Replay stored history for a conversation as normalized events. */
  async history(conversationId: string): Promise<SessionEvent[]> {
    const conversation = getConversation(conversationId)
    if (!conversation?.providerSessionId) return []
    try {
      const messages = await getSessionMessages(conversation.providerSessionId)
      return normalizeStoredHistory(conversationId, messages)
    } catch {
      return []
    }
  }

  /** Dispose and restart a conversation's session (used after MCP changes). */
  async restart(conversationId: string): Promise<{ localId: string; resumed: boolean }> {
    await this.dispose(conversationId)
    return this.startForConversation(conversationId)
  }

  private get(localId: string): LiveSession {
    const live = this.sessions.get(localId)
    if (!live) throw new Error(`Unknown session: ${localId}`)
    return live
  }

  async send(localId: string, text: string): Promise<void> {
    const live = this.get(localId)
    touchConversation(live.conversationId)
    await live.session.send({ text })
  }

  async interrupt(localId: string): Promise<void> {
    await this.get(localId).session.interrupt()
  }

  async setModel(localId: string, model: string): Promise<void> {
    const live = this.get(localId)
    await live.session.setModel(model)
    setConversationModel(live.conversationId, model)
  }

  /**
   * Change a conversation's permission mode. Claude applies live; Codex maps
   * it to the sandbox, which is fixed at thread start — restart with resume.
   */
  async setPermissionMode(
    conversationId: string,
    mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  ): Promise<void> {
    setConversationPermissionMode(conversationId, mode)
    const live = this.sessions.get(conversationId)
    if (!live) return
    const conversation = getConversation(conversationId)
    if (conversation?.provider === 'claude') {
      await live.session.setPermissionMode(mode)
    } else {
      await this.restart(conversationId)
    }
  }

  respondPermission(requestId: string, behavior: 'allow' | 'deny', always?: boolean): void {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return
    this.pendingPermissions.delete(requestId)
    if (behavior === 'allow' && always) addAlwaysAllowRule(pending.toolName)
    pending.resolve(behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny' })
  }

  /** Stop a live session. The conversation stays on the bus directory. */
  async dispose(localId: string): Promise<void> {
    const live = this.sessions.get(localId)
    if (!live) return
    this.sessions.delete(localId)
    this.busHttp.revoke(localId)
    live.sender.flush()
    await live.session.dispose()
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.dispose(id)))
  }
}
