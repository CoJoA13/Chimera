import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BusCore, type BusMessage, type BusSessionInfo } from '../src/main/bus/BusCore'

function makeSession(
  core: BusCore,
  localId: string,
  title: string,
  status: 'idle' | 'busy' = 'idle'
): { delivered: BusMessage[]; setStatus: (s: 'idle' | 'busy') => void } {
  const delivered: BusMessage[] = []
  let currentStatus = status
  const info = (): BusSessionInfo => ({
    localId,
    conversationId: `conv-${localId}`,
    title,
    provider: 'claude',
    status: currentStatus
  })
  core.register(localId, info, (msg) => delivered.push(msg))
  return { delivered, setStatus: (s) => (currentStatus = s) }
}

describe('BusCore', () => {
  let core: BusCore

  beforeEach(() => {
    core = new BusCore()
  })

  it('lists other sessions but not the requester', () => {
    makeSession(core, 'a', 'Session A')
    makeSession(core, 'b', 'Session B')
    const seen = core.listSessions('a')
    expect(seen).toHaveLength(1)
    expect(seen[0].localId).toBe('b')
  })

  it('delivers to idle sessions immediately', () => {
    makeSession(core, 'a', 'A')
    const b = makeSession(core, 'b', 'B')
    const id = core.send('a', 'b', 'hello', false)
    expect(b.delivered).toHaveLength(1)
    expect(b.delivered[0].text).toBe('hello')
    expect(b.delivered[0].messageId).toBe(id)
  })

  it('queues for busy sessions and drains later', () => {
    makeSession(core, 'a', 'A')
    const b = makeSession(core, 'b', 'B', 'busy')
    core.send('a', 'b', 'queued message', false)
    expect(b.delivered).toHaveLength(0)
    expect(core.hasQueued('b')).toBe(true)
    const drained = core.drainInbox('b')
    expect(drained).toHaveLength(1)
    expect(drained[0].text).toBe('queued message')
    expect(core.hasQueued('b')).toBe(false)
  })

  it('notifies await-state changes for UI indicators', async () => {
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    const changes: [string, string[]][] = []
    core.onAwaitChange = (localId, peers) => changes.push([localId, peers])
    const id = core.send('a', 'b', 'question', true)
    const pending = core.awaitReply('a', id, 5)
    expect(changes).toEqual([['a', ['b']]])
    core.reply('b', id, 'answer')
    await pending
    expect(changes).toEqual([
      ['a', ['b']],
      ['a', []]
    ])
  })

  it('broadcasts to every other session', () => {
    makeSession(core, 'a', 'A')
    const b = makeSession(core, 'b', 'B')
    const c = makeSession(core, 'c', 'C')
    const results = core.broadcast('a', 'hello everyone', true)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.messageId)).toBe(true)
    expect(b.delivered).toHaveLength(1)
    expect(c.delivered).toHaveLength(1)
  })

  it('collects broadcast replies with await_replies, partial on timeout', async () => {
    vi.useFakeTimers()
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    makeSession(core, 'c', 'C')
    const results = core.broadcast('a', 'question for all', true)
    const ids = results.map((r) => r.messageId!)
    const pending = core.awaitReplies('a', ids, 5)
    // Only B replies; C stays silent.
    core.reply('b', ids[0], 'B answer')
    await vi.advanceTimersByTimeAsync(5100)
    const replies = await pending
    expect(replies).toHaveLength(2)
    expect(replies[0].result).toEqual({ status: 'replied', text: 'B answer' })
    expect(replies[1].result.status).toBe('timeout')
    vi.useRealTimers()
  })

  it('resolves await_replies immediately when all reply', async () => {
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    makeSession(core, 'c', 'C')
    const ids = core.broadcast('a', 'quick question', true).map((r) => r.messageId!)
    const pending = core.awaitReplies('a', ids, 60)
    core.reply('b', ids[0], 'one')
    core.reply('c', ids[1], 'two')
    const replies = await pending
    expect(replies.map((r) => r.result)).toEqual([
      { status: 'replied', text: 'one' },
      { status: 'replied', text: 'two' }
    ])
  })

  it('supports concurrent awaits to different peers', async () => {
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    makeSession(core, 'c', 'C')
    const idB = core.send('a', 'b', 'to b', true)
    const idC = core.send('a', 'c', 'to c', true)
    const pendingB = core.awaitReply('a', idB, 30)
    const pendingC = core.awaitReply('a', idC, 30)
    core.reply('c', idC, 'c first')
    core.reply('b', idB, 'b second')
    expect(await pendingC).toEqual({ status: 'replied', text: 'c first' })
    expect(await pendingB).toEqual({ status: 'replied', text: 'b second' })
  })

  it('resolves await_reply when the reply arrives', async () => {
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    const id = core.send('a', 'b', 'question', true)
    const pending = core.awaitReply('a', id, 5)
    core.reply('b', id, 'answer')
    const result = await pending
    expect(result).toEqual({ status: 'replied', text: 'answer' })
  })

  it('times out await_reply when no reply arrives', async () => {
    vi.useFakeTimers()
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    const id = core.send('a', 'b', 'question', true)
    const pending = core.awaitReply('a', id, 2)
    await vi.advanceTimersByTimeAsync(2100)
    const result = await pending
    expect(result.status).toBe('timeout')
    vi.useRealTimers()
  })

  it('detects a direct await cycle and fails fast', async () => {
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    const idAtoB = core.send('a', 'b', 'ping', true)
    const idBtoA = core.send('b', 'a', 'ping back', true)
    // A blocks on B...
    const pendingA = core.awaitReply('a', idAtoB, 30)
    // ...then B tries to block on A: must fail immediately, not deadlock.
    const resultB = await core.awaitReply('b', idBtoA, 30)
    expect(resultB.status).toBe('error')
    expect('error' in resultB && resultB.error).toMatch(/deadlock/i)
    // A can still be resolved normally.
    core.reply('b', idAtoB, 'pong')
    expect((await pendingA).status).toBe('replied')
  })

  it('rejects a second reply to the same message', async () => {
    const a = makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    const id = core.send('a', 'b', 'question', true)
    const pending = core.awaitReply('a', id, 5)
    core.reply('b', id, 'first answer')
    expect((await pending).status).toBe('replied')
    // A duplicate reply must be rejected, not delivered as a new message.
    expect(() => core.reply('b', id, 'second answer')).toThrow(/already replied/)
    expect(a.delivered).toHaveLength(0)
  })

  it('rejects replies from sessions that are not the recipient', () => {
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    makeSession(core, 'c', 'C')
    const id = core.send('a', 'b', 'private', true)
    expect(() => core.reply('c', id, 'intruding')).toThrow(/recipient/)
  })

  it('delivers unawaited replies as inbound messages', () => {
    const a = makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B')
    const id = core.send('a', 'b', 'fyi', false)
    core.reply('b', id, 'ack')
    expect(a.delivered).toHaveLength(1)
    expect(a.delivered[0].inReplyTo).toBe(id)
  })

  it('caps the inbox for busy sessions', () => {
    makeSession(core, 'a', 'A')
    makeSession(core, 'b', 'B', 'busy')
    for (let i = 0; i < 20; i++) core.send('a', 'b', `m${i}`, false)
    expect(() => core.send('a', 'b', 'overflow', false)).toThrow(/inbox is full/)
  })

  it('errors send to unknown sessions', () => {
    makeSession(core, 'a', 'A')
    expect(() => core.send('a', 'ghost', 'hi', false)).toThrow(/No such session/)
  })
})
