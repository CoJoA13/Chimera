import { describe, it, expect } from 'vitest'
import { installPluginsFromGit, listPlugins, removePlugin } from '../src/main/store/plugins'

describe.skipIf(!process.env.CHIMERA_ACID)('live github plugin install', () => {
  it('clones a real repo and registers its plugin(s)', async () => {
    let installed
    try {
      installed = await installPluginsFromGit('obra/superpowers')
    } catch {
      // fallback: the official marketplace repo (larger clone)
      installed = await installPluginsFromGit('anthropics/claude-code')
    }
    console.log('installed:', installed.map((p) => p.name).join(', '))
    expect(installed.length).toBeGreaterThan(0)
    expect(listPlugins().some((p) => p.id === installed[0].id)).toBe(true)
    for (const p of installed) removePlugin(p.id)
  }, 300_000)
})
