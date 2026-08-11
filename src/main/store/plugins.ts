import { createHash, randomUUID } from 'node:crypto'
import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { getDb } from './db'
import type { PluginInspection } from '../../shared/plugins'

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

function countFiles(root: string, accept: (name: string) => boolean): number {
  if (!existsSync(root)) return 0
  let count = 0
  const visit = (dir: string, depth: number): void => {
    if (depth > 3 || count >= 200) return
    for (const entry of readdirSync(dir, { withFileTypes: true }).slice(0, 200)) {
      if (entry.isFile() && accept(entry.name)) count++
      else if (entry.isDirectory() && !entry.name.startsWith('.')) visit(join(dir, entry.name), depth + 1)
      if (count >= 200) return
    }
  }
  visit(root, 0)
  return count
}

function hasDirectoryEntries(root: string): boolean {
  return existsSync(root) && readdirSync(root, { withFileTypes: true }).length > 0
}

/** Slow filesystem inventory for Settings only; session startup keeps using listPlugins(). */
export function inspectPlugins(): PluginInspection[] {
  return listPlugins().map((plugin) => {
    if (!existsSync(plugin.path)) {
      return { id: plugin.id, description: null, version: null, capabilities: { skills: 0, agents: 0, commands: 0, hooks: 0 }, hasHooks: false, health: 'missing', issue: 'Plugin folder is missing' }
    }
    try {
      const manifest = JSON.parse(readFileSync(join(plugin.path, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>
      const hooks = countFiles(join(plugin.path, 'hooks'), (name) => name === 'hooks.json') + (manifest.hooks ? 1 : 0)
      return {
        id: plugin.id,
        description: typeof manifest.description === 'string' ? manifest.description : null,
        version: typeof manifest.version === 'string' ? manifest.version : null,
        capabilities: {
          skills: countFiles(join(plugin.path, 'skills'), (name) => name === 'SKILL.md'),
          agents: countFiles(join(plugin.path, 'agents'), (name) => name.endsWith('.md')),
          commands: countFiles(join(plugin.path, 'commands'), (name) => name.endsWith('.md')),
          hooks
        },
        hasHooks: hooks > 0 || hasDirectoryEntries(join(plugin.path, 'hooks')),
        health: 'ready',
        issue: null
      }
    } catch (error) {
      return {
        id: plugin.id,
        description: null,
        version: null,
        capabilities: { skills: 0, agents: 0, commands: 0, hooks: 0 },
        hasHooks: false,
        health: 'invalid',
        issue: error instanceof Error ? error.message : 'Invalid plugin manifest'
      }
    }
  })
}

/** Validate a Claude Code plugin folder and register it. */
export function addPlugin(
  path: string,
  gitUrl: string | null = null,
  enabled = true
): PluginRecord {
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
  const record: PluginRecord = { id: randomUUID(), name, path, enabled, gitUrl }
  getDb()
    .prepare('INSERT INTO plugins (id, name, path, enabled, git_url) VALUES (?, ?, ?, ?, ?)')
    .run(record.id, record.name, record.path, enabled ? 1 : 0, gitUrl)
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
    const url = `https://github.com/${short[1]}/${short[2]}.git`
    return { url, dirName: repoDirectoryName(short[1], short[2], url) }
  }
  const full = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (full) {
    const url = `${trimmed}.git`
    return { url, dirName: repoDirectoryName(full[1], full[2], url) }
  }
  throw new Error('Use a github.com repo URL or owner/repo shorthand')
}

function repoDirectoryName(owner: string, repo: string, url: string): string {
  const suffix = createHash('sha256').update(url).digest('hex').slice(0, 8)
  return `${owner}-${repo}-${suffix}`
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
  // Plugins may contain executable hooks. Installation only stages the code;
  // the user must inspect and explicitly enable each discovered plugin.
  return dirs.map((dir) => addPlugin(dir, url, false))
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
