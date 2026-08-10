import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ClaudeDesktopImportCandidate,
  ConversationMcpState,
  McpServerRecord,
  McpTransport
} from '../../shared/config-types'
import { getDb } from './db'

interface Row {
  id: string
  name: string
  transport_json: string
  enabled_by_default: number
  source: string
}

function toRecord(row: Row): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    transport: JSON.parse(row.transport_json) as McpTransport,
    enabledByDefault: row.enabled_by_default === 1,
    source: row.source as McpServerRecord['source']
  }
}

export function listMcpServers(): McpServerRecord[] {
  const rows = getDb().prepare('SELECT * FROM mcp_servers ORDER BY name').all() as unknown as Row[]
  return rows.map(toRecord)
}

export function addMcpServer(
  name: string,
  transport: McpTransport,
  source: McpServerRecord['source'] = 'manual',
  enabledByDefault = true
): McpServerRecord {
  const record: McpServerRecord = { id: randomUUID(), name, transport, enabledByDefault, source }
  getDb()
    .prepare(
      'INSERT INTO mcp_servers (id, name, transport_json, enabled_by_default, source) VALUES (?, ?, ?, ?, ?)'
    )
    .run(record.id, name, JSON.stringify(transport), enabledByDefault ? 1 : 0, source)
  // Existing conversations get the new server, following the default flag.
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO conversation_mcp (conversation_id, mcp_server_id, enabled)
       SELECT id, ?, ? FROM conversations`
    )
    .run(record.id, enabledByDefault ? 1 : 0)
  return record
}

export function updateMcpServer(record: McpServerRecord): void {
  getDb()
    .prepare('UPDATE mcp_servers SET name = ?, transport_json = ?, enabled_by_default = ? WHERE id = ?')
    .run(record.name, JSON.stringify(record.transport), record.enabledByDefault ? 1 : 0, record.id)
}

export function removeMcpServer(id: string): void {
  getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  getDb().prepare('DELETE FROM conversation_mcp WHERE mcp_server_id = ?').run(id)
}

export function conversationMcpState(conversationId: string): ConversationMcpState[] {
  const servers = listMcpServers()
  const rows = getDb()
    .prepare('SELECT mcp_server_id, enabled FROM conversation_mcp WHERE conversation_id = ?')
    .all(conversationId) as unknown as { mcp_server_id: string; enabled: number }[]
  const enabledMap = new Map(rows.map((r) => [r.mcp_server_id, r.enabled === 1]))
  return servers.map((server) => ({
    server,
    enabled: enabledMap.get(server.id) ?? server.enabledByDefault
  }))
}

export function setConversationMcp(
  conversationId: string,
  mcpServerId: string,
  enabled: boolean
): void {
  getDb()
    .prepare(
      `INSERT INTO conversation_mcp (conversation_id, mcp_server_id, enabled) VALUES (?, ?, ?)
       ON CONFLICT (conversation_id, mcp_server_id) DO UPDATE SET enabled = excluded.enabled`
    )
    .run(conversationId, mcpServerId, enabled ? 1 : 0)
}

export function enabledMcpForConversation(conversationId: string): McpServerRecord[] {
  return conversationMcpState(conversationId)
    .filter((s) => s.enabled)
    .map((s) => s.server)
}

const CLAUDE_DESKTOP_CONFIG = join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')

/** Parse Claude Desktop's mcpServers config into import candidates. */
export function claudeDesktopImportCandidates(): ClaudeDesktopImportCandidate[] {
  if (!existsSync(CLAUDE_DESKTOP_CONFIG)) return []
  let parsed: { mcpServers?: Record<string, Record<string, unknown>> }
  try {
    parsed = JSON.parse(readFileSync(CLAUDE_DESKTOP_CONFIG, 'utf8'))
  } catch {
    return []
  }
  const existing = new Set(listMcpServers().map((s) => s.name))
  const candidates: ClaudeDesktopImportCandidate[] = []
  for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
    let transport: McpTransport | null = null
    if (typeof cfg.command === 'string') {
      transport = {
        type: 'stdio',
        command: cfg.command,
        args: Array.isArray(cfg.args) ? (cfg.args as string[]) : undefined,
        env: cfg.env ? (cfg.env as Record<string, string>) : undefined
      }
    } else if (typeof cfg.url === 'string') {
      transport = {
        type: cfg.type === 'sse' ? 'sse' : 'http',
        url: cfg.url,
        headers: cfg.headers ? (cfg.headers as Record<string, string>) : undefined
      }
    }
    if (transport) {
      candidates.push({ name, transport, alreadyImported: existing.has(name) })
    }
  }
  return candidates
}

export function importClaudeDesktopServers(names: string[]): McpServerRecord[] {
  const candidates = claudeDesktopImportCandidates()
  const selected = candidates.filter((c) => names.includes(c.name) && !c.alreadyImported)
  return selected.map((c) => addMcpServer(c.name, c.transport, 'claude-desktop-import'))
}
