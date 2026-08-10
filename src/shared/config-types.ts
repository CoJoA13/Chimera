import type { ProviderId } from './models'

export type McpTransport =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> }

export interface McpServerRecord {
  id: string
  name: string
  transport: McpTransport
  enabledByDefault: boolean
  source: 'manual' | 'claude-desktop-import' | 'connector-directory'
}

export interface ConversationRecord {
  id: string
  title: string
  provider: ProviderId
  model: string
  providerSessionId: string | null
  cwd: string | null
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  createdAt: number
  updatedAt: number
}

export interface ConversationMcpState {
  server: McpServerRecord
  enabled: boolean
}

export interface ClaudeDesktopImportCandidate {
  name: string
  transport: McpTransport
  alreadyImported: boolean
}
