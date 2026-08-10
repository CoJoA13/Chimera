import { app, dialog } from 'electron'
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from './db'

const DAY = 86_400_000

/**
 * Retention: transcripts are user data and are never pruned wholesale — only
 * capped per conversation. Operational tables get time windows.
 */
export function pruneOldData(): void {
  const db = getDb()
  const now = Date.now()
  db.prepare('DELETE FROM activity_log WHERE ts < ?').run(now - 30 * DAY)
  db.prepare('DELETE FROM bus_messages WHERE created_at < ?').run(now - 30 * DAY)
  db.prepare('DELETE FROM spend WHERE day < ?').run(
    new Date(now - 90 * DAY).toISOString().slice(0, 10)
  )
  // Cap each conversation's cached transcript at its most recent 2000 events.
  const convs = db
    .prepare('SELECT DISTINCT conversation_id c FROM transcript_cache')
    .all() as unknown as { c: string }[]
  for (const { c } of convs) {
    db.prepare(
      `DELETE FROM transcript_cache WHERE conversation_id = ? AND seq NOT IN
       (SELECT seq FROM transcript_cache WHERE conversation_id = ? ORDER BY seq DESC LIMIT 2000)`
    ).run(c, c)
  }
}

/** Copy the database, memories, and distilled skills to a user-chosen folder. */
export async function exportBackup(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a folder for the Chimera backup',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
  const dest = join(result.filePaths[0], `chimera-backup-${stamp}`)
  mkdirSync(dest, { recursive: true })
  const userData = app.getPath('userData')
  // WAL checkpoint so the copied db file is complete on its own.
  getDb().exec('PRAGMA wal_checkpoint(TRUNCATE);')
  cpSync(join(userData, 'chimera.db'), join(dest, 'chimera.db'))
  for (const dir of ['memories', 'distilled-skills', 'artifacts']) {
    const src = join(userData, dir)
    if (existsSync(src)) cpSync(src, join(dest, dir), { recursive: true })
  }
  return dest
}
