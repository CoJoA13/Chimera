import { watch, type FSWatcher, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type { SessionManager } from './ipc/sessions'
import { listWatchers, setWatcherState, type WatcherRecord } from './store/watchers'
import { getConversation, listGroupMembers } from './store/conversations'
import { logActivity } from './store/activity'

const GIT_POLL_MS = 60_000
const FILE_DEBOUNCE_MS = 5_000
const FILE_RETRY_MS = 30_000
const FILE_RETRY_MAX_MS = 5 * 60_000
const FILE_RETRY_ATTEMPTS = 5
const IGNORED = /(^|\/)(\.git|node_modules|dist|out|release)(\/|$)/

type FireResult = 'sent' | 'busy' | 'failed' | 'gone'

/**
 * Event-driven agent triggers: file watchers (fs.watch, debounced) and git
 * watchers (HEAD polling). Fires the watcher prompt into its conversation as a
 * normal turn. reload() after any watcher CRUD.
 */
export class WatcherManager {
  private fileWatchers = new Map<string, FSWatcher>()
  private debounces = new Map<string, { timer: NodeJS.Timeout; files: Set<string> }>()
  private retries = new Map<
    string,
    { timer: NodeJS.Timeout; files: Set<string>; attempt: number }
  >()
  private gitInFlight = new Set<string>()

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
    for (const retry of this.retries.values()) clearTimeout(retry.timer)
    this.retries.clear()

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
    const retry = this.retries.get(watcherId)
    if (retry) {
      if (filename) retry.files.add(filename)
      return
    }
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
        void this.fireFiles(record, files).then((result) => {
          if (result === 'busy') this.scheduleFileRetry(record.id, files, 0)
        })
      }
    }, FILE_DEBOUNCE_MS)
    this.debounces.set(watcherId, { timer, files })
  }

  private async fireFiles(record: WatcherRecord, files: Set<string>): Promise<FireResult> {
    const changed = [...files].slice(0, 5).join(', ') || 'files'
    return this.fire(record, `changes in ${record.path} (${changed})`)
  }

  private scheduleFileRetry(watcherId: string, files: Set<string>, attempt: number): void {
    const existing = this.retries.get(watcherId)
    if (existing) {
      for (const file of files) existing.files.add(file)
      return
    }
    const pendingFiles = new Set(files)
    if (attempt >= FILE_RETRY_ATTEMPTS) {
      const record = listWatchers().find((watcher) => watcher.id === watcherId)
      const conversation = record ? getConversation(record.conversationId) : undefined
      if (conversation) {
        logActivity(
          'watcher',
          `Skipped "${conversation.title}": target stayed busy after ${FILE_RETRY_ATTEMPTS} retries`,
          conversation.id
        )
      }
      return
    }
    const delay = Math.min(FILE_RETRY_MS * 2 ** attempt, FILE_RETRY_MAX_MS)
    const timer = setTimeout(() => {
      const retry = this.retries.get(watcherId)
      if (!retry) return
      this.retries.delete(watcherId)
      const record = listWatchers().find((watcher) => watcher.id === watcherId)
      if (!record?.enabled) return
      void this.fireFiles(record, retry.files).then((result) => {
        if (result === 'busy') {
          this.scheduleFileRetry(watcherId, retry.files, retry.attempt + 1)
        }
      })
    }, delay)
    this.retries.set(watcherId, { timer, files: pendingFiles, attempt })
  }

  /** Public for tests — the interval calls this every minute. */
  async pollGit(): Promise<void> {
    for (const record of listWatchers()) {
      if (!record.enabled || record.kind !== 'git' || !existsSync(record.path)) continue
      if (this.gitInFlight.has(record.id)) continue
      this.gitInFlight.add(record.id)
      try {
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
          const result = await this.fire(record, `new commit(s) ${range} in ${record.path}`)
          // Do not consume the commit until its agent turn was accepted. A busy
          // or failed target will retry this same range on the next poll.
          if (result === 'sent') setWatcherState(record.id, head)
        }
      } finally {
        this.gitInFlight.delete(record.id)
      }
    }
  }

  private async fire(record: WatcherRecord, reason: string): Promise<FireResult> {
    const conversation = getConversation(record.conversationId)
    if (!conversation) return 'gone'
    if (conversation.kind === 'group') {
      if (listGroupMembers(conversation.id).some((member) => this.manager.isBusy(member.id))) {
        return 'busy'
      }
    } else if (this.manager.isBusy(conversation.id)) {
      return 'busy'
    }
    const text = `[Watcher triggered: ${reason}] ${record.prompt}`
    try {
      if (conversation.kind === 'group') {
        await this.manager.groupSend(conversation.id, text)
      } else {
        await this.manager.startForConversation(conversation.id)
        await this.manager.send(conversation.id, text)
      }
      logActivity('watcher', `Triggered "${conversation.title}": ${reason}`, conversation.id)
      return 'sent'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[watcher] ${record.id} failed:`, err)
      logActivity('watcher', `Failed "${conversation.title}": ${message}`, conversation.id)
      return 'failed'
    }
  }
}
