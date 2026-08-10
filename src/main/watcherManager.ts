import { watch, type FSWatcher, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type { SessionManager } from './ipc/sessions'
import { listWatchers, setWatcherState, type WatcherRecord } from './store/watchers'
import { getConversation } from './store/conversations'
import { logActivity } from './store/activity'

const GIT_POLL_MS = 60_000
const FILE_DEBOUNCE_MS = 5_000
const IGNORED = /(^|\/)(\.git|node_modules|dist|out|release)(\/|$)/

/**
 * Event-driven agent triggers: file watchers (fs.watch, debounced) and git
 * watchers (HEAD polling). Fires the watcher prompt into its conversation as a
 * normal turn. reload() after any watcher CRUD.
 */
export class WatcherManager {
  private fileWatchers = new Map<string, FSWatcher>()
  private debounces = new Map<string, { timer: NodeJS.Timeout; files: Set<string> }>()

  constructor(private readonly manager: SessionManager) {}

  start(): void {
    this.reload()
    setInterval(() => void this.pollGit(), GIT_POLL_MS)
  }

  reload(): void {
    // Tear down and rebuild file watchers to match the table.
    for (const [, watcher] of this.fileWatchers) watcher.close()
    this.fileWatchers.clear()
    for (const { timer } of this.debounces.values()) clearTimeout(timer)
    this.debounces.clear()

    for (const record of listWatchers()) {
      if (!record.enabled || record.kind !== 'files' || !existsSync(record.path)) continue
      try {
        const watcher = watch(record.path, { recursive: true }, (_event, filename) => {
          const name = filename?.toString() ?? ''
          if (IGNORED.test(name)) return
          this.queueFileFire(record.id, name)
        })
        watcher.on('error', () => this.fileWatchers.delete(record.id))
        this.fileWatchers.set(record.id, watcher)
      } catch {
        // unwatchable path — skip
      }
    }
  }

  private queueFileFire(watcherId: string, filename: string): void {
    const pending = this.debounces.get(watcherId)
    if (pending) {
      if (filename) pending.files.add(filename)
      return
    }
    const files = new Set<string>(filename ? [filename] : [])
    const timer = setTimeout(() => {
      this.debounces.delete(watcherId)
      const record = listWatchers().find((w) => w.id === watcherId)
      if (record?.enabled) {
        const changed = [...files].slice(0, 5).join(', ') || 'files'
        void this.fire(record, `changes in ${record.path} (${changed})`)
      }
    }, FILE_DEBOUNCE_MS)
    this.debounces.set(watcherId, { timer, files })
  }

  /** Public for tests — the interval calls this every minute. */
  async pollGit(): Promise<void> {
    for (const record of listWatchers()) {
      if (!record.enabled || record.kind !== 'git' || !existsSync(record.path)) continue
      const head = await new Promise<string | null>((resolve) => {
        execFile(
          'git',
          ['-C', record.path, 'rev-parse', 'HEAD'],
          { timeout: 10_000 },
          (err, stdout) => resolve(err ? null : stdout.trim())
        )
      })
      if (!head) continue
      if (record.lastState === null) {
        // First observation: baseline silently.
        setWatcherState(record.id, head)
        continue
      }
      if (head !== record.lastState) {
        const range = `${record.lastState.slice(0, 8)}..${head.slice(0, 8)}`
        setWatcherState(record.id, head)
        await this.fire(record, `new commit(s) ${range} in ${record.path}`)
      }
    }
  }

  private async fire(record: WatcherRecord, reason: string): Promise<void> {
    const conversation = getConversation(record.conversationId)
    if (!conversation) return
    logActivity('watcher', `Triggered "${conversation.title}": ${reason}`, conversation.id)
    const text = `[Watcher triggered: ${reason}] ${record.prompt}`
    try {
      if (conversation.kind === 'group') {
        await this.manager.groupSend(conversation.id, text)
      } else {
        if (this.manager.isBusy(conversation.id)) return // next event will retry
        await this.manager.startForConversation(conversation.id)
        await this.manager.send(conversation.id, text)
      }
    } catch (err) {
      console.error(`[watcher] ${record.id} failed:`, err)
    }
  }
}
