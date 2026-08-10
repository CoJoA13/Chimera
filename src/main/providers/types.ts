import type { SessionEvent } from '../../shared/events'
import type { ModelInfo, ProviderId } from '../../shared/models'
import type { AuthStatus } from '../../shared/ipc'

export interface PermissionRequest {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  suggestions?: unknown
}

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; always?: boolean }
  | { behavior: 'deny'; message?: string }

export interface McpServerRuntimeConfig {
  name: string
  /** Matches the Agent SDK / Claude Desktop mcpServers value shapes. */
  config:
    | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
    | { type: 'http'; url: string; headers?: Record<string, string> }
    | { type: 'sse'; url: string; headers?: Record<string, string> }
    /** In-process SDK MCP server instance (chimera-bus). Claude only. */
    | { type: 'sdk'; instance: unknown }
}

export interface CreateSessionOptions {
  model: string
  cwd?: string
  systemPromptAppend?: string
  mcpServers?: McpServerRuntimeConfig[]
  plugins?: { type: 'local'; path: string }[]
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  onEvent: (ev: SessionEvent) => void
  onPermissionRequest?: (req: PermissionRequest) => Promise<PermissionDecision>
}

export interface UserInput {
  text: string
  attachments?: { path: string; mimeType: string }[]
}

export interface ProviderSession {
  readonly localId: string
  readonly providerSessionId: string | null
  readonly status: 'idle' | 'busy'
  send(input: UserInput): Promise<void>
  interrupt(): Promise<void>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: NonNullable<CreateSessionOptions['permissionMode']>): Promise<void>
  dispose(): Promise<void>
}

export interface ChatProvider {
  readonly id: ProviderId
  listModels(): ModelInfo[]
  authStatus(): Promise<AuthStatus>
  launchLogin(): Promise<void>
  createSession(localId: string, opts: CreateSessionOptions): ProviderSession
  resumeSession(
    localId: string,
    providerSessionId: string,
    opts: CreateSessionOptions
  ): ProviderSession
}
