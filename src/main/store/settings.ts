import { getDb } from './db'

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
    | { value_json: string }
    | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`
    )
    .run(key, JSON.stringify(value))
}
