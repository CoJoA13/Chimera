import { create } from 'zustand'
import type { SessionEvent, Usage } from '../../../shared/events'
import type { AuthStatus } from '../../../shared/ipc'
import type { ModelInfo } from '../../../shared/models'
import type { ConversationRecord } from '../../../shared/config-types'

export type Block =
  | { kind: 'user'; id: string; text: string; attachments?: string[] }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean; memberName?: string }
  | { kind: 'thinking'; id: string; text: string; streaming: boolean; memberName?: string }
  | {
      kind: 'tool'
      id: string
      toolName: string
      input: unknown
      output?: unknown
      isError?: boolean
      done: boolean
      memberName?: string
    }
  | {
      kind: 'footer'
      id: string
      usage?: Usage
      costUsd?: number
      durationMs?: number
      isError: boolean
      errorMessage?: string
      memberName?: string
    }
  | { kind: 'error'; id: string; text: string; memberName?: string }
  | {
      kind: 'bus'
      id: string
      direction: 'in' | 'out'
      peerLocalId: string
      text: string
      isReply: boolean
      memberName?: string
    }

export interface PendingPermission {
  requestId: string
  toolName: string
  input: unknown
}

interface ChatState {
  conversations: ConversationRecord[]
  activeConvId: string | null
  /** conversationId -> live session localId */
  sessionByConv: Record<string, string>
  /** localId -> conversationId (event routing) */
  convByLocal: Record<string, string>
  /** conversationId -> status */
  statusByConv: Record<string, 'idle' | 'streaming'>
  blocksByConv: Record<string, Block[]>
  hydrated: Record<string, boolean>
  /** conversationId -> live await state (peer + how many sessions are awaited) */
  busAwaitByConv: Record<string, { peer: string | null; count: number } | null>
  /** conversations with unseen inbound bus messages */
  unreadBusByConv: Record<string, boolean>
  permissions: PendingPermission[]
  models: ModelInfo[]
  auth: AuthStatus | null
  codexAuth: AuthStatus | null
  settingsOpen: boolean
  paletteOpen: boolean
  newChatOpen: boolean
  onboardingOpen: boolean
  activeView: 'chat' | 'control'
  /** Reports agents sent to the Control Room (bus target: control-room). */
  controlInbound: { fromId: string; messageId: string; text: string; at: number }[]

