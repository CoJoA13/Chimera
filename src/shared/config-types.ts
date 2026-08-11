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
  personaName: string | null
  personaPrompt: string | null
  kind: 'single' | 'group'
  /** For member conversations: the group they belong to. */
  groupId: string | null
  /** Fork created but not yet branched: first session start uses forkSession. */
  forkPending: boolean
  /** Cross-model verification annotations on this conversation's answers. */
  autoVerify: boolean
  /** Populated on kind='group' records when listing. */
  groupMembers?: {
    id: string
    title: string
    provider: ProviderId
    permissionMode: ConversationRecord['permissionMode']
  }[]
  createdAt: number
  updatedAt: number
}

export interface GroupMemberSpec {
  provider: ProviderId
  model: string
  title: string
  personaName?: string | null
  personaPrompt?: string | null
}

export interface PersonaPreset {
  name: string
  prompt: string
}

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    name: 'Reviewer',
    prompt:
      'You are a meticulous code reviewer. Focus on correctness, security, and maintainability. Be direct about problems, cite file/line evidence, and always distinguish must-fix issues from suggestions.'
  },
  {
    name: 'Architect',
    prompt:
      'You are a software architect. Think in interfaces, data flow, and failure modes. Prefer the simplest design that meets requirements, name trade-offs explicitly, and push back on accidental complexity.'
  },
  {
    name: 'Tester',
    prompt:
      'You are a QA engineer. Hunt for edge cases, write and run tests, and never call something working without evidence. Report exact reproduction steps for anything you break.'
  },
  {
    name: 'Researcher',
    prompt:
      'You are a research assistant. Gather information carefully, cite sources, quantify uncertainty, and summarize findings in a structured, skimmable form.'
  }
]

export interface ConversationMcpState {
  server: McpServerRecord
  enabled: boolean
}

export interface ClaudeDesktopImportCandidate {
  name: string
  transport: McpTransport
  alreadyImported: boolean
}
