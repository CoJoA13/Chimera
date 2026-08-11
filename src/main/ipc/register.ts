import { ipcMain, dialog, app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ConnectorEntry } from '../../shared/ipc'
import type { McpTransport } from '../../shared/config-types'
import {
  listPlugins,
  addPlugin,
  setPluginEnabled,
  removePlugin,
  installPluginsFromGit,
  updatePlugin
} from '../store/plugins'
import { IPC } from '../../shared/ipc'
import { MODEL_CATALOG } from '../../shared/models'
import { getProvider } from '../providers/registry'
import type { SessionManager } from './sessions'
import type { WatcherManager } from '../watcherManager'
import {
  listWatchers,
  addWatcher,
  setWatcherEnabled,
  removeWatcher,
  removeWatchersFor
} from '../store/watchers'
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  setConversationCwd,
  setConversationPersona,
  listGroupMembers
} from '../store/conversations'
import { clearTranscript, copyTranscript, searchTranscripts } from '../store/transcript'
import { createForkOf } from '../store/conversations'
import { listBusMessages } from '../store/busHistory'
import {
  listTemplates,
  saveTemplateFromConversation,
  deleteTemplate,
  getTemplate
} from '../store/templates'
import {
  listSchedules,
  addSchedule,
  setScheduleEnabled,
  removeSchedule,
  removeSchedulesFor
} from '../store/schedules'
import { todaySpendBreakdown, spendByConversation } from '../store/spend'
import { getSetting, setSetting } from '../store/settings'
import { readMemory, deleteMemory } from '../store/memory'
import { getConversation, setAutoVerify } from '../store/conversations'
import { listMissions, addMission, removeMission } from '../store/missions'
import { activitySince } from '../store/activity'
import { secondOpinion } from '../secondOpinion'
import { summarizeBrief } from '../titles'
import type { FederationManager } from '../federation'
import { exportBackup } from '../store/maintenance'
import { isAutostartEnabled, setAutostart, autostartNote } from '../autostart'
import { listRules, removeRule } from '../store/permissions'
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

