import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readMemory, saveMemory, deleteMemory } from '../src/main/store/memory'
import {
  recordSpend,
  todaySpend,
  todaySpendBreakdown,
  spendByConversation
} from '../src/main/store/spend'
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
import { resolveCodexExecutionPolicy } from '../src/main/providers/codex/CodexProvider'
import { applyMigrations, getDb } from '../src/main/store/db'
import {
  addAlwaysAllowRule,
  isAlwaysAllowed,
  removeRule,
  listRules
} from '../src/main/store/permissions'
import { groupMessageMentions } from '../src/main/ipc/sessions'
import { decodeWireBody, FederationManager, validateWireMessage } from '../src/main/federation'
import { WatcherManager } from '../src/main/watcherManager'
import {
  clearTranscript,
  loadTranscript,
  recordTranscriptEvent,
  searchTranscripts
} from '../src/main/store/transcript'
import { activitySince } from '../src/main/store/activity'

const CODEX_OPTS = {
  model: 'gpt-5.4',
  onEvent: () => {}
}

describe('Codex execution policy', () => {
  it('keeps a conversation read-only until a workspace is explicitly selected', () => {
    expect(resolveCodexExecutionPolicy(CODEX_OPTS).sandboxMode).toBe('read-only')
    expect(
      resolveCodexExecutionPolicy({ ...CODEX_OPTS, cwd: '/tmp/project' })
    ).toMatchObject({ workingDirectory: '/tmp/project', sandboxMode: 'workspace-write' })
  })

  it('pins plan and explicit full-access mappings', () => {
    expect(
      resolveCodexExecutionPolicy({ ...CODEX_OPTS, cwd: '/tmp/project', permissionMode: 'plan' })
        .sandboxMode
    ).toBe('read-only')
    expect(
      resolveCodexExecutionPolicy({ ...CODEX_OPTS, permissionMode: 'bypassPermissions' })
        .sandboxMode
    ).toBe('danger-full-access')
  })
})

