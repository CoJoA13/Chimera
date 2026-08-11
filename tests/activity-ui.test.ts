import { describe, expect, it } from 'vitest'
import { IDLE_ACTIVITY, reduceAgentActivity } from '../src/shared/activity'
import { stampSessionEvent } from '../src/shared/events'
import { formatRelativeTime } from '../src/shared/time'
import { useChat } from '../src/renderer/src/stores/chat'
import { hookPluginNames, uniqueGitPlugins } from '../src/shared/plugins'

const base = { localId: 'conversation-1', turnId: 'turn-1' }

describe('event timestamps', () => {
  it('stamps an unstamped event once and preserves its first ingress time', () => {
    const stamped = stampSessionEvent({ ...base, type: 'text.delta', blockId: 'b', text: 'a' }, 100)
    expect(stamped.at).toBe(100)
    expect(stampSessionEvent(stamped, 200).at).toBe(100)
  })

  it('formats recent and older activity without depending on locale', () => {
    expect(formatRelativeTime(91_000, 100_000)).toBe('now')
    expect(formatRelativeTime(55_000, 100_000)).toBe('45s ago')
    expect(formatRelativeTime(100_000 - 3_600_000, 100_000)).toBe('1h ago')
  })
})

describe('live agent activity', () => {
  it('tracks thinking, tools, peer waits, response, and completion', () => {
    let state = reduceAgentActivity(IDLE_ACTIVITY, { ...base, type: 'turn.started', at: 10 })
    expect(state).toMatchObject({ phase: 'thinking', since: 10 })
    state = reduceAgentActivity(state, { ...base, type: 'tool.started', toolUseId: 't', toolName: 'Bash', input: {}, at: 20 })
    expect(state).toMatchObject({ phase: 'using_tool', detail: 'Bash' })
    state = reduceAgentActivity(state, { type: 'bus.status', localId: base.localId, status: 'awaiting', peerLocalId: 'peer', at: 30 })
    expect(state).toMatchObject({ phase: 'waiting_peer', detail: 'peer' })
    state = reduceAgentActivity(state, { ...base, type: 'text.delta', blockId: 'b', text: 'answer', at: 40 })
    expect(state.phase).toBe('responding')
    state = reduceAgentActivity(state, { ...base, type: 'turn.completed', isError: false, at: 50 })
    expect(state).toEqual(IDLE_ACTIVITY)
  })

  it('never derives live status from incomplete replay history', () => {
    const orphanTool = { ...base, type: 'tool.started' as const, toolUseId: 't', toolName: 'Bash', input: {}, at: 20 }
    expect(reduceAgentActivity(IDLE_ACTIVITY, orphanTool, 'replay')).toEqual(IDLE_ACTIVITY)
    const replay = [
      { ...base, type: 'thinking.done' as const, blockId: 'r', text: 'reasoning', at: 10 },
      orphanTool
    ]
    expect(replay.reduce((state, event) => reduceAgentActivity(state, event, 'replay'), IDLE_ACTIVITY)).toEqual(IDLE_ACTIVITY)
  })

  it('tracks permission waits, fatal errors, and concurrent group completion', () => {
    let state = reduceAgentActivity(IDLE_ACTIVITY, { ...base, type: 'turn.started', at: 10 })
    state = reduceAgentActivity(state, { type: 'permission.request', localId: base.localId, requestId: 'p', toolName: 'Bash', input: {}, at: 20 })
    expect(state.phase).toBe('waiting_permission')
    state = reduceAgentActivity(state, { type: 'permission.resolved', localId: base.localId, requestId: 'p', behavior: 'allow', at: 30 })
    expect(state.phase).toBe('thinking')
    state = reduceAgentActivity(state, { ...base, type: 'turn.completed', isError: false, groupDone: false, at: 40 })
    expect(state.phase).toBe('thinking')
    expect(reduceAgentActivity(state, { type: 'session.error', localId: base.localId, message: 'warning', fatal: false, at: 50 })).toEqual(state)
    expect(reduceAgentActivity(state, { type: 'session.error', localId: base.localId, message: 'failed', fatal: true, at: 60 }).phase).toBe('error')
  })
})

describe('chat send lifecycle', () => {
  it('returns activity to idle when admission fails', async () => {
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { chimera: { sendMessage: async () => Promise.reject(new Error('budget reached')) } }
    })
    useChat.setState({
      activeConvId: 'conversation-1',
      sessionByConv: { 'conversation-1': 'conversation-1' },
      statusByConv: { 'conversation-1': 'idle' },
      activityByConv: {},
      blocksByConv: {},
      conversations: [{ id: 'conversation-1', kind: 'single', provider: 'claude' } as never]
    })
    await useChat.getState().send('hello')
    expect(useChat.getState().activityByConv['conversation-1']).toEqual(IDLE_ACTIVITY)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  })
})

describe('plugin bulk management', () => {
  const plugins = [
    { id: 'a', name: 'Safe', gitUrl: 'https://github.com/x/market.git' },
    { id: 'b', name: 'Hooked', gitUrl: 'https://github.com/x/market.git' },
    { id: 'c', name: 'Other', gitUrl: 'https://github.com/y/plugin.git' }
  ]
  it('names every hook-bearing plugin for confirmation', () => {
    expect(hookPluginNames(plugins, {
      a: { id: 'a', description: null, version: null, capabilities: { skills: 0, agents: 0, commands: 0, hooks: 0 }, hasHooks: false, health: 'ready', issue: null },
      b: { id: 'b', description: null, version: null, capabilities: { skills: 0, agents: 0, commands: 0, hooks: 1 }, hasHooks: true, health: 'ready', issue: null }
    })).toEqual(['Hooked'])
  })
  it('updates a marketplace repository only once', () => {
    expect(uniqueGitPlugins(plugins).map((plugin) => plugin.id)).toEqual(['b', 'c'])
  })
})
