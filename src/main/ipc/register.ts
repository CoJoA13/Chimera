import { ipcMain, dialog, app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ConnectorEntry } from '../../shared/ipc'
import type { McpTransport } from '../../shared/config-types'
import { listPlugins, addPlugin, setPluginEnabled, removePlugin } from '../store/plugins'
import { IPC } from '../../shared/ipc'
import { MODEL_CATALOG } from '../../shared/models'
import { getProvider } from '../providers/registry'
import type { SessionManager } from './sessions'
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  setConversationCwd,
  setConversationPersona,
  listGroupMembers
} from '../store/conversations'
import { clearTranscript } from '../store/transcript'
import { listBusMessages } from '../store/busHistory'
import {
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  updateMcpServer,
  conversationMcpState,
  setConversationMcp,
  claudeDesktopImportCandidates,
  importClaudeDesktopServers
} from '../store/mcp'

const providerSchema = z.enum(['claude', 'codex'])
const idSchema = z.string().min(1)

const transportSchema = z.union([
  z.object({
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional()
  }),
  z.object({
    type: z.literal('http'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional()
  }),
  z.object({
    type: z.literal('sse'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional()
  })
])

export function registerIpc(manager: SessionManager): void {
  // conversations
  ipcMain.handle(IPC.conversationList, () => listConversations())
  ipcMain.handle(IPC.conversationCreate, (_e, payload: unknown) => {
    const { provider, model, persona } = z
      .object({
        provider: providerSchema,
        model: z.string().min(1),
        persona: z
          .object({ name: z.string().min(1).max(60), prompt: z.string().max(2000) })
          .nullish()
      })
      .parse(payload)
    const conversation = createConversation(provider, model, {
      personaName: persona?.name ?? null,
      personaPrompt: persona?.prompt ?? null
    })
    manager.registerConversation(conversation.id)
    return conversation
  })

  ipcMain.handle(IPC.conversationCreateGroup, (_e, payload: unknown) => {
    const { name, members } = z
      .object({
        name: z.string().min(1).max(80),
        members: z
          .array(
            z.object({
              provider: providerSchema,
              model: z.string().min(1),
              title: z.string().min(1).max(60),
              personaName: z.string().max(60).nullish(),
              personaPrompt: z.string().max(2000).nullish()
            })
          )
          .min(2)
      })
      .parse(payload)
    const group = createConversation(members[0].provider, members[0].model, {
      title: name,
      kind: 'group'
    })
    for (const member of members) {
      const memberConv = createConversation(member.provider, member.model, {
        title: member.title,
        groupId: group.id,
        personaName: member.personaName ?? null,
        personaPrompt: member.personaPrompt ?? null
      })
      manager.registerConversation(memberConv.id)
    }
    return { ...group, groupMembers: undefined }
  })

  ipcMain.handle(IPC.sessionGroupSend, (_e, payload: unknown) => {
    const { groupId, text } = z
      .object({ groupId: idSchema, text: z.string().min(1) })
      .parse(payload)
    return manager.groupSend(groupId, text)
  })

  ipcMain.handle(IPC.sessionGroupInterrupt, (_e, payload: unknown) => {
    const { groupId } = z.object({ groupId: idSchema }).parse(payload)
    return manager.groupInterrupt(groupId)
  })
  ipcMain.handle(IPC.conversationRename, (_e, payload: unknown) => {
    const { id, title } = z.object({ id: idSchema, title: z.string().min(1) }).parse(payload)
    renameConversation(id, title)
  })
  ipcMain.handle(IPC.conversationDelete, async (_e, payload: unknown) => {
    const { id } = z.object({ id: idSchema }).parse(payload)
    // Groups: tear down every member first.
    for (const member of listGroupMembers(id)) {
      await manager.dispose(member.id)
      manager.unregisterConversation(member.id)
      clearTranscript(member.id)
      deleteConversation(member.id)
    }
    await manager.dispose(id)
    manager.unregisterConversation(id)
    clearTranscript(id)
    deleteConversation(id)
  })

  // sessions
  ipcMain.handle(IPC.sessionStart, (_e, payload: unknown) => {
    const { conversationId } = z.object({ conversationId: idSchema }).parse(payload)
    return manager.startForConversation(conversationId)
  })
  ipcMain.handle(IPC.sessionSetPermissionMode, (_e, payload: unknown) => {
    const { conversationId, mode } = z
      .object({
        conversationId: idSchema,
        mode: z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
      })
      .parse(payload)
    return manager.setPermissionMode(conversationId, mode)
  })
  ipcMain.handle(IPC.sessionRestart, (_e, payload: unknown) => {
    const { conversationId } = z.object({ conversationId: idSchema }).parse(payload)
    return manager.restart(conversationId)
  })
  ipcMain.handle(IPC.sessionHistory, (_e, payload: unknown) => {
    const { conversationId } = z.object({ conversationId: idSchema }).parse(payload)
    return manager.history(conversationId)
  })
  ipcMain.handle(IPC.sessionSend, (_e, payload: unknown) => {
    const { localId, text, attachments } = z
      .object({
        localId: idSchema,
        text: z.string().min(1),
        attachments: z
          .array(z.object({ path: z.string().min(1), mimeType: z.string() }))
          .optional()
      })
      .parse(payload)
    return manager.send(localId, text, attachments)
  })

  const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml'
  }
  ipcMain.handle(IPC.dialogPickFiles, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Attach files',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths.map((path) => {
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      return { path, mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream' }
    })
  })
  ipcMain.handle(IPC.dialogPickFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose working directory',
      properties: ['openDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.conversationSetCwd, async (_e, payload: unknown) => {
    const { conversationId, cwd } = z
      .object({ conversationId: idSchema, cwd: z.string().min(1) })
      .parse(payload)
    setConversationCwd(conversationId, cwd)
    await manager.restart(conversationId)
  })
  ipcMain.handle(IPC.conversationSetPersona, async (_e, payload: unknown) => {
    const { conversationId, name, prompt } = z
      .object({
        conversationId: idSchema,
        name: z.string().min(1).max(60).nullable(),
        prompt: z.string().max(2000).nullable()
      })
      .parse(payload)
    setConversationPersona(conversationId, name, prompt)
    // Persona is baked into the system prompt at session start.
    await manager.restart(conversationId)
  })
  ipcMain.handle(IPC.sessionInterrupt, (_e, payload: unknown) => {
    return manager.interrupt(z.object({ localId: idSchema }).parse(payload).localId)
  })
  ipcMain.handle(IPC.sessionSetModel, (_e, payload: unknown) => {
    const { localId, model } = z
      .object({ localId: idSchema, model: z.string().min(1) })
      .parse(payload)
    return manager.setModel(localId, model)
  })
  ipcMain.handle(IPC.sessionDispose, (_e, payload: unknown) => {
    return manager.dispose(z.object({ localId: idSchema }).parse(payload).localId)
  })

  // permissions
  ipcMain.handle(IPC.permissionRespond, (_e, payload: unknown) => {
    const resp = z
      .object({
        requestId: z.string(),
        behavior: z.enum(['allow', 'deny']),
        always: z.boolean().optional()
      })
      .parse(payload)
    manager.respondPermission(resp.requestId, resp.behavior, resp.always)
  })

  // mcp
  ipcMain.handle(IPC.mcpList, () => listMcpServers())
  ipcMain.handle(IPC.mcpAdd, (_e, payload: unknown) => {
    const { name, transport } = z
      .object({ name: z.string().min(1), transport: transportSchema })
      .parse(payload)
    return addMcpServer(name, transport)
  })
  ipcMain.handle(IPC.mcpRemove, (_e, payload: unknown) => {
    removeMcpServer(z.object({ id: idSchema }).parse(payload).id)
  })
  ipcMain.handle(IPC.mcpSetDefault, (_e, payload: unknown) => {
    const { id, enabledByDefault } = z
      .object({ id: idSchema, enabledByDefault: z.boolean() })
      .parse(payload)
    const server = listMcpServers().find((s) => s.id === id)
    if (server) updateMcpServer({ ...server, enabledByDefault })
  })
  ipcMain.handle(IPC.mcpConvState, (_e, payload: unknown) => {
    const { conversationId } = z.object({ conversationId: idSchema }).parse(payload)
    return conversationMcpState(conversationId)
  })
  ipcMain.handle(IPC.mcpConvSet, (_e, payload: unknown) => {
    const { conversationId, serverId, enabled } = z
      .object({ conversationId: idSchema, serverId: idSchema, enabled: z.boolean() })
      .parse(payload)
    setConversationMcp(conversationId, serverId, enabled)
  })
  ipcMain.handle(IPC.mcpImportCandidates, () => claudeDesktopImportCandidates())
  ipcMain.handle(IPC.mcpImport, (_e, payload: unknown) => {
    const { names } = z.object({ names: z.array(z.string()) }).parse(payload)
    return importClaudeDesktopServers(names)
  })

  // plugins
  ipcMain.handle(IPC.pluginsList, () => listPlugins())
  ipcMain.handle(IPC.pluginsAdd, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select a Claude Code plugin folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return addPlugin(result.filePaths[0])
  })
  ipcMain.handle(IPC.pluginsSetEnabled, (_e, payload: unknown) => {
    const { id, enabled } = z.object({ id: idSchema, enabled: z.boolean() }).parse(payload)
    setPluginEnabled(id, enabled)
  })
  ipcMain.handle(IPC.pluginsRemove, (_e, payload: unknown) => {
    removePlugin(z.object({ id: idSchema }).parse(payload).id)
  })

  // connectors
  const loadConnectors = (): Omit<ConnectorEntry, 'installed'>[] => {
    const path = app.isPackaged
      ? join(process.resourcesPath, 'connectors.json')
      : join(app.getAppPath(), 'resources', 'connectors.json')
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  ipcMain.handle(IPC.connectorsList, (): ConnectorEntry[] => {
    const installed = new Set(listMcpServers().map((s) => s.name))
    return loadConnectors().map((c) => ({ ...c, installed: installed.has(c.name) }))
  })
  ipcMain.handle(IPC.connectorsAdd, (_e, payload: unknown) => {
    const { id } = z.object({ id: idSchema }).parse(payload)
    const connector = loadConnectors().find((c) => c.id === id)
    if (!connector) throw new Error(`Unknown connector: ${id}`)
    addMcpServer(connector.name, connector.transport as McpTransport, 'connector-directory')
  })

  // control room
  ipcMain.handle(IPC.busHistory, () => listBusMessages())
  ipcMain.handle(IPC.conferenceRun, (_e, payload: unknown) => {
    const { question, targetConversationIds, synthesizerId, timeoutSeconds } = z
      .object({
        question: z.string().min(1),
        targetConversationIds: z.array(idSchema).min(1),
        synthesizerId: idSchema.nullable(),
        timeoutSeconds: z.number().min(10).max(300)
      })
      .parse(payload)
    return manager.conference(question, targetConversationIds, synthesizerId, timeoutSeconds)
  })

  // misc
  ipcMain.handle(IPC.modelsList, () => [...MODEL_CATALOG.claude, ...MODEL_CATALOG.codex])
  ipcMain.handle(IPC.authStatus, async (_e, payload: unknown) => {
    const { provider } = z.object({ provider: providerSchema }).parse(payload)
    try {
      return await getProvider(provider).authStatus()
    } catch {
      return { state: 'cli-missing', detail: 'Provider not available' }
    }
  })
  ipcMain.handle(IPC.authLaunchLogin, async (_e, payload: unknown) => {
    const { provider } = z.object({ provider: providerSchema }).parse(payload)
    await getProvider(provider).launchLogin()
  })
}
