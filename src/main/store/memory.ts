import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MEMORY_CAP = 8 * 1024

function memoryDir(): string {
  const dir = join(app.getPath('userData'), 'memories')
  mkdirSync(dir, { recursive: true })
  return dir
}

function memoryPath(conversationId: string): string {
  // conversationIds are uuids/known ids — safe as filenames.
  return join(memoryDir(), `${conversationId}.md`)
}

export function readMemory(conversationId: string): string {
  const path = memoryPath(conversationId)
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function saveMemory(conversationId: string, content: string): void {
  if (content.length > MEMORY_CAP) {
    throw new Error(`Memory too large (${content.length} chars, cap ${MEMORY_CAP}). Condense it.`)
  }
  writeFileSync(memoryPath(conversationId), content, 'utf8')
}

export function deleteMemory(conversationId: string): void {
  rmSync(memoryPath(conversationId), { force: true })
}

export const MEMORY_INSTRUCTIONS =
  'You have a PERSISTENT MEMORY that survives across sessions (chimera-bus tools read_memory / save_memory). ' +
  'save_memory REPLACES the whole file — read first, then write the merged result. ' +
  'Record durable facts: project conventions, user preferences, decisions, open threads. Keep it under 8KB; prune stale entries.'
