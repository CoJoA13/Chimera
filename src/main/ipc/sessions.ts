import { BrowserWindow, Notification } from 'electron'
import type { WebContents } from 'electron'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../../shared/events'
import type { PermissionDecision, ProviderSession, McpServerRuntimeConfig } from '../providers/types'
import { getProvider } from '../providers/registry'
import { normalizeStoredHistory } from '../providers/claude/normalize'
import {
  getConversation,
  listAllConversationRecords,
  listGroupMembers,
  getMemberLastSeq,
  setMemberLastSeq,
  setProviderSessionId,
  touchConversation,
  setConversationModel,
  setConversationPermissionMode,
  clearForkPending,
  renameConversation
} from '../store/conversations'
import { generateTitle } from '../titles'
import { crossVerify } from '../verifier'
import { distilledPluginPath } from '../store/skills'
import { logActivity } from '../store/activity'
import { enabledMcpForConversation } from '../store/mcp'
import { isAlwaysAllowed, addAlwaysAllowRule } from '../store/permissions'
import { enabledPluginPaths } from '../store/plugins'
import { recordBusMessage } from '../store/busHistory'
import { readMemory, MEMORY_INSTRUCTIONS } from '../store/memory'
import { recordSpend, todaySpend } from '../store/spend'
import { getSetting } from '../store/settings'
import {
  recordTranscriptEvent,
  loadTranscript,
  loadTranscriptSince,
  latestSeq
} from '../store/transcript'
import type { UserInput } from '../providers/types'
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

  constructor(
    private readonly getTarget: () => WebContents | null,
    /** Persist renderable events for history replay. */
    private readonly record?: (ev: SessionEvent) => void
  ) {}

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
    this.record?.(ev)
    const target = this.getTarget()
    if (target && !target.isDestroyed()) target.send('session:event', ev)
  }
}

interface LiveSession {
  session: ProviderSession
  sender: EventSender
  conversationId: string
  status: 'idle' | 'busy'
  /** Final text of the in-flight turn, for auto-verification. */
  lastAnswer?: string
}

interface PendingPermission {
  resolve: (d: PermissionDecision) => void
  toolName: string
  conversationId: string
}

/** The bus identity of the app itself — conferences and user-directed reports. */
export const CONTROL_ROOM_ID = 'control-room'

