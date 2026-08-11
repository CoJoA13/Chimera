import type { SessionEvent } from './events'

export type ActivityPhase =
  | 'idle'
  | 'queued'
  | 'thinking'
  | 'using_tool'
  | 'waiting_permission'
  | 'waiting_peer'
  | 'responding'
  | 'error'

export interface AgentActivity {
  phase: ActivityPhase
  since: number | null
  detail?: string
  memberName?: string
}

export const IDLE_ACTIVITY: AgentActivity = { phase: 'idle', since: null }

/**
 * Reduce live transport events into user-visible activity. Replay is deliberately
 * ignored: cached transcripts omit lifecycle events and may end mid-tool.
 */
export function reduceAgentActivity(
  state: AgentActivity,
  event: SessionEvent,
  source: 'live' | 'replay' = 'live',
  now = Date.now()
): AgentActivity {
  if (source === 'replay') return state
  const since = event.at ?? now
  const memberName = 'memberName' in event ? event.memberName : undefined
  switch (event.type) {
    case 'turn.started':
    case 'thinking.delta':
    case 'thinking.done':
      return { phase: 'thinking', since, memberName }
    case 'tool.started':
      return { phase: 'using_tool', since, detail: event.toolName, memberName }
    case 'tool.output':
    case 'permission.resolved':
      return { phase: 'thinking', since, memberName }
    case 'permission.request':
      return { phase: 'waiting_permission', since, detail: event.toolName }
    case 'bus.status':
      return event.status === 'awaiting'
        ? { phase: 'waiting_peer', since, detail: event.peerLocalId }
        : state.phase === 'waiting_peer'
          ? { phase: 'thinking', since }
          : state
    case 'text.delta':
    case 'text.done':
      return { phase: 'responding', since, memberName }
    case 'turn.completed':
      return event.groupDone === false ? state : IDLE_ACTIVITY
    case 'session.error':
      return { phase: 'error', since, detail: event.message, memberName }
    default:
      return state
  }
}

export function queuedActivity(at = Date.now()): AgentActivity {
  return { phase: 'queued', since: at }
}
