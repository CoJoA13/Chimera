import { describe, it, expect } from 'vitest'
import { readMemory, saveMemory, deleteMemory } from '../src/main/store/memory'
import { recordSpend, todaySpend, spendByConversation } from '../src/main/store/spend'
import { computeNextRun, addSchedule, dueSchedules, markRan } from '../src/main/store/schedules'
import { createConversation } from '../src/main/store/conversations'
import { saveTemplateFromConversation, getTemplate, listTemplates } from '../src/main/store/templates'
import { busToolDefs } from '../src/main/bus/tools'
import { BusCore } from '../src/main/bus/BusCore'
import {
  addWatcher,
  listWatchers,
  setWatcherState,
  removeWatchersFor
} from '../src/main/store/watchers'

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

describe('watchers store', () => {
  it('round-trips and tracks git state', () => {
    const w = addWatcher('watch-conv', '/tmp/some-repo', 'git', 'review new commits')
    expect(listWatchers().find((x) => x.id === w.id)?.lastState).toBeNull()
    setWatcherState(w.id, 'abc123')
    expect(listWatchers().find((x) => x.id === w.id)?.lastState).toBe('abc123')
    removeWatchersFor('watch-conv')
    expect(listWatchers().some((x) => x.conversationId === 'watch-conv')).toBe(false)
  })
})

describe('agent-managed schedules', () => {
  it('creates, lists, and deletes schedules scoped to the caller', async () => {
    const defs = busToolDefs(new BusCore(), 'sched-tool-conv')
    const create = defs.find((d) => d.name === 'create_schedule')!
    const list = defs.find((d) => d.name === 'list_schedules')!
    const del = defs.find((d) => d.name === 'delete_schedule')!

    const created = await create.handler({
      prompt: 'check the repo',
      every_hours: 4
    } as never)
    expect(created.isError).toBeUndefined()
    const scheduleId = (JSON.parse(created.content[0].text) as { schedule_id: string }).schedule_id

    const listed = JSON.parse((await list.handler({} as never)).content[0].text) as {
      schedules: { schedule_id: string }[]
    }
    expect(listed.schedules.some((s) => s.schedule_id === scheduleId)).toBe(true)

    // Another session cannot delete it.
    const otherDefs = busToolDefs(new BusCore(), 'other-conv')
    const otherDel = otherDefs.find((d) => d.name === 'delete_schedule')!
    const denied = await otherDel.handler({ schedule_id: scheduleId } as never)
    expect(denied.isError).toBe(true)

    const removed = await del.handler({ schedule_id: scheduleId } as never)
    expect(removed.isError).toBeUndefined()
  })

  it('rejects schedules without a cadence and from the control room', async () => {
    const defs = busToolDefs(new BusCore(), 'sched-tool-conv2')
    const create = defs.find((d) => d.name === 'create_schedule')!
    expect((await create.handler({ prompt: 'x' } as never)).isError).toBe(true)
    const crDefs = busToolDefs(new BusCore(), 'control-room')
    const crCreate = crDefs.find((d) => d.name === 'create_schedule')!
    expect((await crCreate.handler({ prompt: 'x', every_hours: 1 } as never)).isError).toBe(true)
  })
})

describe('federation bus injection', () => {
  it('routes external messages and resolves awaits on external replies', async () => {
    const core = new BusCore()
    const delivered: string[] = []
    core.register(
      'local-a',
      () => ({
        localId: 'local-a',
        conversationId: 'local-a',
        title: 'A',
        provider: 'claude',
        status: 'idle'
      }),
      (msg) => delivered.push(msg.text)
    )
    // Inbound federated message routes to the local session.
    core.injectExternal({
      messageId: 'fed-msg-1',
      from: 'fed:peer:remote-1',
      to: 'local-a',
      text: 'hello from another machine',
      expectsReply: true
    })
    expect(delivered).toEqual(['hello from another machine'])

    // Local session sends out and awaits; an external reply resolves it.
    core.register(
      'fed:peer:remote-1',
      () => ({
        localId: 'fed:peer:remote-1',
        conversationId: 'fed:peer:remote-1',
        title: 'Remote',
        provider: 'remote',
        status: 'idle'
      }),
      () => {}
    )
    const outId = core.send('local-a', 'fed:peer:remote-1', 'question', true)
    const pending = core.awaitReply('local-a', outId, 10)
    core.injectExternal({
      messageId: 'fed-reply-1',
      from: 'fed:peer:remote-1',
      to: 'local-a',
      text: 'remote answer',
      inReplyTo: outId,
      expectsReply: false
    })
    expect(await pending).toEqual({ status: 'replied', text: 'remote answer' })
  })
})