export interface ConferenceReply {
  conversationId: string
  status: 'replied' | 'timeout' | 'error'
  text?: string
  error?: string
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
    this.bus.onAwaitChange = (localId, peerLocalIds) => {
      this.sessions.get(localId)?.sender.push({
        type: 'bus.status',
        localId,
        status: peerLocalIds.length > 0 ? 'awaiting' : 'idle',
        peerLocalId: peerLocalIds[0],
        peerCount: peerLocalIds.length
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
      () => {
        const current = getConversation(conversationId)
        return {
          localId: conversationId,
          conversationId,
          title: current?.title ?? 'Untitled',
          provider: conversation.provider,
          status: this.sessions.get(conversationId)?.status ?? 'idle',
          persona: current?.personaName
            ? `${current.personaName}${current.personaPrompt ? ` — ${current.personaPrompt.slice(0, 120)}` : ''}`
            : undefined
        }
      },
      (msg) => {
        void (async () => {
          await this.startForConversation(conversationId)
          this.injectBusMessages(conversationId, [msg])
        })()
      }
    )
  }

  /** Members' in-flight turns per group — drives the group stream's turn events. */
  private groupTurns = new Map<string, Set<string>>()

  initBusDirectory(): void {
    for (const conversation of listAllConversationRecords()) {
      // Groups have no provider session of their own; members register individually.
      if (conversation.kind !== 'group') this.registerConversation(conversation.id)
    }
    // The control room is a first-class bus participant: conference questions
    // originate here, and agents can send reports directly to the user.
    this.bus.register(
      CONTROL_ROOM_ID,
      () => ({
        localId: CONTROL_ROOM_ID,
        conversationId: CONTROL_ROOM_ID,
        title: 'Control Room',
        provider: 'user',
        status: 'idle',
        persona: "The user's console — send reports or questions for the human here."
      }),
      (msg) => {
        const target = this.getTarget()
        if (target && !target.isDestroyed()) {
          target.send('controlroom:event', {
            type: 'inbound',
            fromId: msg.from,
            messageId: msg.messageId,
            text: msg.text,
            expectsReply: msg.expectsReply
          })
        }
        logActivity(
          'report',
          `${getConversation(msg.from)?.title ?? 'An agent'} → Control Room: ${msg.text}`,
          msg.from
        )
        this.notify(
          msg.from,
          'Message for the Control Room',
          `${getConversation(msg.from)?.title ?? 'An agent'}: ${msg.text}`
        )
      }
    )
  }

  /**
   * App-orchestrated conference: fan a question out to selected conversations,
   * collect replies under one timeout, optionally hand the results to a
   * synthesizer conversation. Progress streams over 'controlroom:event'.
   */
  async conference(
    question: string,
    targetConversationIds: string[],
    synthesizerId: string | null,
    timeoutSeconds: number
  ): Promise<ConferenceReply[]> {
    const target = this.getTarget()
    const progress = (payload: unknown): void => {
      if (target && !target.isDestroyed()) target.send('controlroom:event', payload)
    }

    // Ensure every participant is live, then fan out.
    const sent: { conversationId: string; messageId?: string; error?: string }[] = []
    for (const convId of targetConversationIds) {
      try {
        await this.startForConversation(convId)
        const messageId = this.bus.send(
          CONTROL_ROOM_ID,
          convId,
          `CONFERENCE QUESTION from the user: ${question}`,
          true
        )
        sent.push({ conversationId: convId, messageId })
        progress({ type: 'conference.sent', conversationId: convId })
      } catch (err) {
        sent.push({
          conversationId: convId,
          error: err instanceof Error ? err.message : String(err)
        })
        progress({ type: 'conference.error', conversationId: convId })
      }
    }

    const awaited = sent.filter((s) => s.messageId)
    const results = await this.bus.awaitReplies(
      CONTROL_ROOM_ID,
      awaited.map((s) => s.messageId!),
      timeoutSeconds
    )

    const replies: ConferenceReply[] = sent.map((s) => {
      if (!s.messageId) return { conversationId: s.conversationId, status: 'error', error: s.error }
      const result = results.find((r) => r.messageId === s.messageId)?.result
      if (!result) return { conversationId: s.conversationId, status: 'timeout' }
      return result.status === 'replied'
        ? { conversationId: s.conversationId, status: 'replied', text: result.text }
        : { conversationId: s.conversationId, status: result.status, error: result.error }
    })

    if (synthesizerId) {
      const answers = replies
        .map((r) => {
          const title = getConversation(r.conversationId)?.title ?? r.conversationId
          return r.status === 'replied'
            ? `--- Answer from ${title} ---\n${r.text}`
            : `--- ${title}: no answer (${r.status}) ---`
        })
        .join('\n\n')
      try {
        await this.startForConversation(synthesizerId)
        this.bus.send(
          CONTROL_ROOM_ID,
          synthesizerId,
          `The user ran a conference. Question: "${question}"\n\n${answers}\n\nSynthesize these answers for the user: where do they agree, where do they conflict, and what is your recommendation?`,
          false
        )
        progress({ type: 'conference.synthesis', conversationId: synthesizerId })
      } catch {
        // synthesis is best-effort
      }
    }
    return replies
  }

  unregisterConversation(conversationId: string): void {
    this.bus.unregister(conversationId)
  }

  /** Desktop notification for events that land while the window is unfocused. */
  private notify(conversationId: string, title: string, body: string): void {
    const target = this.getTarget()
    if (!target || target.isDestroyed() || !Notification.isSupported()) return
    const win = BrowserWindow.fromWebContents(target)
    if (!win || win.isFocused()) return
    const notification = new Notification({
      title,
      body: body.length > 120 ? `${body.slice(0, 120)}…` : body
    })
    notification.on('click', () => {
      win.show()
      win.focus()
      target.send('ui:focusConversation', conversationId)
    })
    notification.show()
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
    const fromLabel = (from: string): string => {
      if (from === CONTROL_ROOM_ID) return "Control Room (the user's console)"
      const conv = getConversation(from)
      if (!conv) return 'peer session'
      return conv.personaName ? `${conv.title} (${conv.personaName})` : conv.title
    }
    const text = messages.map((msg) => formatBusPrompt(msg, fromLabel(msg.from))).join('\n\n')
    const fromTitle = getConversation(messages[0].from)?.title ?? 'a peer session'
    this.notify(
      conversationId,
      `Agent message for "${getConversation(conversationId)?.title ?? 'conversation'}"`,
      `From ${fromTitle}: ${messages[0].text}`
    )
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
    if (conversation.kind === 'group') {
      throw new Error('Group conversations have no session of their own — message the group instead')
    }

    const provider = getProvider(conversation.provider)
    // Stable identity: the session's localId IS the conversation id, so bus
    // registrations and renderer routing survive restarts.
    const localId = conversationId
    // Group members stream into their group's transcript with attribution.
    const groupId = conversation.groupId
    const streamId = groupId ?? conversationId
    const memberName = groupId ? conversation.title : undefined
    const sender = new EventSender(this.getTarget, (ev) => recordTranscriptEvent(streamId, ev))

    /** Re-key a member event onto the group stream (ids prefixed, name attached). */
    const toGroupEvent = (ev: SessionEvent): SessionEvent | null => {
      if (!groupId) return ev
      switch (ev.type) {
        case 'session.registered':
          return null
        case 'turn.started': {
          const turns = this.groupTurns.get(groupId) ?? new Set()
          turns.add(conversationId)
          this.groupTurns.set(groupId, turns)
          return turns.size === 1 ? { ...ev, localId: groupId, memberName } : null
        }
        case 'turn.completed': {
          const turns = this.groupTurns.get(groupId) ?? new Set()
          turns.delete(conversationId)
          return { ...ev, localId: groupId, memberName, groupDone: turns.size === 0 }
        }
        case 'text.delta':
        case 'text.done':
        case 'thinking.delta':
        case 'thinking.done':
          return { ...ev, localId: groupId, memberName, blockId: `${conversationId}:${ev.blockId}` }
        case 'tool.started':
        case 'tool.output':
          return {
            ...ev,
            localId: groupId,
            memberName,
            toolUseId: `${conversationId}:${ev.toolUseId}`
          }
        case 'bus.message':
        case 'session.error':
          return { ...ev, localId: groupId, memberName }
        case 'permission.request':
        case 'bus.status':
          return { ...ev, localId: groupId }
        default:
          return null
      }
    }

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

    const personaAppend = conversation.personaName
      ? `\n\nPERSONA: In this app you are "${conversation.personaName}". ${conversation.personaPrompt ?? ''} When communicating over the chimera-bus, act and speak in this role.`
      : ''
    const memory = readMemory(conversationId)
    const memoryAppend =
      `\n\n${MEMORY_INSTRUCTIONS}` +
      (memory ? `\n\nYOUR CURRENT MEMORY:\n${memory}` : '')
    let groupAppend = ''
    if (groupId) {
      const group = getConversation(groupId)
      const others = listGroupMembers(groupId)
        .filter((m) => m.id !== conversationId)
        .map((m) => m.title)
        .join(', ')
      groupAppend = `\n\nGROUP CHAT: You are "${conversation.title}" in the group chat "${group?.title ?? 'Group'}" together with: ${others || 'nobody else yet'}. Messages arrive with recent room history for context. Respond in character, keep it concise, speak only for yourself, and don't repeat what the room has already said.`
    }
    const opts = {
      model: conversation.model,
      cwd: conversation.cwd ?? undefined,
      permissionMode: conversation.permissionMode,
      forkSession: conversation.forkPending || undefined,
      systemPromptAppend: BUS_INSTRUCTIONS + personaAppend + groupAppend + memoryAppend,
      mcpServers,
      plugins:
        conversation.provider === 'claude'
          ? [...enabledPluginPaths(), { type: 'local' as const, path: distilledPluginPath() }]
          : undefined,
      onEvent: (ev: SessionEvent) => {
        if (ev.type === 'session.registered') {
          setProviderSessionId(conversationId, ev.providerSessionId)
          if (conversation.forkPending) clearForkPending(conversationId)
        }
        // Track the turn's final answer text for auto-verification.
        if (ev.type === 'text.done') {
          const live = this.sessions.get(localId)
          if (live) live.lastAnswer = ev.text
        }
        const live = this.sessions.get(localId)
        if (live) {
          if (ev.type === 'turn.started') live.status = 'busy'
          if (ev.type === 'turn.completed' || (ev.type === 'session.error' && ev.fatal)) {
            live.status = 'idle'
          }
        }
        // Zombie recovery: a fatally-errored session is torn down so the next
        // send lazily restarts it with resume.
        if (ev.type === 'session.error' && ev.fatal) {
          void this.dispose(localId)
        }
        if (ev.type === 'turn.completed') {
          if (ev.costUsd) recordSpend(conversationId, ev.costUsd)
          // Auto-verification: check the answer with the OTHER provider, async.
          const live2 = this.sessions.get(localId)
          const answer = live2?.lastAnswer
          if (live2) live2.lastAnswer = undefined
          const current = getConversation(conversationId)
          if (current?.autoVerify && !ev.isError && answer && answer.length > 150) {
            void crossVerify(answer, current.provider).then((verdict) => {
              if (!verdict) return
              this.sessions.get(localId)?.sender.push({
                type: 'verification',
                localId: streamId,
                turnId: ev.turnId,
                verdict: verdict.verdict,
                note: verdict.note,
                verifier: verdict.verifier
              })
              if (verdict.verdict === 'disputed') {
                this.notify(streamId, 'Verification dispute', verdict.note)
                logActivity('verify', `Disputed answer: ${verdict.note}`, conversationId)
              }
            })
          }
          const title = getConversation(streamId)?.title ?? 'Conversation'
          this.notify(
            streamId,
            ev.isError ? `${title} — turn failed` : `${title} — finished`,
            ev.errorMessage ?? 'The agent finished responding.'
          )
        }
        if (ev.type === 'permission.request') {
          this.notify(
            streamId,
            'Permission needed',
            `${conversation.title} wants to use ${ev.toolName}`
          )
        }
        const out = toGroupEvent(ev)
        if (out) sender.push(out)
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
        if (isAlwaysAllowed(permReq.toolName, conversationId)) {
          return { behavior: 'allow' }
        }
        return new Promise<PermissionDecision>((resolve) => {
          this.pendingPermissions.set(permReq.requestId, {
            resolve,
            toolName: permReq.toolName,
            conversationId
          })
          sender.push({
            type: 'permission.request',
            localId: streamId,
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

  /**
   * Group chat send: resolve @-mention targets, build each member's room
   * update (messages since they last responded), and fan out.
   */
  async groupSend(groupId: string, text: string): Promise<void> {
    this.checkBudget()
    const group = getConversation(groupId)
    if (!group || group.kind !== 'group') throw new Error(`Not a group conversation: ${groupId}`)
    const members = listGroupMembers(groupId)
    if (members.length === 0) throw new Error('This group has no members')

    const lower = text.toLowerCase()
    const mentioned = members.filter((m) => lower.includes(`@${m.title.toLowerCase()}`))
    const targets = mentioned.length > 0 ? mentioned : members

    // Snapshot each target's room context BEFORE recording the new message.
    const contexts = new Map<string, string>()
    for (const member of targets) {
      const rows = loadTranscriptSince(groupId, getMemberLastSeq(member.id))
      let lines: string[] = []
      for (const { event } of rows) {
        if (event.type === 'user.message') lines.push(`User: ${event.text}`)
        else if (event.type === 'text.done' && event.memberName && event.memberName !== member.title) {
          lines.push(`${event.memberName}: ${event.text}`)
        }
      }
      // New/long-absent members: cap catch-up so the prompt stays sane.
      if (lines.length > 40) {
        lines = [`(…${lines.length - 40} earlier room messages omitted…)`, ...lines.slice(-40)]
      }
      contexts.set(
        member.id,
        lines.length > 0
          ? `<room-history note="group messages since you last responded">\n${lines.join('\n\n')}\n</room-history>\n\n`
          : ''
      )
    }

    touchConversation(groupId)
    recordTranscriptEvent(groupId, { type: 'user.message', localId: groupId, turnId: 'live', text })
    const cursor = latestSeq(groupId)

    for (const member of targets) {
      await this.startForConversation(member.id)
      const addressed =
        mentioned.length > 0
          ? 'The user addressed you directly.'
          : `The user addressed the whole room; ${targets.length - 1} other member(s) are answering too.`
      const prompt =
        `${contexts.get(member.id) ?? ''}` +
        `New group message from the user: ${text}\n\n` +
        `${addressed} Respond as ${member.title}.`
      setMemberLastSeq(member.id, cursor)
      const live = this.sessions.get(member.id)
      if (live) void live.session.send({ text: prompt })
    }
  }

  async groupInterrupt(groupId: string): Promise<void> {
    for (const member of listGroupMembers(groupId)) {
      const live = this.sessions.get(member.id)
      if (live && live.status === 'busy') await live.session.interrupt()
    }
  }

  /** Replay stored history: transcript cache first, Claude SDK store as legacy fallback. */
  async history(conversationId: string): Promise<SessionEvent[]> {
    const cached = loadTranscript(conversationId)
    if (cached.length > 0) return cached
    const conversation = getConversation(conversationId)
    if (!conversation?.providerSessionId || conversation.provider !== 'claude') return []
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

  /** Throws when the configured daily budget has been reached. */
  private checkBudget(): void {
    const budget = getSetting<number | null>('dailyBudgetUsd', null)
    if (budget !== null && todaySpend() >= budget) {
      throw new Error(
        `Daily budget reached ($${todaySpend().toFixed(2)} of $${budget.toFixed(2)}). Raise it in Settings → Usage.`
      )
    }
  }

  /** Get the live session, lazily (re)starting it — recovers zombie sessions. */
  private async ensureLive(localId: string): Promise<LiveSession> {
    if (!this.sessions.has(localId)) {
      await this.startForConversation(localId)
    }
    return this.get(localId)
  }

  async send(localId: string, text: string, attachments?: UserInput['attachments']): Promise<void> {
    this.checkBudget()
    const live = await this.ensureLive(localId)
    touchConversation(live.conversationId)
    // First message in an untitled chat: generate a proper title in the background.
    const conversation = getConversation(live.conversationId)
    if (conversation?.title === 'New conversation' && !text.startsWith('[')) {
      void generateTitle(text).then((title) => {
        if (!title) return
        renameConversation(live.conversationId, title)
        const target = this.getTarget()
        if (target && !target.isDestroyed()) target.send('ui:conversationsChanged')
      })
    }
    const label =
      attachments && attachments.length > 0
        ? `${text}\n[attached: ${attachments.map((a) => a.path.split('/').pop()).join(', ')}]`
        : text
    recordTranscriptEvent(live.conversationId, {
      type: 'user.message',
      localId,
      turnId: 'live',
      text: label
    })
    await live.session.send({ text, attachments })
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
      try {
        await live.session.setPermissionMode(mode)
      } catch {
        // e.g. switching to bypassPermissions on a session launched without
        // the capability — apply it via restart-with-resume instead.
        await this.restart(conversationId)
      }
    } else {
      await this.restart(conversationId)
    }
  }

  /** For federation: the bus core to expose/mirror sessions on. */
  getBus(): BusCore {
    return this.bus
  }

  isBusy(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.status === 'busy'
  }

  respondPermission(requestId: string, behavior: 'allow' | 'deny', always?: boolean): void {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return
    this.pendingPermissions.delete(requestId)
    if (behavior === 'allow' && always) {
      addAlwaysAllowRule(pending.toolName, pending.conversationId)
    }
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
