import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { SessionManager } from '../src/main/ipc/sessions'
import { WatcherManager } from '../src/main/watcherManager'
import { runDueSchedules } from '../src/main/scheduler'
import { FederationManager } from '../src/main/federation'
import { BusCore } from '../src/main/bus/BusCore'
import { crossVerify } from '../src/main/verifier'
import { secondOpinion } from '../src/main/secondOpinion'
import { createConversation } from '../src/main/store/conversations'
import { addWatcher } from '../src/main/store/watchers'
import { addMission, listMissions } from '../src/main/store/missions'
import { getDb } from '../src/main/store/db'
import { recordTranscriptEvent, loadTranscript } from '../src/main/store/transcript'
import { setSetting } from '../src/main/store/settings'
import { addAlwaysAllowRule } from '../src/main/store/permissions'

const HAIKU = 'claude-haiku-4-5-20251001'

async function waitFor(pred: () => boolean, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`timeout waiting for: ${label}`)
}

/** Live shakedown of previously-untested features. Gated: CHIMERA_ACID=1. */
describe.skipIf(!process.env.CHIMERA_ACID)('shakedown', () => {
  it('auto-verify: codex checks a false claim from claude', async () => {
    const verdict = await crossVerify(
      'The capital of Australia is Sydney, which has been the capital since federation in 1901.',
      'claude' // answered by claude → verified by codex
    )
    console.log('codex verdict:', JSON.stringify(verdict))
    expect(verdict).not.toBeNull()
    expect(verdict!.verifier).toBe('codex')
    expect(['disputed', 'uncertain']).toContain(verdict!.verdict)
  }, 120_000)

  it('auto-verify: claude checks a true claim from codex', async () => {
    const verdict = await crossVerify(
      'Water is composed of two hydrogen atoms and one oxygen atom, with the chemical formula H2O.',
      'codex' // answered by codex → verified by claude haiku
    )
    console.log('claude verdict:', JSON.stringify(verdict))
    expect(verdict).not.toBeNull()
    expect(verdict!.verifier).toBe('claude')
    expect(verdict!.verdict).toBe('corroborated')
  }, 120_000)

  it('second opinion answers the last question with context', async () => {
    const conv = createConversation('claude', HAIKU, { title: 'SO test' })
    recordTranscriptEvent(conv.id, {
      type: 'user.message',
      localId: conv.id,
      turnId: 't',
      text: 'My dog is named Biscuit.'
    })
    recordTranscriptEvent(conv.id, {
      type: 'text.done',
      localId: conv.id,
      turnId: 't',
      blockId: 'b1',
      text: 'Nice to meet Biscuit!'
    })
    recordTranscriptEvent(conv.id, {
      type: 'user.message',
      localId: conv.id,
      turnId: 't2',
      text: 'What is my dog called? Answer with just the name.'
    })
    const answer = await secondOpinion(conv.id, 'claude', HAIKU)
    console.log('second opinion:', answer)
    expect(answer.toLowerCase()).toContain('biscuit')
  }, 120_000)

  it('git watcher detects a commit and fires a live agent turn', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'chimera-watch-'))
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', repo, ...args], {
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
      })
    }
    git('init', '-b', 'main')
    writeFileSync(join(repo, 'a.txt'), 'one')
    git('add', '.')
    git('commit', '-m', 'first')

    const manager = new SessionManager(() => null)
    const conv = createConversation('claude', HAIKU, { title: 'Watcher test' })
    manager.registerConversation(conv.id)
    addWatcher(conv.id, repo, 'git', 'Say WATCHER-ACK and nothing else.')

    const watchers = new WatcherManager(manager)
    await watchers.pollGit() // baseline
    writeFileSync(join(repo, 'a.txt'), 'two')
    git('add', '.')
    git('commit', '-m', 'second')
    await watchers.pollGit() // detect + fire

    await waitFor(
      () =>
        loadTranscript(conv.id).some(
          (e) => e.type === 'text.done' && e.text.includes('WATCHER-ACK')
        ),
      120_000,
      'watcher-triggered agent reply'
    )
    const events = loadTranscript(conv.id)
    expect(events.some((e) => e.type === 'user.message' && e.text.includes('[Watcher triggered'))).toBe(true)
    await manager.disposeAll()
  }, 180_000)

  it('mission check-in runs live and the agent updates the mission board', async () => {
    const manager = new SessionManager(() => null)
    const conv = createConversation('claude', HAIKU, { title: 'Mission test' })
    manager.registerConversation(conv.id)
    // Headless: no renderer to answer permission dialogs — pre-approve the
    // bus tools the check-in uses (also exercises the always-allow rule path).
    for (const tool of [
      'mcp__chimera-bus__update_mission',
      'mcp__chimera-bus__save_memory',
      'mcp__chimera-bus__read_memory',
      'mcp__chimera-bus__send_to_session',
      'mcp__chimera-bus__list_sessions'
    ]) {
      addAlwaysAllowRule(tool, conv.id)
    }
    const mission = addMission(
      'Say hello',
      'This is a TEST mission. The only increment required: call update_mission with progress "hello done" and status "done".',
      conv.id,
      { type: 'interval', minutes: 60 }
    )
    // Force it due and run one scheduler tick.
    getDb().prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(Date.now() - 1000, mission.scheduleId)
    await runDueSchedules(manager)
    await waitFor(
      () => listMissions().find((m) => m.id === mission.id)?.status === 'done',
      180_000,
      'mission marked done by agent tool call'
    )
    const done = listMissions().find((m) => m.id === mission.id)!
    console.log('mission progress:', done.progress)
    expect(done.progress).toBeTruthy()
    await manager.disposeAll()
  }, 240_000)

  it('federation server: sessions listing and loopback delivery', async () => {
    const core = new BusCore()
    const delivered: string[] = []
    core.register(
      'local-x',
      () => ({
        localId: 'local-x',
        conversationId: 'local-x',
        title: 'X',
        provider: 'claude',
        status: 'idle'
      }),
      (msg) => delivered.push(msg.text)
    )
    setSetting('fedEnabled', true)
    setSetting('fedPort', 17877)
    const fed = new FederationManager(core)
    await fed.start()
    const address = fed.address()
    expect(address).toBeTruthy()
    const base = address!.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:17877')

    const sessions = (await (await fetch(`${base}/sessions`)).json()) as { id: string }[]
    expect(sessions.some((s) => s.id === 'local-x')).toBe(true)

    const res = await fetch(`${base}/deliver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageId: 'wire-1',
        targetId: 'local-x',
        fromId: 'remote-1',
        fromTitle: 'Remote @ elsewhere',
        text: 'hello across the wire',
        expectsReply: false
      })
    })
    expect(res.ok).toBe(true)
    expect(delivered).toEqual(['hello across the wire'])

    // Bad token 404s.
    const bad = await fetch(`${base.replace(/fed\/[a-f0-9]+/, 'fed/' + '0'.repeat(32))}/sessions`)
    expect(bad.status).toBe(404)
    fed.stop()
    setSetting('fedEnabled', false)
  }, 30_000)
})
