/**
 * Normalized session events — the only session data that crosses IPC.
 * Both providers (Claude Agent SDK, Codex SDK) normalize into this union.
 */

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export type SessionEvent =
  | { type: 'turn.started'; localId: string; turnId: string }
  /** User input replayed from stored history (live user input is rendered locally). */
  | { type: 'user.message'; localId: string; turnId: string; text: string }
  | { type: 'text.delta'; localId: string; turnId: string; blockId: string; text: string }
  | { type: 'text.done'; localId: string; turnId: string; blockId: string; text: string }
  | { type: 'thinking.delta'; localId: string; turnId: string; blockId: string; text: string }
  | { type: 'thinking.done'; localId: string; turnId: string; blockId: string; text: string }
  | {
      type: 'tool.started'
      localId: string
      turnId: string
      toolUseId: string
      toolName: string
      input: unknown
    }
  | {
      type: 'tool.output'
      localId: string
      turnId: string
      toolUseId: string
      output: unknown
      isError: boolean
    }
  | {
      type: 'permission.request'
      localId: string
      requestId: string
      toolName: string
      input: unknown
      suggestions?: unknown
    }
  | { type: 'permission.resolved'; localId: string; requestId: string; behavior: 'allow' | 'deny' }
  | {
      type: 'turn.completed'
      localId: string
      turnId: string
      usage?: Usage
      costUsd?: number
      durationMs?: number
      isError: boolean
      errorMessage?: string
    }
  | { type: 'session.registered'; localId: string; providerSessionId: string; model: string }
  | {
      type: 'bus.message'
      localId: string
      direction: 'in' | 'out'
      from: string
      to: string
      messageId: string
      inReplyTo?: string
      text: string
    }
  /** Live bus activity: the session is blocked awaiting a peer's reply (or no longer is). */
  | { type: 'bus.status'; localId: string; status: 'awaiting' | 'idle'; peerLocalId?: string }
  | { type: 'session.error'; localId: string; message: string; fatal: boolean }