describe('missions', () => {
  it('creates a mission with a schedule, updates progress, stops on done', async () => {
    const conv = createConversation('claude', 'claude-sonnet-5', { title: 'Mission conv' })
    const { addMission, updateMissionProgress, listMissions } = await import(
      '../src/main/store/missions'
    )
    const { listSchedules } = await import('../src/main/store/schedules')
    const mission = addMission('Test mission', 'Do the thing', conv.id, {
      type: 'interval',
      minutes: 60
    })
    expect(mission.status).toBe('active')
    expect(listSchedules().some((s) => s.id === mission.scheduleId)).toBe(true)
    updateMissionProgress(mission.id, 'halfway there')
    expect(listMissions().find((m) => m.id === mission.id)?.progress).toBe('halfway there')
    updateMissionProgress(mission.id, 'complete', 'done')
    const finished = listMissions().find((m) => m.id === mission.id)!
    expect(finished.status).toBe('done')
    expect(listSchedules().some((s) => s.id === mission.scheduleId)).toBe(false)
  })
})

describe('skill distillation', () => {
  it('saves, lists, and deletes skills in the distilled plugin', async () => {
    const { saveSkill, listSkills, deleteSkill, distilledPluginPath } = await import(
      '../src/main/store/skills'
    )
    const slug = saveSkill('Test Skill Name!', 'When testing skills', '# Steps\n1. do it')
    expect(slug).toBe('test-skill-name')
    expect(listSkills().some((s) => s.slug === slug)).toBe(true)
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(existsSync(join(distilledPluginPath(), '.claude-plugin', 'plugin.json'))).toBe(true)
    deleteSkill(slug)
    expect(listSkills().some((s) => s.slug === slug)).toBe(false)
  })
})

describe('github plugin installs', () => {
  it('normalizes repo inputs', async () => {
    const { normalizeGitUrl } = await import('../src/main/store/plugins')
    expect(normalizeGitUrl('owner/repo')).toEqual({
      url: 'https://github.com/owner/repo.git',
      dirName: 'owner-repo'
    })
    expect(normalizeGitUrl('https://github.com/o/r.git/')).toEqual({
      url: 'https://github.com/o/r.git',
      dirName: 'o-r'
    })
    expect(normalizeGitUrl('https://github.com/o/r')).toEqual({
      url: 'https://github.com/o/r.git',
      dirName: 'o-r'
    })
    expect(() => normalizeGitUrl('https://gitlab.com/o/r')).toThrow(/github/)
    expect(() => normalizeGitUrl('not a repo')).toThrow()
  })

  it('registers plugins with git source, dedupes by path, cleans repo on removal', async () => {
    const { mkdtempSync, mkdirSync: mk, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { addPlugin, listPlugins, removePlugin } = await import('../src/main/store/plugins')
    const dir = mkdtempSync(join(tmpdir(), 'chimera-plugin-'))
    mk(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'test-git-plugin' })
    )
    const a = addPlugin(dir, 'https://github.com/x/y.git')
    const b = addPlugin(dir, 'https://github.com/x/y.git')
    expect(a.id).toBe(b.id) // deduped by path
    expect(listPlugins().find((p) => p.id === a.id)?.gitUrl).toContain('github.com/x/y')
    removePlugin(a.id)
    expect(listPlugins().some((p) => p.id === a.id)).toBe(false)
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