  init(): Promise<void>
  refreshAuth(): Promise<void>
  login(provider?: 'claude' | 'codex'): Promise<void>
  newConversation(
    provider?: 'claude' | 'codex',
    model?: string,
    persona?: { name: string; prompt: string } | null
  ): Promise<void>
  newGroup(
    name: string,
    members: {
      provider: 'claude' | 'codex'
      model: string
      title: string
      personaName?: string | null
      personaPrompt?: string | null
    }[]
  ): Promise<void>
  selectConversation(id: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  restartActiveSession(): Promise<void>
  send(text: string, attachments?: { path: string; mimeType: string }[]): Promise<void>
  setCwd(): Promise<void>
  setPersona(name: string | null, prompt: string | null): Promise<void>
  interrupt(): Promise<void>
  changeModel(model: string): Promise<void>
  respondPermission(requestId: string, behavior: 'allow' | 'deny', always?: boolean): Promise<void>
  setPermissionMode(
    mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  ): Promise<void>
  setSettingsOpen(open: boolean): void
  setPaletteOpen(open: boolean): void
  setNewChatOpen(open: boolean): void
  finishOnboarding(): Promise<void>
  /** Refresh the list and select a conversation created outside the store. */
  adoptConversation(id: string): Promise<void>
  setActiveView(view: 'chat' | 'control'): void
  handleEvent(ev: SessionEvent): void
}

let initialized = false

function updateBlocks(blocks: Block[], id: string, update: (b: Block) => Block): Block[] {
  const idx = blocks.findIndex((b) => b.id === id)
  if (idx === -1) return blocks
  const next = blocks.slice()
  next[idx] = update(next[idx])
  return next
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  activeConvId: null,
  sessionByConv: {},
  convByLocal: {},
  statusByConv: {},
  blocksByConv: {},
  hydrated: {},
  busAwaitByConv: {},
  unreadBusByConv: {},
  permissions: [],
  models: [],
  auth: null,
  codexAuth: null,
  settingsOpen: false,
  paletteOpen: false,
  newChatOpen: false,
  onboardingOpen: false,
  activeView: 'chat',
  controlInbound: [],

  async init() {
    // Guard against StrictMode double-invocation and HMR remounts.
    if (initialized) return
    initialized = true
    window.chimera.onSessionEvent((ev) => get().handleEvent(ev))
    window.chimera.onFocusConversation((conversationId) => {
      void get().selectConversation(conversationId)
    })
    window.chimera.onConversationsChanged(() => {
      void window.chimera.listConversations().then((conversations) => set({ conversations }))
    })
    window.chimera.onControlRoomEvent((ev) => {
      if (ev.type === 'inbound') {
        set((s) => ({
          controlInbound: [
            ...s.controlInbound,
            {
              fromId: ev.fromId as string,
              messageId: ev.messageId as string,
              text: ev.text as string,
              at: Date.now()
            }
          ]
        }))
      }
    })
    const [models, auth, codexAuth, conversations] = await Promise.all([
      window.chimera.listModels(),
      window.chimera.authStatus('claude'),
      window.chimera.authStatus('codex'),
      window.chimera.listConversations()
    ])
    const onboarded = await window.chimera.getSetting('onboarded')
    set({ models, auth, codexAuth, conversations, onboardingOpen: onboarded !== true })
    if (conversations.length > 0) {
      await get().selectConversation(conversations[0].id)
    } else {
      await get().newConversation()
    }
  },

  async refreshAuth() {
    const [auth, codexAuth] = await Promise.all([
      window.chimera.authStatus('claude'),
      window.chimera.authStatus('codex')
    ])
    set({ auth, codexAuth })
  },

  async login(provider = 'claude') {
    await window.chimera.launchLogin(provider)
    const poll = setInterval(async () => {
      const status = await window.chimera.authStatus(provider)
      set(provider === 'claude' ? { auth: status } : { codexAuth: status })
      if (status.state === 'authenticated') clearInterval(poll)
    }, 3000)
  },

  async newConversation(provider = 'claude', model?: string, persona?) {
    const defaultModel = provider === 'claude' ? 'claude-sonnet-5' : 'gpt-5.6-sol'
    const conv = await window.chimera.createConversation(provider, model ?? defaultModel, persona)
    set((s) => ({ conversations: [conv, ...s.conversations] }))
    await get().selectConversation(conv.id)
  },

  async newGroup(name, members) {
    const conv = await window.chimera.createGroup(name, members)
    // Re-list so the group arrives with its member roster attached.
    const conversations = await window.chimera.listConversations()
    set({ conversations })
    await get().selectConversation(conv.id)
  },

  async selectConversation(id) {
    set((st) => ({
      activeConvId: id,
      activeView: 'chat',
      unreadBusByConv: { ...st.unreadBusByConv, [id]: false }
    }))
    const s = get()
    if (!s.sessionByConv[id]) {
      const conv = s.conversations.find((c) => c.id === id)
      // Groups have no session of their own; members auto-start on demand.
      const localId = conv?.kind === 'group' ? id : (await window.chimera.startSession(id)).localId
      set((st) => ({
        sessionByConv: { ...st.sessionByConv, [id]: localId },
        convByLocal: { ...st.convByLocal, [localId]: id },
        statusByConv: { ...st.statusByConv, [id]: st.statusByConv[id] ?? 'idle' }
      }))
      if (!s.hydrated[id]) {
        const history = await window.chimera.sessionHistory(id)
        if (history.length > 0) {
          // Replay stored events into blocks before any live ones arrive.
          const replayed = get()
          const existing = replayed.blocksByConv[id] ?? []
          if (existing.length === 0) {
            for (const ev of history) get().handleEvent({ ...ev, localId })
          }
        }
        set((st) => ({ hydrated: { ...st.hydrated, [id]: true } }))
      }
    }
  },

  async deleteConversation(id) {
    const s = get()
    const localId = s.sessionByConv[id]
    if (localId) await window.chimera.disposeSession(localId)
    await window.chimera.deleteConversation(id)
    set((st) => {
      const conversations = st.conversations.filter((c) => c.id !== id)
      return { conversations }
    })
    if (get().activeConvId === id) {
      const remaining = get().conversations
      if (remaining.length > 0) await get().selectConversation(remaining[0].id)
      else await get().newConversation()
    }
  },

  async restartActiveSession() {
    const { activeConvId, sessionByConv } = get()
    if (!activeConvId) return
    const oldLocal = sessionByConv[activeConvId]
    const { localId } = await window.chimera.restartSession(activeConvId)
    set((st) => {
      const convByLocal = { ...st.convByLocal, [localId]: activeConvId }
      if (oldLocal) delete convByLocal[oldLocal]
      return {
        sessionByConv: { ...st.sessionByConv, [activeConvId]: localId },
        convByLocal
      }
    })
  },

  async send(text, attachments) {
    const { activeConvId, sessionByConv, statusByConv, conversations } = get()
    if (!activeConvId) return
    const localId = sessionByConv[activeConvId]
    if (!localId || statusByConv[activeConvId] === 'streaming') return

    set((s) => ({
      blocksByConv: {
        ...s.blocksByConv,
        [activeConvId]: [
          ...(s.blocksByConv[activeConvId] ?? []),
          {
            kind: 'user',
            id: crypto.randomUUID(),
            text,
            attachments: attachments?.map((a) => a.path.split('/').pop() ?? a.path)
          }
        ]
      }
    }))

    const conv = conversations.find((c) => c.id === activeConvId)
    if (conv?.kind === 'group') {
      set((st) => ({ statusByConv: { ...st.statusByConv, [activeConvId]: 'streaming' } }))
      await window.chimera.groupSend(activeConvId, text)
    } else {
      await window.chimera.sendMessage(localId, text, attachments)
    }
  },

  async setCwd() {
    const { activeConvId } = get()
    if (!activeConvId) return
    const cwd = await window.chimera.pickFolder()
    if (!cwd) return
    await window.chimera.setConversationCwd(activeConvId, cwd)
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === activeConvId ? { ...c, cwd } : c))
    }))
  },

  async interrupt() {
    const { activeConvId, sessionByConv, conversations } = get()
    if (!activeConvId) return
    const conv = conversations.find((c) => c.id === activeConvId)
    if (conv?.kind === 'group') {
      await window.chimera.groupInterrupt(activeConvId)
      return
    }
    const localId = sessionByConv[activeConvId]
    if (localId) await window.chimera.interrupt(localId)
  },

  async changeModel(model) {
    const { activeConvId, sessionByConv } = get()
    if (!activeConvId) return
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === activeConvId ? { ...c, model } : c))
    }))
    const localId = sessionByConv[activeConvId]
    if (localId) await window.chimera.setModel(localId, model)
  },

  async respondPermission(requestId, behavior, always) {
    set((s) => ({ permissions: s.permissions.filter((p) => p.requestId !== requestId) }))
    await window.chimera.respondPermission({ requestId, behavior, always })
  },

  async setPersona(name, prompt) {
    const { activeConvId } = get()
    if (!activeConvId) return
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === activeConvId ? { ...c, personaName: name, personaPrompt: prompt } : c
      )
    }))
    await window.chimera.setPersona(activeConvId, name, prompt)
  },

  async setPermissionMode(mode) {
    const { activeConvId, sessionByConv } = get()
    if (!activeConvId) return
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === activeConvId ? { ...c, permissionMode: mode } : c
      )
    }))
    await window.chimera.setPermissionMode(activeConvId, mode)
    // Codex sessions restart with a new localId; re-sync the mapping.
    const conv = get().conversations.find((c) => c.id === activeConvId)
    if (conv?.provider === 'codex') {
      const oldLocal = sessionByConv[activeConvId]
      const { localId } = await window.chimera.startSession(activeConvId)
      set((st) => {
        const convByLocal = { ...st.convByLocal, [localId]: activeConvId }
        if (oldLocal && oldLocal !== localId) delete convByLocal[oldLocal]
        return { sessionByConv: { ...st.sessionByConv, [activeConvId]: localId }, convByLocal }
      })
    }
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },

  setNewChatOpen(open) {
    set({ newChatOpen: open })
  },

  async finishOnboarding() {
    set({ onboardingOpen: false })
    await window.chimera.setSetting('onboarded', true)
  },

  async adoptConversation(id) {
    const conversations = await window.chimera.listConversations()
    set({ conversations })
    await get().selectConversation(id)
  },

  setActiveView(view) {
    set({ activeView: view })
  },

  handleEvent(ev) {
    const s = get()
    // Session localIds are conversation ids; the map only adds indirection for
    // sessions this renderer started. Fall back to the id itself so events from
    // bus-auto-started sessions still route.
    const convId =
      s.convByLocal[ev.localId] ??
      (s.conversations.some((c) => c.id === ev.localId) ? ev.localId : undefined)
    if (!convId) return
    const blocks = s.blocksByConv[convId] ?? []
    const setBlocks = (next: Block[]): void => {
      set((st) => ({ blocksByConv: { ...st.blocksByConv, [convId]: next } }))
    }

    switch (ev.type) {
      case 'turn.started':
        set((st) => ({ statusByConv: { ...st.statusByConv, [convId]: 'streaming' } }))
        break

      case 'user.message':
        setBlocks([...blocks, { kind: 'user', id: crypto.randomUUID(), text: ev.text }])
        break

      case 'text.delta':
      case 'thinking.delta': {
        const kind = ev.type === 'text.delta' ? 'assistant' : 'thinking'
        const existing = blocks.find((b) => b.id === ev.blockId)
        if (existing) {
          setBlocks(
            updateBlocks(blocks, ev.blockId, (b) =>
              b.kind === 'assistant' || b.kind === 'thinking'
                ? { ...b, text: b.text + ev.text }
                : b
            )
          )
        } else {
          setBlocks([
            ...blocks,
            { kind, id: ev.blockId, text: ev.text, streaming: true, memberName: ev.memberName }
          ])
        }
        break
      }

      case 'text.done':
      case 'thinking.done': {
        const kind = ev.type === 'text.done' ? 'assistant' : 'thinking'
        const existing = blocks.find((b) => b.id === ev.blockId)
        if (existing) {
          setBlocks(
            updateBlocks(blocks, ev.blockId, (b) =>
              b.kind === 'assistant' || b.kind === 'thinking'
                ? { ...b, text: ev.text, streaming: false }
                : b
            )
          )
        } else if (ev.text.trim()) {
          setBlocks([
            ...blocks,
            { kind, id: ev.blockId, text: ev.text, streaming: false, memberName: ev.memberName }
          ])
        }
        break
      }

      case 'tool.started':
        setBlocks([
          ...blocks,
          {
            kind: 'tool',
            id: ev.toolUseId,
            toolName: ev.toolName,
            input: ev.input,
            done: false,
            memberName: ev.memberName
          }
        ])
        break

      case 'tool.output':
        setBlocks(
          updateBlocks(blocks, ev.toolUseId, (b) =>
            b.kind === 'tool' ? { ...b, output: ev.output, isError: ev.isError, done: true } : b
          )
        )
        break

      case 'permission.request':
        set((st) => ({
          permissions: [
            ...st.permissions,
            { requestId: ev.requestId, toolName: ev.toolName, input: ev.input }
          ]
        }))
        break

      case 'turn.completed':
        if (ev.groupDone !== false) {
          set((st) => ({ statusByConv: { ...st.statusByConv, [convId]: 'idle' } }))
        }
        setBlocks([
          ...blocks,
          {
            kind: 'footer',
            id: crypto.randomUUID(),
            usage: ev.usage,
            costUsd: ev.costUsd,
            durationMs: ev.durationMs,
            isError: ev.isError,
            errorMessage: ev.errorMessage,
            memberName: ev.memberName
          }
        ])
        break

      case 'bus.message':
        setBlocks([
          ...blocks,
          {
            kind: 'bus',
            id: crypto.randomUUID(),
            direction: ev.direction,
            peerLocalId: ev.direction === 'in' ? ev.from : ev.to,
            text: ev.text,
            isReply: ev.inReplyTo !== undefined,
            memberName: ev.memberName
          }
        ])
        if (ev.direction === 'in' && convId !== s.activeConvId) {
          set((st) => ({ unreadBusByConv: { ...st.unreadBusByConv, [convId]: true } }))
        }
        break

      case 'bus.status':
        set((st) => ({
          busAwaitByConv: {
            ...st.busAwaitByConv,
            [convId]:
              ev.status === 'awaiting'
                ? { peer: ev.peerLocalId ?? null, count: ev.peerCount ?? 1 }
                : null
          }
        }))
        break

      case 'session.error':
        set((st) => ({ statusByConv: { ...st.statusByConv, [convId]: 'idle' } }))
        setBlocks([
          ...blocks,
          { kind: 'error', id: crypto.randomUUID(), text: ev.message, memberName: ev.memberName }
        ])
        break

      default:
        break
    }
  }
}))
