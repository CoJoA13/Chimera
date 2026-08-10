import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from './db'

export interface PluginRecord {
  id: string
  name: string
  path: string
  enabled: boolean
}

interface Row {
  id: string
  name: string
  path: string
  enabled: number
}

export function listPlugins(): PluginRecord[] {
  const rows = getDb().prepare('SELECT * FROM plugins ORDER BY name').all() as unknown as Row[]
  return rows.map((r) => ({ id: r.id, name: r.name, path: r.path, enabled: r.enabled === 1 }))
}

/** Validate a Claude Code plugin folder and register it. */
export function addPlugin(path: string): PluginRecord {
  const manifestPath = join(path, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Not a Claude Code plugin: missing ${manifestPath}`)
  }
  let name = path.split('/').filter(Boolean).pop() ?? 'plugin'
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
    if (manifest.name) name = manifest.name
  } catch {
    throw new Error('Invalid plugin.json manifest')
  }
  const record: PluginRecord = { id: randomUUID(), name, path, enabled: true }
  getDb()
    .prepare('INSERT INTO plugins (id, name, path, enabled) VALUES (?, ?, ?, 1)')
    .run(record.id, record.name, record.path)
  return record
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  getDb().prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function removePlugin(id: string): void {
  getDb().prepare('DELETE FROM plugins WHERE id = ?').run(id)
}

export function enabledPluginPaths(): { type: 'local'; path: string }[] {
  return listPlugins()
    .filter((p) => p.enabled)
    .map((p) => ({ type: 'local' as const, path: p.path }))
}
