import { contextBridge, ipcRenderer } from 'electron'
import type { ChimeraApi, PermissionResponse } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type { SessionEvent } from '../shared/events'
import type { ProviderId } from '../shared/models'
import type { McpTransport } from '../shared/config-types'

const api: ChimeraApi = {
  listConversations: () => ipcRenderer.invoke(IPC.conversationList),
  createConversation: (
    provider: ProviderId,
    model: string,
    persona?: { name: string; prompt: string } | null
  ) => ipcRenderer.invoke(IPC.conversationCreate, { provider, model, persona }),
  createGroup: (name: string, members: unknown[]) =>
    ipcRenderer.invoke(IPC.conversationCreateGroup, { name, members }),
  groupSend: (groupId: string, text: string) =>
    ipcRenderer.invoke(IPC.sessionGroupSend, { groupId, text }),
  addGroupMember: (groupId: string, member: unknown) =>
    ipcRenderer.invoke(IPC.conversationAddMember, { groupId, member }),
  removeGroupMember: (memberId: string) =>
    ipcRenderer.invoke(IPC.conversationRemoveMember, { memberId }),
  listWatchers: () => ipcRenderer.invoke(IPC.watchersList),
  addWatcher: (conversationId: string, path: string, kind: string, prompt: string) =>
    ipcRenderer.invoke(IPC.watchersAdd, { conversationId, path, kind, prompt }),
  setWatcherEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.watchersSetEnabled, { id, enabled }),
  removeWatcher: (id: string) => ipcRenderer.invoke(IPC.watchersRemove, { id }),
  groupInterrupt: (groupId: string) =>
    ipcRenderer.invoke(IPC.sessionGroupInterrupt, { groupId }),
  renameConversation: (id: string, title: string) =>
    ipcRenderer.invoke(IPC.conversationRename, { id, title }),
  deleteConversation: (id: string) => ipcRenderer.invoke(IPC.conversationDelete, { id }),

  startSession: (conversationId: string) => ipcRenderer.invoke(IPC.sessionStart, { conversationId }),
  setPermissionMode: (conversationId: string, mode: string) =>
    ipcRenderer.invoke(IPC.sessionSetPermissionMode, { conversationId, mode }),
  restartSession: (conversationId: string) =>
    ipcRenderer.invoke(IPC.sessionRestart, { conversationId }),
  sessionHistory: (conversationId: string) =>
    ipcRenderer.invoke(IPC.sessionHistory, { conversationId }),
  sendMessage: (localId: string, text: string, attachments?: { path: string; mimeType: string }[]) =>
    ipcRenderer.invoke(IPC.sessionSend, { localId, text, attachments }),
  pickFiles: () => ipcRenderer.invoke(IPC.dialogPickFiles),
  pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder),
  setConversationCwd: (conversationId: string, cwd: string) =>
    ipcRenderer.invoke(IPC.conversationSetCwd, { conversationId, cwd }),
  setPersona: (conversationId: string, name: string | null, prompt: string | null) =>
    ipcRenderer.invoke(IPC.conversationSetPersona, { conversationId, name, prompt }),
  onFocusConversation: (cb: (conversationId: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, conversationId: string): void =>
      cb(conversationId)
    ipcRenderer.on(IPC.uiFocusConversation, listener)
    return () => {
      ipcRenderer.removeListener(IPC.uiFocusConversation, listener)
    }
  },
  interrupt: (localId: string) => ipcRenderer.invoke(IPC.sessionInterrupt, { localId }),
  setModel: (localId: string, model: string) =>
    ipcRenderer.invoke(IPC.sessionSetModel, { localId, model }),
  disposeSession: (localId: string) => ipcRenderer.invoke(IPC.sessionDispose, { localId }),

  listMcpServers: () => ipcRenderer.invoke(IPC.mcpList),
  addMcpServer: (name: string, transport: McpTransport) =>
    ipcRenderer.invoke(IPC.mcpAdd, { name, transport }),
  removeMcpServer: (id: string) => ipcRenderer.invoke(IPC.mcpRemove, { id }),
  setMcpDefault: (id: string, enabledByDefault: boolean) =>
    ipcRenderer.invoke(IPC.mcpSetDefault, { id, enabledByDefault }),
  conversationMcp: (conversationId: string) =>
    ipcRenderer.invoke(IPC.mcpConvState, { conversationId }),
  setConversationMcp: (conversationId: string, serverId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.mcpConvSet, { conversationId, serverId, enabled }),
  mcpImportCandidates: () => ipcRenderer.invoke(IPC.mcpImportCandidates),
  mcpImport: (names: string[]) => ipcRenderer.invoke(IPC.mcpImport, { names }),

  listPlugins: () => ipcRenderer.invoke(IPC.pluginsList),
  addPlugin: () => ipcRenderer.invoke(IPC.pluginsAdd),
  installPluginsFromGit: (url: string) => ipcRenderer.invoke(IPC.pluginsAddFromGit, { url }),
  updatePlugin: (id: string) => ipcRenderer.invoke(IPC.pluginsUpdate, { id }),
  setPluginEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.pluginsSetEnabled, { id, enabled }),
  removePlugin: (id: string) => ipcRenderer.invoke(IPC.pluginsRemove, { id }),
  listConnectors: () => ipcRenderer.invoke(IPC.connectorsList),
  addConnector: (id: string) => ipcRenderer.invoke(IPC.connectorsAdd, { id }),
  listTemplates: () => ipcRenderer.invoke(IPC.templatesList),
  saveTemplate: (conversationId: string, name: string) =>
    ipcRenderer.invoke(IPC.templatesSave, { conversationId, name }),
  deleteTemplate: (id: string) => ipcRenderer.invoke(IPC.templatesDelete, { id }),
  createFromTemplate: (id: string) => ipcRenderer.invoke(IPC.templatesCreate, { id }),
  listSchedules: () => ipcRenderer.invoke(IPC.schedulesList),
  addSchedule: (conversationId: string, prompt: string, cadence: unknown) =>
    ipcRenderer.invoke(IPC.schedulesAdd, { conversationId, prompt, cadence }),
  setScheduleEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.schedulesSetEnabled, { id, enabled }),
  removeSchedule: (id: string) => ipcRenderer.invoke(IPC.schedulesRemove, { id }),
  usageSummary: () => ipcRenderer.invoke(IPC.usageSummary),
  setDailyBudget: (budgetUsd: number | null) =>
    ipcRenderer.invoke(IPC.usageSetBudget, { budgetUsd }),
  getMemory: (conversationId: string) => ipcRenderer.invoke(IPC.memoryGet, { conversationId }),
  listMissions: () => ipcRenderer.invoke(IPC.missionsList),
  addMission: (title: string, goal: string, conversationId: string, cadence: unknown) =>
    ipcRenderer.invoke(IPC.missionsAdd, { title, goal, conversationId, cadence }),
  removeMission: (id: string) => ipcRenderer.invoke(IPC.missionsRemove, { id }),
  setAutoVerify: (conversationId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.verifySet, { conversationId, enabled }),
  secondOpinion: (conversationId: string, provider: ProviderId, model: string) =>
    ipcRenderer.invoke(IPC.replayRun, { conversationId, provider, model }),
  getBrief: () => ipcRenderer.invoke(IPC.briefGet),
  markBriefRead: () => ipcRenderer.invoke(IPC.briefMarkRead),
  fedStatus: () => ipcRenderer.invoke(IPC.fedStatus),
  fedSetEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.fedSetEnabled, { enabled }),
  fedSetName: (name: string) => ipcRenderer.invoke(IPC.fedSetName, { name }),
  fedListPeers: () => ipcRenderer.invoke(IPC.fedPeers),
  fedAddPeer: (name: string, url: string) => ipcRenderer.invoke(IPC.fedAddPeer, { name, url }),
  fedRemovePeer: (id: string) => ipcRenderer.invoke(IPC.fedRemovePeer, { id }),
  forkConversation: (conversationId: string) =>
    ipcRenderer.invoke(IPC.conversationFork, { conversationId }),
  searchAll: (query: string) => ipcRenderer.invoke(IPC.searchAll, { query }),
  exportBackup: () => ipcRenderer.invoke(IPC.backupExport),
  getAutostart: () => ipcRenderer.invoke(IPC.autostartGet),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke(IPC.autostartSet, { enabled }),
  getSetting: (key: string) => ipcRenderer.invoke(IPC.settingsGet, { key }),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke(IPC.settingsSet, { key, value }),
  onConversationsChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.uiConversationsChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.uiConversationsChanged, listener)
    }
  },
  busHistory: () => ipcRenderer.invoke(IPC.busHistory),
  runConference: (
    question: string,
    targetConversationIds: string[],
    synthesizerId: string | null,
    timeoutSeconds: number
  ) =>
    ipcRenderer.invoke(IPC.conferenceRun, {
      question,
      targetConversationIds,
      synthesizerId,
      timeoutSeconds
    }),
  onControlRoomEvent: (cb: (ev: Record<string, unknown>) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: Record<string, unknown>): void => cb(ev)
    ipcRenderer.on(IPC.controlRoomEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.controlRoomEvent, listener)
    }
  },
  listModels: () => ipcRenderer.invoke(IPC.modelsList),
  authStatus: (provider: ProviderId) => ipcRenderer.invoke(IPC.authStatus, { provider }),
  launchLogin: (provider: ProviderId) => ipcRenderer.invoke(IPC.authLaunchLogin, { provider }),
  respondPermission: (resp: PermissionResponse) => ipcRenderer.invoke(IPC.permissionRespond, resp),
  listPermissionRules: () => ipcRenderer.invoke(IPC.permissionRulesList),
  removePermissionRule: (id: string) =>
    ipcRenderer.invoke(IPC.permissionRulesRemove, { id }),
  onSessionEvent: (cb: (ev: SessionEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: SessionEvent): void => cb(ev)
    ipcRenderer.on(IPC.sessionEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.sessionEvent, listener)
    }
  }
}

contextBridge.exposeInMainWorld('chimera', api)
