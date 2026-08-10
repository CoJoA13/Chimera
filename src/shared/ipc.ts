import type { SessionEvent } from './events'
import type { ModelInfo, ProviderId } from './models'
import type {
  ClaudeDesktopImportCandidate,
  ConversationMcpState,
  ConversationRecord,
  GroupMemberSpec,
  McpServerRecord,
  McpTransport
} from './config-types'

export interface AuthStatus {
  state: 'authenticated' | 'unauthenticated' | 'cli-missing'
  method?: 'api-key' | 'oauth-cli'
  detail?: string
}

export interface StartSessionResult {
  localId: string
  resumed: boolean
}

export interface ConnectorEntry {
  id: string
  name: string
  description: string
  transport: McpTransport
  docsUrl: string
  authNote: string
  installed: boolean
}

export interface PermissionResponse {
  requestId: string
  behavior: 'allow' | 'deny'
  always?: boolean
}

/** Typed API exposed on window.chimera by the preload script. */
export interface ChimeraApi {
  // conversations
  listConversations(): Promise<ConversationRecord[]>
  createConversation(
    provider: ProviderId,
    model: string,
    persona?: { name: string; prompt: string } | null
  ): Promise<ConversationRecord>
  createGroup(name: string, members: GroupMemberSpec[]): Promise<ConversationRecord>
  groupSend(groupId: string, text: string): Promise<void>
  groupInterrupt(groupId: string): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>

  // sessions
  startSession(conversationId: string): Promise<StartSessionResult>
  setPermissionMode(
    conversationId: string,
    mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  ): Promise<void>
  restartSession(conversationId: string): Promise<StartSessionResult>
  sessionHistory(conversationId: string): Promise<SessionEvent[]>
  sendMessage(
    localId: string,
    text: string,
    attachments?: { path: string; mimeType: string }[]
  ): Promise<void>
  pickFiles(): Promise<{ path: string; mimeType: string }[]>
  pickFolder(): Promise<string | null>
  setConversationCwd(conversationId: string, cwd: string): Promise<void>
  setPersona(conversationId: string, name: string | null, prompt: string | null): Promise<void>
  onFocusConversation(cb: (conversationId: string) => void): () => void
  interrupt(localId: string): Promise<void>
  setModel(localId: string, model: string): Promise<void>
  disposeSession(localId: string): Promise<void>

  // mcp
  listMcpServers(): Promise<McpServerRecord[]>
  addMcpServer(name: string, transport: McpTransport): Promise<McpServerRecord>
  removeMcpServer(id: string): Promise<void>
  setMcpDefault(id: string, enabledByDefault: boolean): Promise<void>
  conversationMcp(conversationId: string): Promise<ConversationMcpState[]>
  setConversationMcp(conversationId: string, serverId: string, enabled: boolean): Promise<void>
  mcpImportCandidates(): Promise<ClaudeDesktopImportCandidate[]>
  mcpImport(names: string[]): Promise<McpServerRecord[]>

  // plugins
  listPlugins(): Promise<{ id: string; name: string; path: string; enabled: boolean }[]>
  addPlugin(): Promise<{ id: string; name: string } | null>
  setPluginEnabled(id: string, enabled: boolean): Promise<void>
  removePlugin(id: string): Promise<void>

  // connectors
  listConnectors(): Promise<ConnectorEntry[]>
  addConnector(id: string): Promise<void>

  // control room
  busHistory(): Promise<
    {
      messageId: string
      fromId: string
      toId: string
      inReplyTo: string | null
      kind: string
      text: string
      createdAt: number
    }[]
  >
  runConference(
    question: string,
    targetConversationIds: string[],
    synthesizerId: string | null,
    timeoutSeconds: number
  ): Promise<
    { conversationId: string; status: 'replied' | 'timeout' | 'error'; text?: string; error?: string }[]
  >
  onControlRoomEvent(cb: (ev: Record<string, unknown>) => void): () => void

  // misc
  listModels(): Promise<ModelInfo[]>
  authStatus(provider: ProviderId): Promise<AuthStatus>
  launchLogin(provider: ProviderId): Promise<void>
  respondPermission(resp: PermissionResponse): Promise<void>
  onSessionEvent(cb: (ev: SessionEvent) => void): () => void
}

export const IPC = {
  conversationList: 'conversation:list',
  conversationCreate: 'conversation:create',
  conversationRename: 'conversation:rename',
  conversationDelete: 'conversation:delete',
  sessionStart: 'session:start',
  sessionSetPermissionMode: 'session:setPermissionMode',
  sessionRestart: 'session:restart',
  sessionHistory: 'session:history',
  sessionSend: 'session:send',
  dialogPickFiles: 'dialog:pickFiles',
  dialogPickFolder: 'dialog:pickFolder',
  conversationSetCwd: 'conversation:setCwd',
  conversationSetPersona: 'conversation:setPersona',
  conversationCreateGroup: 'conversation:createGroup',
  sessionGroupSend: 'session:groupSend',
  sessionGroupInterrupt: 'session:groupInterrupt',
  uiFocusConversation: 'ui:focusConversation',
  busHistory: 'bus:history',
  conferenceRun: 'conference:run',
  controlRoomEvent: 'controlroom:event',
  sessionInterrupt: 'session:interrupt',
  sessionSetModel: 'session:setModel',
  sessionDispose: 'session:dispose',
  sessionEvent: 'session:event',
  permissionRespond: 'permission:respond',
  mcpList: 'mcp:list',
  mcpAdd: 'mcp:add',
  mcpRemove: 'mcp:remove',
  mcpSetDefault: 'mcp:setDefault',
  mcpConvState: 'mcp:convState',
  mcpConvSet: 'mcp:convSet',
  mcpImportCandidates: 'mcp:importCandidates',
  mcpImport: 'mcp:import',
  pluginsList: 'plugins:list',
  pluginsAdd: 'plugins:add',
  pluginsSetEnabled: 'plugins:setEnabled',
  pluginsRemove: 'plugins:remove',
  connectorsList: 'connectors:list',
  connectorsAdd: 'connectors:add',
  modelsList: 'models:list',
  authStatus: 'auth:status',
  authLaunchLogin: 'auth:launchLogin'
} as const