export function registerIpc(
  manager: SessionManager,
  watchers?: WatcherManager,
  federation?: FederationManager
): void {
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

  const memberSpecSchema = z.object({
    provider: providerSchema,
    model: z.string().min(1),
    title: z.string().min(1).max(60),
    personaName: z.string().max(60).nullish(),
    personaPrompt: z.string().max(2000).nullish()
  })
  ipcMain.handle(IPC.conversationAddMember, (_e, payload: unknown) => {
    const { groupId, member } = z
      .object({ groupId: idSchema, member: memberSpecSchema })
      .parse(payload)
    const group = getConversation(groupId)
    if (!group || group.kind !== 'group') throw new Error('Not a group conversation')
    if (
      listGroupMembers(groupId).some(
        (m) => m.title.toLowerCase() === member.title.trim().toLowerCase()
      )
    ) {
      throw new Error(`A member named "${member.title}" already exists in this group`)
    }
    const memberConv = createConversation(member.provider, member.model, {
      title: member.title.trim(),
      groupId,
      personaName: member.personaName ?? null,
      personaPrompt: member.personaPrompt ?? null
    })
    manager.registerConversation(memberConv.id)
  })
  ipcMain.handle(IPC.conversationRemoveMember, async (_e, payload: unknown) => {
    const { memberId } = z.object({ memberId: idSchema }).parse(payload)
    const member = getConversation(memberId)
    if (!member?.groupId) throw new Error('Not a group member')
    if (listGroupMembers(member.groupId).length <= 1) {
      throw new Error('A group needs at least one member — delete the group instead')
    }
    await manager.dispose(memberId)
    manager.unregisterConversation(memberId)
    clearTranscript(memberId)
    deleteMemory(memberId)
    removeSchedulesFor(memberId)
    removeWatchersFor(memberId)
    deleteConversation(memberId)
  })

  // watchers
  ipcMain.handle(IPC.watchersList, () => listWatchers())
  ipcMain.handle(IPC.watchersAdd, (_e, payload: unknown) => {
    const { conversationId, path, kind, prompt } = z
      .object({
        conversationId: idSchema,
        path: z.string().min(1),
        kind: z.enum(['files', 'git']),
        prompt: z.string().min(1)
      })
      .parse(payload)
    addWatcher(conversationId, path, kind, prompt)
    watchers?.reload()
  })
  ipcMain.handle(IPC.watchersSetEnabled, (_e, payload: unknown) => {
    const { id, enabled } = z.object({ id: idSchema, enabled: z.boolean() }).parse(payload)
    setWatcherEnabled(id, enabled)
    watchers?.reload()
  })
  ipcMain.handle(IPC.watchersRemove, (_e, payload: unknown) => {
    removeWatcher(z.object({ id: idSchema }).parse(payload).id)
    watchers?.reload()
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
      deleteMemory(member.id)
      removeSchedulesFor(member.id)
      removeWatchersFor(member.id)
      deleteConversation(member.id)
    }
    await manager.dispose(id)
    manager.unregisterConversation(id)
    clearTranscript(id)
    deleteMemory(id)
    removeSchedulesFor(id)
    removeWatchersFor(id)
    deleteConversation(id)
    watchers?.reload()
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
  ipcMain.handle(IPC.permissionRulesList, () =>
    listRules().map((rule) => ({
      id: rule.id,
      toolName: rule.toolName,
      behavior: rule.behavior,
      conversationId: rule.conversationId,
      conversationTitle: rule.conversationId
        ? (getConversation(rule.conversationId)?.title ?? 'deleted conversation')
        : 'All conversations',
      inputPattern: rule.inputPattern
    }))
  )
  ipcMain.handle(IPC.permissionRulesRemove, (_e, payload: unknown) => {
    removeRule(z.object({ id: idSchema }).parse(payload).id)
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
  ipcMain.handle(IPC.pluginsAddFromGit, (_e, payload: unknown) => {
    const { url } = z.object({ url: z.string().min(3).max(300) }).parse(payload)
    return installPluginsFromGit(url)
  })
  ipcMain.handle(IPC.pluginsUpdate, (_e, payload: unknown) => {
    return updatePlugin(z.object({ id: idSchema }).parse(payload).id)
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

  // templates
  ipcMain.handle(IPC.templatesList, () => listTemplates())
  ipcMain.handle(IPC.templatesSave, (_e, payload: unknown) => {
    const { conversationId, name } = z
      .object({ conversationId: idSchema, name: z.string().min(1).max(80) })
      .parse(payload)
    saveTemplateFromConversation(conversationId, name)
  })
  ipcMain.handle(IPC.templatesDelete, (_e, payload: unknown) => {
    deleteTemplate(z.object({ id: idSchema }).parse(payload).id)
  })
  ipcMain.handle(IPC.templatesCreate, (_e, payload: unknown) => {
    const { id } = z.object({ id: idSchema }).parse(payload)
    const template = getTemplate(id)
    if (!template) throw new Error('Template not found')
    const { kind, members } = template.spec
    if (kind === 'single' || members.length === 1) {
      const m = members[0]
      const conv = createConversation(m.provider, m.model, {
        personaName: m.personaName ?? null,
        personaPrompt: m.personaPrompt ?? null
      })
      manager.registerConversation(conv.id)
      return conv
    }
    const group = createConversation(members[0].provider, members[0].model, {
      title: template.name,
      kind: 'group'
    })
    for (const m of members) {
      const memberConv = createConversation(m.provider, m.model, {
        title: m.title,
        groupId: group.id,
        personaName: m.personaName ?? null,
        personaPrompt: m.personaPrompt ?? null
      })
      manager.registerConversation(memberConv.id)
    }
    return group
  })

  const cadenceSchema = z.union([
    z.object({ type: z.literal('interval'), minutes: z.number().min(5).max(10080) }),
    z.object({ type: z.literal('daily'), time: z.string().regex(/^\d{2}:\d{2}$/) })
  ])
  ipcMain.handle(IPC.schedulesList, () => listSchedules())
  ipcMain.handle(IPC.schedulesAdd, (_e, payload: unknown) => {
    const { conversationId, prompt, cadence } = z
      .object({ conversationId: idSchema, prompt: z.string().min(1), cadence: cadenceSchema })
      .parse(payload)
    addSchedule(conversationId, prompt, cadence)
  })
  ipcMain.handle(IPC.schedulesSetEnabled, (_e, payload: unknown) => {
    const { id, enabled } = z.object({ id: idSchema, enabled: z.boolean() }).parse(payload)
    setScheduleEnabled(id, enabled)
  })
  ipcMain.handle(IPC.schedulesRemove, (_e, payload: unknown) => {
    removeSchedule(z.object({ id: idSchema }).parse(payload).id)
  })

  // usage / budget
  ipcMain.handle(IPC.usageSummary, () => {
    const byConversation = spendByConversation().map((row) => ({
      ...row,
      title: getConversation(row.conversationId)?.title ?? 'deleted conversation'
    }))
    return {
      today: todaySpendBreakdown(),
      budgetUsd: getSetting<number | null>('dailyBudgetUsd', null),
      byConversation
    }
  })
  ipcMain.handle(IPC.usageSetBudget, (_e, payload: unknown) => {
    const { budgetUsd } = z
      .object({ budgetUsd: z.number().min(0.5).max(1000).nullable() })
      .parse(payload)
    setSetting('dailyBudgetUsd', budgetUsd)
  })

  // memory
  ipcMain.handle(IPC.memoryGet, (_e, payload: unknown) => {
    const { conversationId } = z.object({ conversationId: idSchema }).parse(payload)
    return readMemory(conversationId)
  })

  // missions
  ipcMain.handle(IPC.missionsList, () => listMissions())
  ipcMain.handle(IPC.missionsAdd, (_e, payload: unknown) => {
    const { title, goal, conversationId, cadence } = z
      .object({
        title: z.string().min(1).max(80),
        goal: z.string().min(1).max(2000),
        conversationId: idSchema,
        cadence: cadenceSchema
      })
      .parse(payload)
    addMission(title, goal, conversationId, cadence)
  })
  ipcMain.handle(IPC.missionsRemove, (_e, payload: unknown) => {
    removeMission(z.object({ id: idSchema }).parse(payload).id)
  })

  // verification / replay / brief
  ipcMain.handle(IPC.verifySet, (_e, payload: unknown) => {
    const { conversationId, enabled } = z
      .object({ conversationId: idSchema, enabled: z.boolean() })
      .parse(payload)
    setAutoVerify(conversationId, enabled)
  })
  ipcMain.handle(IPC.replayRun, (_e, payload: unknown) => {
    const { conversationId, provider, model } = z
      .object({ conversationId: idSchema, provider: providerSchema, model: z.string().min(1) })
      .parse(payload)
    return secondOpinion(conversationId, provider, model)
  })
  ipcMain.handle(IPC.briefGet, async () => {
    const since = getSetting<number>('lastBriefTs', Date.now() - 86_400_000)
    const items = activitySince(since)
    const summary =
      items.length >= 3 ? await summarizeBrief(items.map((i) => `[${i.kind}] ${i.text}`)) : null
    return { summary, items: items.map((i) => ({ ts: i.ts, kind: i.kind, text: i.text })) }
  })
  ipcMain.handle(IPC.briefMarkRead, () => {
    setSetting('lastBriefTs', Date.now())
  })

  // federation
  ipcMain.handle(IPC.fedStatus, () => ({
    enabled: getSetting<boolean>('fedEnabled', false),
    address: federation?.address() ?? null,
    name: getSetting<string>('fedName', 'chimera')
  }))
  ipcMain.handle(IPC.fedSetEnabled, async (_e, payload: unknown) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(payload)
    await federation?.setEnabled(enabled)
  })
  ipcMain.handle(IPC.fedSetName, (_e, payload: unknown) => {
    const { name } = z.object({ name: z.string().min(1).max(40) }).parse(payload)
    setSetting('fedName', name)
  })
  ipcMain.handle(IPC.fedPeers, () => federation?.listPeers() ?? [])
  ipcMain.handle(IPC.fedAddPeer, (_e, payload: unknown) => {
    const { name, url } = z
      .object({ name: z.string().min(1).max(40), url: z.string().url() })
      .parse(payload)
    federation?.addPeer(name, url)
  })
  ipcMain.handle(IPC.fedRemovePeer, (_e, payload: unknown) => {
    federation?.removePeer(z.object({ id: idSchema }).parse(payload).id)
  })

  // fork
  ipcMain.handle(IPC.conversationFork, (_e, payload: unknown) => {
    const { conversationId } = z.object({ conversationId: idSchema }).parse(payload)
    const fork = createForkOf(conversationId)
    copyTranscript(conversationId, fork.id)
    manager.registerConversation(fork.id)
    return fork
  })

  // search
  ipcMain.handle(IPC.searchAll, (_e, payload: unknown) => {
    const { query } = z.object({ query: z.string().min(2).max(200) }).parse(payload)
    return searchTranscripts(query).map((hit) => ({
      ...hit,
      title: getConversation(hit.conversationId)?.title ?? 'deleted conversation'
    }))
  })

  ipcMain.handle(IPC.backupExport, () => exportBackup())
  ipcMain.handle(IPC.autostartGet, () => ({
    enabled: isAutostartEnabled(),
    note: autostartNote()
  }))
  ipcMain.handle(IPC.autostartSet, (_e, payload: unknown) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(payload)
    setAutostart(enabled)
  })
  ipcMain.handle(IPC.appQuit, () => {
    app.quit()
  })

  // generic settings
  ipcMain.handle(IPC.settingsGet, (_e, payload: unknown) => {
    const { key } = z.object({ key: z.literal('onboarded') }).parse(payload)
    return getSetting<unknown>(key, null)
  })
  ipcMain.handle(IPC.settingsSet, (_e, payload: unknown) => {
    const { key, value } = z
      .object({ key: z.literal('onboarded'), value: z.boolean() })
      .parse(payload)
    setSetting(key, value)
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
