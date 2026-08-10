import { app } from 'electron'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

/** Copy a file into the app's artifact store so bus recipients get a stable path. */
export function storeArtifact(sourcePath: string): { storedPath: string; size: number } {
  const stat = statSync(sourcePath)
  if (!stat.isFile()) throw new Error('Artifact must be a regular file')
  if (stat.size > MAX_ARTIFACT_BYTES) {
    throw new Error(`Artifact too large (${stat.size} bytes, cap ${MAX_ARTIFACT_BYTES})`)
  }
  const dir = join(app.getPath('userData'), 'artifacts')
  mkdirSync(dir, { recursive: true })
  const storedPath = join(dir, `${randomUUID().slice(0, 8)}-${basename(sourcePath)}`)
  copyFileSync(sourcePath, storedPath)
  return { storedPath, size: stat.size }
}
