import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { getDb } from './db'

export interface PluginRecord {
  id: string
  name: string
  path: string
  enabled: boolean
  gitUrl: string | null
}

interface Row {
  id: string
  name: string
  path: string
  enabled: number
  git_url: string | null
}

export function listPlugins(): PluginRecord[] {
  const rows = getDb().prepare('SELECT * FROM plugins ORDER BY name').all() as unknown as Row[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    enabled: r.enabled === 1,
    gitUrl: r.git_url
  }))
}

/** Validate a Claude Code plugin folder and register it. */
export function addPlugin(path: string, gitUrl: string | null = null): PluginRecord {
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
  const existing = listPlugins().find((p) => p.path === path)
  if (existing) return existing
  const record: PluginRecord = { id: randomUUID(), name, path, enabled: true, gitUrl }
  getDb()
    .prepare('INSERT INTO plugins (id, name, path, enabled, git_url) VALUES (?, ?, ?, 1, ?)')
    .run(record.id, record.name, record.path, gitUrl)
  return record
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  getDb().prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export function removePlugin(id: string): void {
  const plugin = listPlugins().find((p) => p.id === id)
  getDb().prepare('DELETE FROM plugins WHERE id = ?').run(id)
  // Git-managed plugins live in our storage: remove the clone when the last
  // plugin registered from that repo is gone.
  if (plugin?.gitUrl) {
    const root = repoRootFor(plugin.path)
    if (root && !listPlugins().some((p) => p.path.startsWith(root))) {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

export function enabledPluginPaths(): { type: 'local'; path: string }[] {
  return listPlugins()
    .filter((p) => p.enabled && existsSync(p.path))
    .map((p) => ({ type: 'local' as const, path: p.path }))
}

// ---------- GitHub installs ----------

const CLONE_TIMEOUT_MS = 120_000

function pluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

function git(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: CLONE_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, _stdout, stderr) =>
        err ? reject(new Error(stderr.split('\n')[0] || err.message)) : resolve()
    )
  })
}

/** Accepts https://github.com/owner/repo[.git], or the owner/repo shorthand. */
export function normalizeGitUrl(input: string): { url: string; dirName: string } {
  const trimmed = input.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (short) {
    return { url: `https://github.com/${short[1]}/${short[2]}.git`, dirName: `${short[1]}-${short[2]}` }
  }
  const full = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (full) {
    return { url: `${trimmed}.git`, dirName: `${full[1]}-${full[2]}` }
  }
  throw new Error('Use a github.com repo URL or owner/repo shorthand')
}

/** Find plugin manifests at the repo root or one/two levels deep (marketplace repos). */
function discoverPluginDirs(root: string): string[] {
  const found: string[] = []
  const hasManifest = (dir: string): boolean =>
    existsSync(join(dir, '.claude-plugin', 'plugin.json'))
  if (hasManifest(root)) return [root]
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const level1 = join(root, entry.name)
    if (hasManifest(level1)) {
      found.push(level1)
      continue
    }
    for (const sub of readdirSync(level1, { withFileTypes: true })) {
      if (sub.isDirectory() && hasManifest(join(level1, sub.name))) {
        found.push(join(level1, sub.name))
      }
    }
    if (found.length >= 20) break
  }
  return found.slice(0, 20)
}

/** Clone (or refresh) a GitHub repo and register every plugin found inside. */
export async function installPluginsFromGit(input: string): Promise<PluginRecord[]> {
  const { url, dirName } = normalizeGitUrl(input)
  mkdirSync(pluginsDir(), { recursive: true })
  const target = join(pluginsDir(), dirName)
  if (existsSync(target)) {
    await git(['-C', target, 'pull', '--ff-only'])
  } else {
    await git(['clone', '--depth', '1', url, target])
  }
  const dirs = discoverPluginDirs(target)
  if (dirs.length === 0) {
    rmSync(target, { recursive: true, force: true })
    throw new Error('No Claude Code plugin found in that repo (missing .claude-plugin/plugin.json)')
  }
  return dirs.map((dir) => addPlugin(dir, url))
}

function repoRootFor(pluginPath: string): string | null {
  const base = pluginsDir()
  if (!pluginPath.startsWith(base + '/')) return null
  const first = pluginPath.slice(base.length + 1).split('/')[0]
  return join(base, first)
}

/** Pull the latest for a git-installed plugin's repo. */
export async function updatePlugin(id: string): Promise<void> {
  const plugin = listPlugins().find((p) => p.id === id)
  if (!plugin?.gitUrl) throw new Error('Not a git-installed plugin')
  const root = repoRootFor(plugin.path)
  if (!root || !existsSync(root)) throw new Error('Plugin repo folder is missing — reinstall it')
  await git(['-C', root, 'pull', '--ff-only'])
}
