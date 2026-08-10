import { describe, it, expect } from 'vitest'
import { readMemory, saveMemory, deleteMemory } from '../src/main/store/memory'
import { recordSpend, todaySpend, spendByConversation } from '../src/main/store/spend'
import { computeNextRun, addSchedule, dueSchedules, markRan } from '../src/main/store/schedules'
import { createConversation } from '../src/main/store/conversations'
import { saveTemplateFromConversation, getTemplate, listTemplates } from '../src/main/store/templates'
import { busToolDefs } from '../src/main/bus/tools'
import { BusCore } from '../src/main/bus/BusCore'

describe('agent memory', () => {
  it('round-trips and enforces the size cap', () => {
    expect(readMemory('mem-test')).toBe('')
    saveMemory('mem-test', '# Notes\n- user prefers tabs')
    expect(readMemory('mem-test')).toContain('prefers tabs')
    expect(() => saveMemory('mem-test', 'x'.repeat(9000))).toThrow(/too large/i)
    deleteMemory('mem-test')
    expect(readMemory('mem-test')).toBe('')
  })

  it('is exposed via bus tools bound to the caller', async () => {
    const defs = busToolDefs(new BusCore(), 'tool-mem-test')
    const save = defs.find((d) => d.name === 'save_memory')!
    const read = defs.find((d) => d.name === 'read_memory')!
    await save.handler({ content: 'remember the milk' } as never)
    const result = await read.handler({} as never)
    expect(result.content[0].text).toContain('remember the milk')
    deleteMemory('tool-mem-test')
  })
})

describe('spend tracking', () => {
  it('accumulates per conversation per day', () => {
    const before = todaySpend()
    recordSpend('spend-a', 0.5)
    recordSpend('spend-a', 0.25)
    recordSpend('spend-b', 1)
    expect(todaySpend()).toBeCloseTo(before + 1.75, 5)
    const rows = spendByConversation()
    expect(rows.find((r) => r.conversationId === 'spend-a')?.cost).toBeCloseTo(0.75, 5)
  })

  it('ignores zero and negative costs', () => {
    const before = todaySpend()
    recordSpend('spend-c', 0)
    recordSpend('spend-c', -1)
    expect(todaySpend()).toBe(before)
  })
})

describe('schedules', () => {
  it('computes interval and daily next runs', () => {
    const now = Date.now()
    expect(computeNextRun({ type: 'interval', minutes: 60 }, now)).toBe(now + 3_600_000)
    const next = computeNextRun({ type: 'daily', time: '08:00' }, now)
    expect(next).toBeGreaterThan(now)
    expect(new Date(next).getHours()).toBe(8)
  })

  it('reports due schedules and advances on markRan', () => {
    const s = addSchedule('sched-conv', 'do the thing', { type: 'interval', minutes: 30 })
    expect(dueSchedules(Date.now()).find((d) => d.id === s.id)).toBeUndefined()
    expect(dueSchedules(Date.now() + 31 * 60_000).find((d) => d.id === s.id)).toBeDefined()
    markRan(s.id, s.cadence)
    // Next run is now ~30min out again: not due just before, due just after.
    expect(dueSchedules(Date.now() + 29 * 60_000).find((d) => d.id === s.id)).toBeUndefined()
    expect(dueSchedules(Date.now() + 31 * 60_000).find((d) => d.id === s.id)).toBeDefined()
  })
})

describe('templates', () => {
  it('captures a single conversation with persona', () => {
    const conv = createConversation('claude', 'claude-sonnet-5', {
      personaName: 'Reviewer',
      personaPrompt: 'Review things.'
    })
    const t = saveTemplateFromConversation(conv.id, 'My Reviewer')
    const loaded = getTemplate(t.id)!
    expect(loaded.spec.kind).toBe('single')
    expect(loaded.spec.members[0]).toMatchObject({
      provider: 'claude',
      personaName: 'Reviewer'
    })
    expect(listTemplates().some((x) => x.name === 'My Reviewer')).toBe(true)
  })

  it('captures a group with all members', () => {
    const group = createConversation('claude', 'claude-sonnet-5', { title: 'Panel', kind: 'group' })
    createConversation('claude', 'claude-sonnet-5', { title: 'A', groupId: group.id })
    createConversation('codex', 'gpt-5.6-sol', { title: 'B', groupId: group.id })
    const t = saveTemplateFromConversation(group.id, 'Panel Template')
    const loaded = getTemplate(t.id)!
    expect(loaded.spec.kind).toBe('group')
    expect(loaded.spec.members.map((m) => m.title)).toEqual(['A', 'B'])
  })
})
