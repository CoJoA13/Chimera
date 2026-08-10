import { contextBridge, ipcRenderer } from 'electron'
import type { ChimeraApi, PermissionResponse } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type { SessionEvent } from '../shared/events'
import type { ProviderId } from '../shared/models'
import type { McpTransport } from '../shared/config-types'

const api: ChimeraApi = {
  listConversations: () => ipcRenderer.invoke(IPC.conversationList),
  createConversation: (provider: ProviderId, model: string) =>
    ipcRenderer.invoke(IPC.conversationCreate, { provider, model }),
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
  setPluginEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.pluginsSetEnabled, { id, enabled }),
  removePlugin: (id: string) => ipcRenderer.invoke(IPC.pluginsRemove, { id }),
  listConnectors: () => ipcRenderer.invoke(IPC.connectorsList),
  addConnector: (id: string) => ipcRenderer.invoke(IPC.connectorsAdd, { id }),
  listModels: () => ipcRenderer.invoke(IPC.modelsList),
  authStatus: (provider: ProviderId) => ipcRenderer.invoke(IPC.authStatus, { provider }),
  launchLogin: (provider: ProviderId) => ipcRenderer.invoke(IPC.authLaunchLogin, { provider }),
  respondPermission: (resp: PermissionResponse) => ipcRenderer.invoke(IPC.permissionRespond, resp),
  onSessionEvent: (cb: (ev: SessionEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: SessionEvent): void => cb(ev)
    ipcRenderer.on(IPC.sessionEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.sessionEvent, listener)
    }
  }
}

contextBridge.exposeInMainWorld('chimera', api)
