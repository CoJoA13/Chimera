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
