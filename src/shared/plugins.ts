export interface PluginInspection {
  id: string
  description: string | null
  version: string | null
  capabilities: {
    skills: number
    agents: number
    commands: number
    hooks: number
  }
  hasHooks: boolean
  health: 'ready' | 'missing' | 'invalid'
  issue: string | null
}

export interface PluginManagementRow {
  id: string
  name: string
  gitUrl: string | null
}

export function hookPluginNames(
  plugins: PluginManagementRow[],
  inspections: Record<string, PluginInspection>
): string[] {
  return plugins
    .filter((plugin) => inspections[plugin.id]?.hasHooks !== false)
    .map((plugin) => plugin.name)
}

export function uniqueGitPlugins<T extends PluginManagementRow>(plugins: T[]): T[] {
  return [...new Map(plugins.filter((plugin) => plugin.gitUrl).map((plugin) => [plugin.gitUrl, plugin])).values()]
}