describe('database migrations', () => {
  it('repairs a legacy database stopped between ALTER statements', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (0);
      CREATE TABLE example (id TEXT PRIMARY KEY);
      ALTER TABLE example ADD COLUMN first_value TEXT;
    `)
    applyMigrations(database, [
      `ALTER TABLE example ADD COLUMN first_value TEXT;
       ALTER TABLE example ADD COLUMN second_value TEXT;`
    ])
    const columns = database.prepare('PRAGMA table_info(example)').all() as unknown as {
      name: string
    }[]
    expect(columns.map((column) => column.name)).toEqual(['id', 'first_value', 'second_value'])
    expect(database.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 1 })
    database.close()
  })

  it('rolls back both schema and version when a migration fails', () => {
    const database = new DatabaseSync(':memory:')
    expect(() =>
      applyMigrations(database, [
        `CREATE TABLE durable (id TEXT);
         THIS IS NOT SQL;`
      ])
    ).toThrow()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'durable'").get()).toBeUndefined()
    expect(database.prepare('SELECT version FROM schema_version').get()).toBeUndefined()
    database.close()
  })

  it('expires legacy tool-wide permission rules when input scoping is introduced', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (0);
      CREATE TABLE permission_rules (id TEXT, tool_name TEXT, behavior TEXT);
      INSERT INTO permission_rules VALUES ('legacy', 'Bash', 'allow');
    `)
    applyMigrations(database, [
      `ALTER TABLE permission_rules ADD COLUMN input_pattern TEXT;
       DELETE FROM permission_rules WHERE input_pattern IS NULL;`
    ])
    expect(database.prepare('SELECT COUNT(*) count FROM permission_rules').get()).toEqual({
      count: 0
    })
    database.close()
  })

  it('adds estimate tracking without changing legacy spend totals', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (0);
      CREATE TABLE spend (
        day TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        cost REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (day, conversation_id)
      );
      INSERT INTO spend VALUES ('2026-08-10', 'legacy', 1.25);
    `)
    applyMigrations(database, [
      'ALTER TABLE spend ADD COLUMN estimated_cost REAL NOT NULL DEFAULT 0;'
    ])
    expect(database.prepare('SELECT cost, estimated_cost FROM spend').get()).toEqual({
      cost: 1.25,
      estimated_cost: 0
    })
    database.close()
  })
})

describe('permission rules', () => {
  it('scopes a new always-allow rule to the approved tool input', () => {
    const tool = `Bash-${Date.now()}`
    const conversation = 'permission-scope-test'
    addAlwaysAllowRule(tool, conversation, { command: 'git status', cwd: '/tmp/project' })
    expect(
      isAlwaysAllowed(tool, conversation, { cwd: '/tmp/project', command: 'git status' })
    ).toBe(true)
    expect(isAlwaysAllowed(tool, conversation, { command: 'rm -rf build' })).toBe(false)
    const rules = listRules().filter((candidate) => candidate.toolName === tool)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      conversationId: conversation,
      inputPattern: '{"command":"git status","cwd":"/tmp/project"}'
    })
    for (const rule of rules) {
      removeRule(rule.id)
    }
  })
})

describe('group mentions', () => {
  it('does not wake a prefix-named member', () => {
    expect(groupMessageMentions('@Tester please verify', 'Tester')).toBe(true)
    expect(groupMessageMentions('@Tester please verify', 'Test')).toBe(false)
    expect(groupMessageMentions('Question for @Code Reviewer.', 'Code Reviewer')).toBe(true)
  })
})

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
    expect(rows.find((r) => r.conversationId === 'spend-a')?.reportedCost).toBeCloseTo(0.75, 5)
  })

  it('keeps admission estimates separate from reported API cost', () => {
    const before = todaySpendBreakdown()
    recordSpend('spend-estimated', 0.1, 'estimated')
    recordSpend('spend-estimated', 0.42, 'actual')
    const after = todaySpendBreakdown()
    expect(after.reportedCost).toBeCloseTo(before.reportedCost + 0.42, 5)
    expect(after.estimatedCost).toBeCloseTo(before.estimatedCost + 0.1, 5)
    expect(spendByConversation().find((row) => row.conversationId === 'spend-estimated')).toMatchObject({
      reportedCost: 0.42,
      estimatedCost: 0.1,
      total: 0.52
    })
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

  it('does not consume a git commit while the target conversation is busy', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const repo = mkdtempSync(join(tmpdir(), 'chimera-watcher-retry-'))
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com'
        }
      }).trim()
    try {
      git('init', '-b', 'main')
      writeFileSync(join(repo, 'tracked.txt'), 'one')
      git('add', '.')
      git('commit', '-m', 'one')
      const conversation = createConversation('claude', 'claude-sonnet-5', {
        title: 'Watcher retry target'
      })
      const watcher = addWatcher(conversation.id, repo, 'git', 'review it')
      let busy = false
      let sends = 0
      const manager = new WatcherManager({
        isBusy: () => busy,
        startForConversation: async () => ({ localId: conversation.id, resumed: false }),
        send: async () => {
          sends++
        },
        groupSend: async () => {}
      } as never)
      await manager.pollGit() // establish baseline
      const baseline = listWatchers().find((item) => item.id === watcher.id)!.lastState
      writeFileSync(join(repo, 'tracked.txt'), 'two')
      git('add', '.')
      git('commit', '-m', 'two')
      const newHead = git('rev-parse', 'HEAD')

      busy = true
      await manager.pollGit()
      expect(listWatchers().find((item) => item.id === watcher.id)!.lastState).toBe(baseline)
      expect(sends).toBe(0)

      busy = false
      await manager.pollGit()
      expect(listWatchers().find((item) => item.id === watcher.id)!.lastState).toBe(newHead)
      expect(sends).toBe(1)
      removeWatchersFor(conversation.id)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('does not deliver the same git commit from overlapping polls', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const repo = mkdtempSync(join(tmpdir(), 'chimera-watcher-overlap-'))
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com'
        }
      }).trim()
    const conversation = createConversation('claude', 'claude-sonnet-5', {
      title: 'Watcher overlap target'
    })
    try {
      git('init', '-b', 'main')
      writeFileSync(join(repo, 'tracked.txt'), 'one')
      git('add', '.')
      git('commit', '-m', 'one')
      addWatcher(conversation.id, repo, 'git', 'review it')
      let releaseSend!: () => void
      const sendBlocked = new Promise<void>((resolve) => (releaseSend = resolve))
      let enteredSend!: () => void
      const sendEntered = new Promise<void>((resolve) => (enteredSend = resolve))
      let sends = 0
      const manager = new WatcherManager({
        isBusy: () => false,
        startForConversation: async () => ({ localId: conversation.id, resumed: false }),
        send: async () => {
          sends++
          enteredSend()
          await sendBlocked
        },
        groupSend: async () => {}
      } as never)
      await manager.pollGit()
      writeFileSync(join(repo, 'tracked.txt'), 'two')
      git('add', '.')
      git('commit', '-m', 'two')

      const first = manager.pollGit()
      await sendEntered
      const second = manager.pollGit()
      releaseSend()
      await Promise.all([first, second])
      expect(sends).toBe(1)
    } finally {
      removeWatchersFor(conversation.id)
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('retries a busy file trigger but does not retry a permanent send failure', async () => {
    vi.useFakeTimers()
    const conversation = createConversation('claude', 'claude-sonnet-5', {
      title: 'File retry target'
    })
    const watcher = addWatcher(conversation.id, '/tmp', 'files', 'review it')
    let busy = true
    let fail = false
    let sends = 0
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manager = new WatcherManager({
      isBusy: () => busy,
      startForConversation: async () => ({ localId: conversation.id, resumed: false }),
      send: async () => {
        sends++
        if (fail) throw new Error('permanent failure')
      },
      groupSend: async () => {}
    } as never)
    const queue = manager as unknown as {
      queueFileFire: (watcherId: string, filename: string) => void
    }
    try {
      queue.queueFileFire(watcher.id, 'one.txt')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(sends).toBe(0)
      busy = false
      await vi.advanceTimersByTimeAsync(30_000)
      expect(sends).toBe(1)

      fail = true
      queue.queueFileFire(watcher.id, 'two.txt')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(sends).toBe(2)
      await vi.advanceTimersByTimeAsync(30 * 60_000)
      expect(sends).toBe(2)
    } finally {
      removeWatchersFor(conversation.id)
      errorSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('stops a busy file trigger after five backoff retries and logs the drop', async () => {
    vi.useFakeTimers()
    const conversation = createConversation('claude', 'claude-sonnet-5', {
      title: 'File exhaustion target'
    })
    const watcher = addWatcher(conversation.id, '/tmp', 'files', 'review it')
    const since = Date.now() - 1
    let busyChecks = 0
    const manager = new WatcherManager({
      isBusy: () => {
        busyChecks++
        return true
      },
      startForConversation: async () => ({ localId: conversation.id, resumed: false }),
      send: async () => {},
      groupSend: async () => {}
    } as never)
    const queue = manager as unknown as {
      queueFileFire: (watcherId: string, filename: string) => void
    }
    try {
      queue.queueFileFire(watcher.id, 'busy.txt')
      await vi.advanceTimersByTimeAsync(13 * 60_000)
      expect(busyChecks).toBe(6) // initial attempt + five retries
      expect(
        activitySince(since).some(
          (row) => row.conversationId === conversation.id && row.text.includes('after 5 retries')
        )
      ).toBe(true)
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(busyChecks).toBe(6)
    } finally {
      removeWatchersFor(conversation.id)
      vi.useRealTimers()
    }
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

  it('validates federated delivery payloads and caps message text', () => {
    const valid = {
      messageId: 'wire-1',
      targetId: 'local-a',
      fromId: 'remote-a',
      fromTitle: 'Remote',
      text: 'hello',
      expectsReply: false
    }
    expect(validateWireMessage(valid)).toEqual(valid)
    expect(() => validateWireMessage({})).toThrow()
    expect(() => validateWireMessage({ ...valid, text: 'x'.repeat(256 * 1024 + 1) })).toThrow()
  })

  it('decodes UTF-8 correctly when a code point spans network chunks', () => {
    const bytes = Buffer.from('A🙂B')
    const chunks = [bytes.subarray(0, 3), bytes.subarray(3, 5), bytes.subarray(5)]
    expect(decodeWireBody(chunks, bytes.length)).toBe('A🙂B')
  })

  it('removes proxies no longer advertised by a reachable peer', async () => {
    const core = new BusCore()
    const federation = new FederationManager(core)
    const peerId = `peer-${Date.now()}`
    getDb()
      .prepare('INSERT INTO fed_peers (id, name, url, added_at) VALUES (?, ?, ?, ?)')
      .run(peerId, 'Test peer', 'http://127.0.0.1:1/fed/token', Date.now())
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'one', title: 'One', provider: 'claude' },
            { id: 'two', title: 'Two', provider: 'codex' }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      await federation.syncPeers()
      expect(core.listSessions('').map((session) => session.localId)).toEqual(
        expect.arrayContaining([`fed:${peerId}:one`, `fed:${peerId}:two`])
      )

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'one', title: 'One', provider: 'claude' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      await federation.syncPeers()
      const ids = core.listSessions('').map((session) => session.localId)
      expect(ids).toContain(`fed:${peerId}:one`)
      expect(ids).not.toContain(`fed:${peerId}:two`)
    } finally {
      fetchMock.mockRestore()
      getDb().prepare('DELETE FROM fed_peers WHERE id = ?').run(peerId)
    }
  })

  it('keeps a recent inbound sender routable across session discovery sync', async () => {
    const core = new BusCore()
    const federation = new FederationManager(core)
    const peerId = `peer-inbound-${Date.now()}`
    const peer = {
      id: peerId,
      name: 'Inbound peer',
      url: 'http://127.0.0.1:1/fed/token'
    }
    getDb()
      .prepare('INSERT INTO fed_peers (id, name, url, added_at) VALUES (?, ?, ?, ?)')
      .run(peer.id, peer.name, peer.url, Date.now())
    core.register(
      'local-target',
      () => ({
        localId: 'local-target',
        conversationId: 'local-target',
        title: 'Local target',
        provider: 'claude',
        status: 'idle'
      }),
      () => {}
    )
    const wire = {
      messageId: 'remote-message',
      targetId: 'local-target',
      fromId: 'remote-sender',
      fromTitle: 'Remote sender',
      text: 'hello',
      expectsReply: false
    }
    const register = federation as unknown as {
      registerInboundSender: (p: typeof peer, message: typeof wire) => string
    }
    const senderProxy = register.registerInboundSender(peer, wire)
    core.injectExternal({
      messageId: 'fedmsg:test:remote-message',
      from: senderProxy,
      to: 'local-target',
      text: 'hello',
      expectsReply: false
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      await federation.syncPeers()
      expect(core.listSessions('').map((session) => session.localId)).toContain(senderProxy)
      core.reply('local-target', 'fedmsg:test:remote-message', 'answer')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      expect(fetchMock.mock.calls[1][0]).toBe(`${peer.url}/deliver`)
    } finally {
      fetchMock.mockRestore()
      getDb().prepare('DELETE FROM fed_peers WHERE id = ?').run(peerId)
    }
  })

  it('culls an inbound-only sender after its reply grace expires', async () => {
    const core = new BusCore()
    const federation = new FederationManager(core)
    const peer = {
      id: `peer-expiry-${Date.now()}`,
      name: 'Expiry peer',
      url: 'http://127.0.0.1:1/fed/token'
    }
    getDb()
      .prepare('INSERT INTO fed_peers (id, name, url, added_at) VALUES (?, ?, ?, ?)')
      .run(peer.id, peer.name, peer.url, Date.now())
    const wire = {
      messageId: 'expiry-message',
      targetId: 'local-target',
      fromId: 'remote-expiry-sender',
      fromTitle: 'Remote expiry sender',
      text: 'hello',
      expectsReply: false
    }
    const register = federation as unknown as {
      registerInboundSender: (p: typeof peer, message: typeof wire) => string
    }
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const senderProxy = register.registerInboundSender(peer, wire)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      await federation.syncPeers()
      expect(core.listSessions('').map((session) => session.localId)).toContain(senderProxy)
      now += 10 * 60_000 + 1
      await federation.syncPeers()
      expect(core.listSessions('').map((session) => session.localId)).not.toContain(senderProxy)
    } finally {
      fetchMock.mockRestore()
      clock.mockRestore()
      getDb().prepare('DELETE FROM fed_peers WHERE id = ?').run(peer.id)
    }
  })

  it('does not cull peer proxies when discovery is unreachable', async () => {
    const core = new BusCore()
    const federation = new FederationManager(core)
    const peerId = `peer-unreachable-${Date.now()}`
    getDb()
      .prepare('INSERT INTO fed_peers (id, name, url, added_at) VALUES (?, ?, ?, ?)')
      .run(peerId, 'Unreachable peer', 'http://127.0.0.1:1/fed/token', Date.now())
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'remote', title: 'Remote', provider: 'codex' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      await federation.syncPeers()
      fetchMock.mockRejectedValueOnce(new Error('offline'))
      await federation.syncPeers()
      expect(core.listSessions('').map((session) => session.localId)).toContain(
        `fed:${peerId}:remote`
      )
    } finally {
      fetchMock.mockRestore()
      getDb().prepare('DELETE FROM fed_peers WHERE id = ?').run(peerId)
    }
  })
})

describe('transcript resilience and search', () => {
  it('skips a malformed cache row instead of breaking conversation history', () => {
    const conversation = createConversation('claude', 'claude-sonnet-5')
    recordTranscriptEvent(conversation.id, {
      type: 'user.message',
      localId: conversation.id,
      turnId: 'one',
      text: 'valid message'
    })
    getDb()
      .prepare('INSERT INTO transcript_cache (conversation_id, event_json) VALUES (?, ?)')
      .run(conversation.id, '{not valid json')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadTranscript(conversation.id)).toHaveLength(1)
    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
    clearTranscript(conversation.id)
  })

  it('finds message text even when newer tool JSON contains the same query', () => {
    const conversation = createConversation('claude', 'claude-sonnet-5', {
      title: 'Search target'
    })
    const needle = `needle-${Date.now()}`
    recordTranscriptEvent(conversation.id, {
      type: 'user.message',
      localId: conversation.id,
      turnId: 'one',
      text: `Find the ${needle} here`
    })
    const insert = getDb().prepare(
      'INSERT INTO transcript_cache (conversation_id, event_json) VALUES (?, ?)'
    )
    for (let index = 0; index < 510; index++) {
      insert.run(
        conversation.id,
        JSON.stringify({
          type: 'tool.output',
          localId: conversation.id,
          turnId: 'noise',
          toolUseId: `tool-${index}`,
          output: needle,
          isError: false
        })
      )
    }
    expect(searchTranscripts(needle).map((hit) => hit.conversationId)).toContain(conversation.id)
    clearTranscript(conversation.id)
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
    const short = normalizeGitUrl('owner/repo')
    expect(short.url).toBe('https://github.com/owner/repo.git')
    expect(short.dirName).toMatch(/^owner-repo-[a-f0-9]{8}$/)
    const full = normalizeGitUrl('https://github.com/o/r.git/')
    expect(full).toEqual(normalizeGitUrl('https://github.com/o/r'))
    expect(full.url).toBe('https://github.com/o/r.git')
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

  it('inspects capabilities and flags executable hooks separately from listing', async () => {
    const { mkdtempSync, mkdirSync: mk, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { addPlugin, inspectPlugins, removePlugin } = await import('../src/main/store/plugins')
    const dir = mkdtempSync(join(tmpdir(), 'chimera-plugin-inspect-'))
    mk(join(dir, '.claude-plugin'), { recursive: true })
    mk(join(dir, 'skills', 'audit'), { recursive: true })
    mk(join(dir, 'hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'inspected', version: '1.2.3', description: 'A test plugin' }))
    writeFileSync(join(dir, 'skills', 'audit', 'SKILL.md'), '# Audit')
    writeFileSync(join(dir, 'hooks', 'hooks.json'), '{"hooks":{}}')
    const plugin = addPlugin(dir, null, false)
    expect(inspectPlugins().find((item) => item.id === plugin.id)).toMatchObject({
      version: '1.2.3',
      description: 'A test plugin',
      hasHooks: true,
      health: 'ready',
      capabilities: { skills: 1, hooks: 1 }
    })
    removePlugin(plugin.id)
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

describe('replay id dedupe (codex per-turn item ids)', () => {
  it('uniquifies repeated ids, rebinds outputs, closes dangling tools', async () => {
    const { dedupeReplayIds } = await import('../src/main/store/transcript')
    const mk = (type: string, extra: Record<string, unknown>) =>
      ({ type, localId: 'c', turnId: 't', ...extra }) as never
    const events = [
      mk('text.done', { blockId: 'codex:item_1', text: 'turn one' }),
      mk('tool.started', { toolUseId: 'item_2', toolName: 'shell', input: {} }),
      mk('tool.output', { toolUseId: 'item_2', output: 'ok', isError: false }),
      // next turn reuses the same item ids
      mk('text.done', { blockId: 'codex:item_1', text: 'turn two' }),
      mk('tool.started', { toolUseId: 'item_2', toolName: 'shell', input: {} }),
      // ...and this second call never completed
    ]
    const out = dedupeReplayIds(events) as { type: string; blockId?: string; toolUseId?: string; output?: unknown }[]
    const texts = out.filter((e) => e.type === 'text.done')
    expect(new Set(texts.map((e) => e.blockId)).size).toBe(2) // both messages survive
    const starts = out.filter((e) => e.type === 'tool.started')
    expect(new Set(starts.map((e) => e.toolUseId)).size).toBe(2)
    // first output bound to first call; dangling second call closed synthetically
    const outputs = out.filter((e) => e.type === 'tool.output')
    expect(outputs).toHaveLength(2)
    expect(outputs[1].toolUseId).toBe(starts[1].toolUseId)
    expect(String(outputs[1].output)).toContain('did not complete')
  })
})
