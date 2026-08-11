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

export interface PermissionRuleSummary {
  id: string
  toolName: string
  conversationId: string | null
  conversationTitle: string
  inputPattern: string | null
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
  addGroupMember(groupId: string, member: GroupMemberSpec): Promise<void>
  removeGroupMember(memberId: string): Promise<void>
  listWatchers(): Promise<
    {
      id: string
      conversationId: string
      path: string
      kind: 'files' | 'git'
      prompt: string
      enabled: boolean
    }[]
  >
  addWatcher(
    conversationId: string,
    path: string,
    kind: 'files' | 'git',
    prompt: string
  ): Promise<void>
  setWatcherEnabled(id: string, enabled: boolean): Promise<void>
  removeWatcher(id: string): Promise<void>
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
  listPlugins(): Promise<
    { id: string; name: string; path: string; enabled: boolean; gitUrl: string | null }[]
  >
  addPlugin(): Promise<{ id: string; name: string } | null>
  installPluginsFromGit(url: string): Promise<{ id: string; name: string }[]>
  updatePlugin(id: string): Promise<void>
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

  // templates
  listTemplates(): Promise<
    { id: string; name: string; spec: { kind: 'single' | 'group'; members: GroupMemberSpec[] } }[]
  >
  saveTemplate(conversationId: string, name: string): Promise<void>
  deleteTemplate(id: string): Promise<void>
  createFromTemplate(id: string): Promise<ConversationRecord>

  // schedules
  listSchedules(): Promise<
    {
      id: string
      conversationId: string
      prompt: string
      cadence: { type: 'interval'; minutes: number } | { type: 'daily'; time: string }
      enabled: boolean
      nextRunAt: number
      lastRunAt: number | null
    }[]
  >
  addSchedule(
    conversationId: string,
    prompt: string,
    cadence: { type: 'interval'; minutes: number } | { type: 'daily'; time: string }
  ): Promise<void>
  setScheduleEnabled(id: string, enabled: boolean): Promise<void>
  removeSchedule(id: string): Promise<void>

  // usage / budget
  usageSummary(): Promise<{
    today: { reportedCost: number; estimatedCost: number; total: number }
    budgetUsd: number | null
    byConversation: {
      conversationId: string
      title: string
      reportedCost: number
      estimatedCost: number
      total: number
    }[]
  }>
  setDailyBudget(budgetUsd: number | null): Promise<void>

  // memory
  getMemory(conversationId: string): Promise<string>

  // missions
  listMissions(): Promise<
    {
      id: string
      title: string
      goal: string
      conversationId: string
      status: 'active' | 'paused' | 'done'
      progress: string | null
      updatedAt: number
    }[]
  >
  addMission(
    title: string,
    goal: string,
    conversationId: string,
    cadence: { type: 'interval'; minutes: number } | { type: 'daily'; time: string }
  ): Promise<void>
  removeMission(id: string): Promise<void>

  // verification / replay / brief
  setAutoVerify(conversationId: string, enabled: boolean): Promise<void>
  secondOpinion(conversationId: string, provider: ProviderId, model: string): Promise<string>
  getBrief(): Promise<{ summary: string | null; items: { ts: number; kind: string; text: string }[] }>
  markBriefRead(): Promise<void>

  // federation
  fedStatus(): Promise<{ enabled: boolean; address: string | null; name: string }>
  fedSetEnabled(enabled: boolean): Promise<void>
  fedSetName(name: string): Promise<void>
  fedListPeers(): Promise<{ id: string; name: string; url: string }[]>
  fedAddPeer(name: string, url: string): Promise<void>
  fedRemovePeer(id: string): Promise<void>

  // fork / search / settings
  forkConversation(conversationId: string): Promise<ConversationRecord>
  searchAll(query: string): Promise<{ conversationId: string; title: string; snippet: string }[]>
  exportBackup(): Promise<string | null>
  getAutostart(): Promise<{ enabled: boolean; note: string | null }>
  setAutostart(enabled: boolean): Promise<void>
  quitApp(): Promise<void>
  getSetting(key: string): Promise<unknown>
  setSetting(key: string, value: unknown): Promise<void>
  onConversationsChanged(cb: () => void): () => void

  // misc
  listModels(): Promise<ModelInfo[]>
  authStatus(provider: ProviderId): Promise<AuthStatus>
  launchLogin(provider: ProviderId): Promise<void>
  respondPermission(resp: PermissionResponse): Promise<void>
  listPermissionRules(): Promise<PermissionRuleSummary[]>
  removePermissionRule(id: string): Promise<void>
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
  conversationAddMember: 'conversation:addMember',
  conversationRemoveMember: 'conversation:removeMember',
  watchersList: 'watchers:list',
  watchersAdd: 'watchers:add',
  watchersSetEnabled: 'watchers:setEnabled',
  watchersRemove: 'watchers:remove',
  sessionGroupSend: 'session:groupSend',
  sessionGroupInterrupt: 'session:groupInterrupt',
  uiFocusConversation: 'ui:focusConversation',
  busHistory: 'bus:history',
  conferenceRun: 'conference:run',
  controlRoomEvent: 'controlroom:event',
  templatesList: 'templates:list',
  templatesSave: 'templates:save',
  templatesDelete: 'templates:delete',
  templatesCreate: 'templates:create',
  schedulesList: 'schedules:list',
  schedulesAdd: 'schedules:add',
  schedulesSetEnabled: 'schedules:setEnabled',
  schedulesRemove: 'schedules:remove',
  usageSummary: 'usage:summary',
  usageSetBudget: 'usage:setBudget',
  memoryGet: 'memory:get',
  conversationFork: 'conversation:fork',
  searchAll: 'search:all',
  backupExport: 'backup:export',
  autostartGet: 'autostart:get',
  autostartSet: 'autostart:set',
  appQuit: 'app:quit',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  uiConversationsChanged: 'ui:conversationsChanged',
  missionsList: 'missions:list',
  missionsAdd: 'missions:add',
  missionsRemove: 'missions:remove',
  verifySet: 'verify:set',
  replayRun: 'replay:run',
  briefGet: 'brief:get',
  briefMarkRead: 'brief:markRead',
  fedStatus: 'fed:status',
  fedSetEnabled: 'fed:setEnabled',
  fedSetName: 'fed:setName',
  fedPeers: 'fed:peers',
  fedAddPeer: 'fed:addPeer',
  fedRemovePeer: 'fed:removePeer',
  sessionInterrupt: 'session:interrupt',
  sessionSetModel: 'session:setModel',
  sessionDispose: 'session:dispose',
  sessionEvent: 'session:event',
  permissionRespond: 'permission:respond',
  permissionRulesList: 'permission:rules:list',
  permissionRulesRemove: 'permission:rules:remove',
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
  pluginsAddFromGit: 'plugins:addFromGit',
  pluginsUpdate: 'plugins:update',
  pluginsSetEnabled: 'plugins:setEnabled',
  pluginsRemove: 'plugins:remove',
  connectorsList: 'connectors:list',
  connectorsAdd: 'connectors:add',
  modelsList: 'models:list',
  authStatus: 'auth:status',
  authLaunchLogin: 'auth:launchLogin'
} as const
